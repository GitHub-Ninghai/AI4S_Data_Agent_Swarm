import { Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import * as taskStore from "../store/taskStore.js";
import * as agentStore from "../store/agentStore.js";
import * as projectStore from "../store/projectStore.js";
import { broadcast } from "../services/wsBroadcaster.js";
import { taskManager, TaskManagerError } from "../services/taskManager.js";
import { resolveToolDecision } from "../sdk/queryWrapper.js";
import type { Task, Event } from "../store/types.js";

// ---------------------------------------------------------------------------
// Events directory
// ---------------------------------------------------------------------------

const EVENTS_DIR = path.resolve(process.cwd(), "data", "events");

function ensureEventsDir(): void {
  if (!fs.existsSync(EVENTS_DIR)) {
    fs.mkdirSync(EVENTS_DIR, { recursive: true });
  }
}

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

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const tasksRouter = Router();

// GET /api/tasks — list with filtering and pagination
tasksRouter.get("/", (req, res) => {
  const {
    projectId,
    status,
    agentId,
    q,
    page = "1",
    limit = "20",
    includeDeleted,
  } = req.query;

  let tasks = taskStore.getAllTasks();

  // Soft-deleted filter (exclude by default)
  if (includeDeleted !== "true") {
    tasks = tasks.filter((t) => t.deletedAt === undefined);
  }

  // Filters
  if (typeof projectId === "string") {
    tasks = tasks.filter((t) => t.projectId === projectId);
  }

  if (typeof status === "string") {
    const statuses = status.split(",");
    tasks = tasks.filter((t) => statuses.includes(t.status));
  }

  if (typeof agentId === "string") {
    tasks = tasks.filter((t) => t.agentId === agentId);
  }

  if (typeof q === "string" && q.length > 0) {
    const lower = q.toLowerCase();
    tasks = tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(lower) ||
        t.description.toLowerCase().includes(lower),
    );
  }

  // Sort by createdAt descending
  tasks.sort((a, b) => b.createdAt - a.createdAt);

  // Pagination
  const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));
  const total = tasks.length;
  const totalPages = Math.ceil(total / limitNum);
  const start = (pageNum - 1) * limitNum;
  const paginated = tasks.slice(start, start + limitNum);

  res.json({
    tasks: paginated,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages,
  });
});

// GET /api/tasks/:id
tasksRouter.get("/:id", (req, res) => {
  const task = taskStore.getTaskById(req.params.id);
  if (!task) {
    return res.status(404).json({
      error: { code: "TASK_NOT_FOUND", message: "Task not found" },
    });
  }
  res.json({ task });
});

// GET /api/tasks/:id/events — paginated event list from JSONL
tasksRouter.get("/:id/events", async (req, res) => {
  const task = taskStore.getTaskById(req.params.id);
  if (!task) {
    return res.status(404).json({
      error: { code: "TASK_NOT_FOUND", message: "Task not found" },
    });
  }

  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
  const typeFilter = typeof req.query.type === "string" ? req.query.type : undefined;

  ensureEventsDir();

  const jsonlPath = path.join(EVENTS_DIR, `${req.params.id}.jsonl`);
  const gzPath = path.join(EVENTS_DIR, `${req.params.id}.jsonl.gz`);

  let allEvents: Event[] = [];

  // Read archived events from .gz if exists
  if (fs.existsSync(gzPath)) {
    try {
      const gzBuffer = fs.readFileSync(gzPath);
      const decompressed = zlib.gunzipSync(gzBuffer);
      const lines = decompressed.toString("utf-8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          allEvents.push(JSON.parse(trimmed) as Event);
        } catch {
          // Skip malformed lines
        }
      }
    } catch (err) {
      console.error(`[Events] Failed to read archive ${gzPath}:`, err);
    }
  }

  // Read current JSONL file
  if (fs.existsSync(jsonlPath)) {
    try {
      const content = fs.readFileSync(jsonlPath, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          allEvents.push(JSON.parse(trimmed) as Event);
        } catch {
          // Skip malformed lines
        }
      }
    } catch (err) {
      console.error(`[Events] Failed to read ${jsonlPath}:`, err);
    }
  }

  // Filter by type if specified
  if (typeFilter) {
    allEvents = allEvents.filter((e) => e.eventType === typeFilter);
  }

  // Sort by timestamp ascending (oldest first)
  allEvents.sort((a, b) => a.timestamp - b.timestamp);

  const total = allEvents.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const paginated = allEvents.slice(start, start + limit);

  res.json({
    events: paginated,
    total,
    page,
    limit,
    totalPages,
  });
});

