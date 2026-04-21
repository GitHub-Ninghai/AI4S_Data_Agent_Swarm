import { Router } from "express";
import crypto from "node:crypto";
import * as agentStore from "../store/agentStore.js";
import * as taskStore from "../store/taskStore.js";
import { broadcast } from "../services/wsBroadcaster.js";
import type { Agent } from "../store/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TURNS = 200;
const DEFAULT_MAX_BUDGET_USD = 5.0;
const DEFAULT_ALLOWED_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Glob",
  "WebFetch",
];

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateString(
  value: unknown,
  field: string,
  min: number,
  max: number,
): string | null {
  if (typeof value !== "string") {
    return `${field} is required`;
  }
  if (value.length < min || value.length > max) {
    return `${field} must be ${min}-${max} characters`;
  }
  return null;
}

function validateAgentFields(body: Record<string, unknown>): string | null {
  if (body.name !== undefined) {
    const err = validateString(body.name, "name", 1, 50);
    if (err) return err;
  }
  if (body.avatar !== undefined) {
    if (typeof body.avatar !== "string" || body.avatar.length === 0) {
      return "avatar is required and must be non-empty";
    }
  }
  if (body.role !== undefined) {
    const err = validateString(body.role, "role", 1, 200);
    if (err) return err;
  }
  if (body.prompt !== undefined) {
    const err = validateString(body.prompt, "prompt", 10, 5000);
    if (err) return err;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const agentsRouter = Router();

// GET /api/agents
agentsRouter.get("/", (_req, res) => {
  res.json({ agents: agentStore.getAllAgents() });
});

// GET /api/agents/:id
agentsRouter.get("/:id", (req, res) => {
  const agent = agentStore.getAgentById(req.params.id);
  if (!agent) {
    return res.status(404).json({
      error: { code: "AGENT_NOT_FOUND", message: "Agent not found" },
    });
  }
  res.json({ agent });
});

// POST /api/agents
agentsRouter.post("/", (req, res) => {
  const { name, avatar, role, prompt, projectId, maxTurns, maxBudgetUsd, allowedTools } = req.body;

  // Validate required fields
  const nameError = validateString(name, "name", 1, 50);
  if (nameError) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: nameError },
    });
  }

  if (typeof avatar !== "string" || avatar.length === 0) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "avatar is required and must be non-empty" },
    });
  }

  const roleError = validateString(role, "role", 1, 200);
  if (roleError) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: roleError },
    });
  }

  const promptError = validateString(prompt, "prompt", 10, 5000);
  if (promptError) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: promptError },
    });
  }

  const now = Date.now();
  const agent: Agent = {
    id: crypto.randomUUID(),
    name,
    avatar,
    role,
    prompt,
    isEnabled: true,
    status: "idle",
    projectId,
    maxTurns: maxTurns ?? DEFAULT_MAX_TURNS,
    maxBudgetUsd: maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD,
    allowedTools: allowedTools ?? [...DEFAULT_ALLOWED_TOOLS],
    taskCount: 0,
    stats: {
      totalTasksCompleted: 0,
      totalTasksCancelled: 0,
      totalCostUsd: 0,
      avgDurationMs: 0,
    },
    lastEventAt: 0,
    createdAt: now,
    updatedAt: now,
  };

  agentStore.createAgent(agent);
  broadcast("agent:update", agent);
  res.status(201).json({ agent });
});

// PUT /api/agents/:id
agentsRouter.put("/:id", (req, res) => {
  const existing = agentStore.getAgentById(req.params.id);
  if (!existing) {
    return res.status(404).json({
      error: { code: "AGENT_NOT_FOUND", message: "Agent not found" },
    });
  }

  const validationError = validateAgentFields(req.body);
  if (validationError) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: validationError },
    });
  }

  const patch: Record<string, unknown> = {};
  const allowedFields = [
    "name", "avatar", "role", "prompt", "projectId",
    "maxTurns", "maxBudgetUsd", "allowedTools", "isEnabled",
  ];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      patch[field] = req.body[field];
    }
  }

  // Handle isEnabled → status transition
  if (patch.isEnabled === false && existing.isEnabled === true) {
    const activeTask = taskStore.getActiveTaskForAgent(existing.id);
    if (!activeTask) {
      patch.status = "offline";
    }
  } else if (patch.isEnabled === true && existing.isEnabled === false) {
    if (existing.status === "offline") {
      patch.status = "idle";
    }
  }

  const updated = agentStore.updateAgent(req.params.id, patch);
  broadcast("agent:update", updated);
  res.json({ agent: updated });
});

// GET /api/agents/:id/stats
agentsRouter.get("/:id/stats", (req, res) => {
  const agent = agentStore.getAgentById(req.params.id);
  if (!agent) {
    return res.status(404).json({
      error: { code: "AGENT_NOT_FOUND", message: "Agent not found" },
    });
  }

  // Get recent completed/cancelled tasks (last 10, sorted by completedAt desc)
  const recentTasks = taskStore
    .getAllTasks()
    .filter(
      (t) =>
        t.agentId === req.params.id &&
        (t.status === "Done" || t.status === "Cancelled") &&
        t.completedAt !== undefined,
    )
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    .slice(0, 10);

  res.json({
    ...agent.stats,
    recentTasks,
  });
});

// DELETE /api/agents/:id
agentsRouter.delete("/:id", (req, res) => {
  const existing = agentStore.getAgentById(req.params.id);
  if (!existing) {
    return res.status(404).json({
      error: { code: "AGENT_NOT_FOUND", message: "Agent not found" },
    });
  }

  // Check for running/stuck tasks
  const activeTasks = taskStore
    .getAllTasks()
    .filter(
      (t) =>
        t.agentId === req.params.id &&
        (t.status === "Running" || t.status === "Stuck"),
    );

  if (activeTasks.length > 0) {
    return res.status(409).json({
      error: {
        code: "RESOURCE_HAS_DEPENDENTS",
        message: `Cannot delete agent: ${activeTasks.length} active task(s) are still running or stuck`,
      },
    });
  }

  agentStore.deleteAgent(req.params.id);
  broadcast("agent:delete", { id: req.params.id });
  res.json({ ok: true });
});