// GET /api/tasks/:id/sdk-status — real-time SDK running status
tasksRouter.get("/:id/sdk-status", async (req, res) => {
  const task = taskStore.getTaskById(req.params.id);
  if (!task) {
    return res.status(404).json({
      error: { code: "TASK_NOT_FOUND", message: "Task not found" },
    });
  }

  const { sdkSessionManager } = await import("../services/sdkSessionManager.js");
  const running = sdkSessionManager.hasActiveTask(req.params.id);

  res.json({
    running,
    turnCount: task.turnCount,
    budgetUsed: task.budgetUsed,
    maxBudgetUsd: task.maxBudgetUsd,
  });
});

// POST /api/tasks — create
tasksRouter.post("/", (req, res) => {
  const { title, description, agentId, projectId, priority, tags, maxTurns, maxBudgetUsd } = req.body;

  // Validate required fields
  const titleError = validateString(title, "title", 1, 100);
  if (titleError) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: titleError },
    });
  }

  const descError = validateString(description, "description", 10, 10000);
  if (descError) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: descError },
    });
  }

  if (typeof agentId !== "string" || agentId.length === 0) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "agentId is required" },
    });
  }

  if (typeof projectId !== "string" || projectId.length === 0) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "projectId is required" },
    });
  }

  // Validate agent exists
  const agent = agentStore.getAgentById(agentId);
  if (!agent) {
    return res.status(404).json({
      error: { code: "AGENT_NOT_FOUND", message: "Agent not found" },
    });
  }

  // Validate project exists
  const project = projectStore.getProjectById(projectId);
  if (!project) {
    return res.status(404).json({
      error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
    });
  }

  const now = Date.now();
  const task: Task = {
    id: crypto.randomUUID(),
    title,
    description,
    status: "Todo",
    agentId,
    projectId,
    priority: (priority as 0 | 1 | 2) ?? 1,
    tags: Array.isArray(tags) ? tags : [],
    eventCount: 0,
    turnCount: 0,
    budgetUsed: 0,
    maxTurns: maxTurns ?? agent.maxTurns ?? 200,
    maxBudgetUsd: maxBudgetUsd ?? agent.maxBudgetUsd ?? 5.0,
    createdAt: now,
  };

  taskStore.createTask(task);

  // Update agent taskCount
  agentStore.updateAgent(agentId, { taskCount: agent.taskCount + 1 });

  broadcast("task:update", task);
  broadcast("agent:update", agentStore.getAgentById(agentId));
  res.status(201).json({ task });
});

// PUT /api/tasks/:id — update
tasksRouter.put("/:id", (req, res) => {
  const existing = taskStore.getTaskById(req.params.id);
  if (!existing) {
    return res.status(404).json({
      error: { code: "TASK_NOT_FOUND", message: "Task not found" },
    });
  }

  const patch: Record<string, unknown> = {};

  // Validate title if provided
  if (req.body.title !== undefined) {
    const err = validateString(req.body.title, "title", 1, 100);
    if (err) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: err },
      });
    }
    patch.title = req.body.title;
  }

  // Validate description if provided
  if (req.body.description !== undefined) {
    const err = validateString(req.body.description, "description", 10, 10000);
    if (err) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: err },
      });
    }
    patch.description = req.body.description;
  }

  // Handle agentId change
  if (req.body.agentId !== undefined && req.body.agentId !== existing.agentId) {
    // Running/Stuck tasks cannot change agent
    if (existing.status === "Running" || existing.status === "Stuck") {
      return res.status(409).json({
        error: {
          code: "TASK_ALREADY_RUNNING",
          message: "运行中的任务不可更换 Agent",
        },
      });
    }

    // Validate new agent exists
    const newAgent = agentStore.getAgentById(req.body.agentId);
    if (!newAgent) {
      return res.status(404).json({
        error: { code: "AGENT_NOT_FOUND", message: "New agent not found" },
      });
    }

    // Update task counts
    const oldAgent = agentStore.getAgentById(existing.agentId);
    if (oldAgent) {
      agentStore.updateAgent(existing.agentId, {
        taskCount: Math.max(0, oldAgent.taskCount - 1),
      });
    }
    agentStore.updateAgent(req.body.agentId, {
      taskCount: newAgent.taskCount + 1,
    });

    patch.agentId = req.body.agentId;
  }

  // Other fields
  if (req.body.priority !== undefined) {
    patch.priority = req.body.priority;
  }
  if (req.body.tags !== undefined) {
    patch.tags = req.body.tags;
  }
  if (req.body.maxTurns !== undefined) {
    patch.maxTurns = req.body.maxTurns;
  }
  if (req.body.maxBudgetUsd !== undefined) {
    patch.maxBudgetUsd = req.body.maxBudgetUsd;
  }

  const updated = taskStore.updateTask(req.params.id, patch);
  broadcast("task:update", updated);
  res.json({ task: updated });
});

// DELETE /api/tasks/:id
tasksRouter.delete("/:id", (req, res) => {
  const existing = taskStore.getTaskById(req.params.id);
  if (!existing) {
    return res.status(404).json({
      error: { code: "TASK_NOT_FOUND", message: "Task not found" },
    });
  }

  // Running/Stuck tasks cannot be deleted
  if (existing.status === "Running" || existing.status === "Stuck") {
    return res.status(409).json({
      error: {
        code: "TASK_ALREADY_RUNNING",
        message: "请先停止 Task",
      },
    });
  }

  if (existing.status === "Done" || existing.status === "Cancelled") {
    // Soft delete
    taskStore.updateTask(req.params.id, { deletedAt: Date.now() });
  } else {
    // Hard delete (Todo status)
    taskStore.deleteTask(req.params.id);

    // Update agent taskCount
    const agent = agentStore.getAgentById(existing.agentId);
    if (agent) {
      agentStore.updateAgent(existing.agentId, {
        taskCount: Math.max(0, agent.taskCount - 1),
      });
      broadcast("agent:update", agentStore.getAgentById(existing.agentId));
    }
  }

  broadcast("task:update", { id: req.params.id, deleted: true });
  res.json({ ok: true });
});

// POST /api/tasks/:id/start — start a Todo task
tasksRouter.post("/:id/start", async (req, res, next) => {
  try {
    await taskManager.startTask(req.params.id);
    const task = taskStore.getTaskById(req.params.id);
    res.json({ task });
  } catch (err) {
    if (err instanceof TaskManagerError) {
      return res.status(err.statusCode).json({
        error: { code: err.code, message: err.message },
      });
    }
    next(err);
  }
});

// POST /api/tasks/:id/stop — cancel a running/stuck task
tasksRouter.post("/:id/stop", (req, res, next) => {
  try {
    taskManager.cancelTask(req.params.id);
    const task = taskStore.getTaskById(req.params.id);
    res.json({ task });
  } catch (err) {
    if (err instanceof TaskManagerError) {
      return res.status(err.statusCode).json({
        error: { code: err.code, message: err.message },
      });
    }
    next(err);
  }
});

// POST /api/tasks/:id/done — manually mark as done
tasksRouter.post("/:id/done", (req, res, next) => {
  try {
    taskManager.doneTask(req.params.id);
    const task = taskStore.getTaskById(req.params.id);
    res.json({ task });
  } catch (err) {
    if (err instanceof TaskManagerError) {
      return res.status(err.statusCode).json({
        error: { code: err.code, message: err.message },
      });
    }
    next(err);
  }
});

// POST /api/tasks/:id/message — send message to a stuck task (SDK resume)
tasksRouter.post("/:id/message", async (req, res, next) => {
  try {
    const task = taskStore.getTaskById(req.params.id);
    if (!task) {
      return res.status(404).json({
        error: { code: "TASK_NOT_FOUND", message: "Task not found" },
      });
    }

    if (task.status !== "Stuck") {
      return res.status(409).json({
        error: {
          code: "TASK_NOT_STUCK",
          message: `Task status is ${task.status}, expected Stuck`,
        },
      });
    }

    const { message, allowTool } = req.body;
    if (typeof message !== "string" || message.length === 0) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "message is required" },
      });
    }

    // Handle tool approval decision if provided
    if (allowTool?.decision) {
      resolveToolDecision(req.params.id, allowTool.decision);
    }

    // Resume task via SDK session manager
    const agent = agentStore.getAgentById(task.agentId);
    const project = projectStore.getProjectById(task.projectId);
    if (!agent || !project || !task.sessionId) {
      return res.status(409).json({
        error: {
          code: "CANNOT_RESUME",
          message: "Missing agent, project, or session for resume",
        },
      });
    }

    const { sdkSessionManager } = await import("../services/sdkSessionManager.js");
    await sdkSessionManager.resumeTask(
      task.sessionId,
      message,
      task,
      agent,
      project.path,
    );

    // Transition task back to Running
    taskStore.updateTask(req.params.id, { status: "Running", stuckReason: undefined });
    agentStore.updateAgent(task.agentId, { status: "working" });

    broadcast("task:update", {
      id: req.params.id,
      status: "Running",
    });
    broadcast("agent:update", {
      id: task.agentId,
      status: "working",
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks/:id/approve-tool — approve/deny a pending tool call
tasksRouter.post("/:id/approve-tool", (req, res) => {
  const task = taskStore.getTaskById(req.params.id);
  if (!task) {
    return res.status(404).json({
      error: { code: "TASK_NOT_FOUND", message: "Task not found" },
    });
  }

  if (task.status !== "Stuck") {
    return res.status(409).json({
      error: {
        code: "TASK_NOT_STUCK",
        message: `Task status is ${task.status}, expected Stuck`,
      },
    });
  }

  const { decision } = req.body;
  if (decision !== "allow" && decision !== "deny") {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "decision must be 'allow' or 'deny'",
      },
    });
  }

  const resolved = resolveToolDecision(req.params.id, decision);
  if (!resolved) {
    return res.status(404).json({
      error: {
        code: "NO_PENDING_APPROVAL",
        message: "No pending tool approval for this task",
      },
    });
  }

  // If allowed, transition back to Running
  if (decision === "allow") {
    taskStore.updateTask(req.params.id, { status: "Running", stuckReason: undefined });
    agentStore.updateAgent(task.agentId, { status: "working" });

    broadcast("task:update", {
      id: req.params.id,
      status: "Running",
    });
    broadcast("agent:update", {
      id: task.agentId,
      status: "working",
    });
  }

  res.json({ ok: true });
});

// POST /api/tasks/:id/retry — retry a completed/cancelled task
tasksRouter.post("/:id/retry", (req, res) => {
  const existing = taskStore.getTaskById(req.params.id);
  if (!existing) {
    return res.status(404).json({
      error: { code: "TASK_NOT_FOUND", message: "Task not found" },
    });
  }

  if (existing.status !== "Done" && existing.status !== "Cancelled") {
    return res.status(409).json({
      error: {
        code: "TASK_NOT_RETRYABLE",
        message: `Task status is ${existing.status}, can only retry Done/Cancelled tasks`,
      },
    });
  }

  // Create new task based on existing
  const now = Date.now();
  const newTask: Task = {
    id: crypto.randomUUID(),
    title: `${existing.title}(重试)`,
    description: existing.description,
    status: "Todo",
    agentId: existing.agentId,
    projectId: existing.projectId,
    parentTaskId: existing.id,
    priority: existing.priority,
    tags: [...existing.tags],
    eventCount: 0,
    turnCount: 0,
    budgetUsed: 0,
    maxTurns: existing.maxTurns,
    maxBudgetUsd: existing.maxBudgetUsd,
    createdAt: now,
  };

  taskStore.createTask(newTask);

  // Update agent taskCount
  const agent = agentStore.getAgentById(existing.agentId);
  if (agent) {
    agentStore.updateAgent(existing.agentId, { taskCount: agent.taskCount + 1 });
    broadcast("agent:update", agentStore.getAgentById(existing.agentId));
  }

  broadcast("task:update", newTask);
  res.status(201).json({ task: newTask });
});
