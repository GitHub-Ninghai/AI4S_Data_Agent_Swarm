import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type { Query, Options, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { Task, Agent } from "../store/types.js";
import * as taskStore from "../store/taskStore.js";
import * as agentStore from "../store/agentStore.js";
import { broadcast } from "../services/wsBroadcaster.js";
import { resolveAgentCapabilityRuntime } from "../services/capabilityRuntime.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolApprovalRequest {
  taskId: string;
  sessionId: string;
  toolName: string;
  toolInput: string;
  toolUseId: string;
  timestamp: number;
}

export interface StartQueryResult {
  stream: Query;
  abortController: AbortController;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const TOOL_APPROVAL_TIMEOUT_MS = parseInt(
  process.env.TOOL_APPROVAL_TIMEOUT_MS || "300000",
  10,
);

// Auto-approve all tools (set to true to disable all tool approval prompts)
const AUTO_APPROVE_ALL_TOOLS = process.env.AUTO_APPROVE_ALL_TOOLS !== "false";

// ---------------------------------------------------------------------------
// Dangerous Bash command patterns
// ---------------------------------------------------------------------------

const DANGEROUS_BASH_PATTERNS = [
  "rm -rf",
  "rm -r /",
  "format",
  "del /s",
  "shutdown",
  "rmdir /s",
  "mkfs",
  "dd if=",
];

// ---------------------------------------------------------------------------
// Pending decisions — taskId → resolve function
// ---------------------------------------------------------------------------

const pendingDecisions = new Map<
  string,
  {
    resolve: (decision: "allow" | "deny") => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

// ---------------------------------------------------------------------------
// Auto-allow cache — taskId → Set of approved tool signatures
// ---------------------------------------------------------------------------

const autoAllowCache = new Map<string, Set<string>>();

// ---------------------------------------------------------------------------
// isAutoAllowed — determines if a tool call should be auto-approved
// ---------------------------------------------------------------------------

export function isAutoAllowed(
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  // If AUTO_APPROVE_ALL_TOOLS is enabled, auto-approve everything except dangerous Bash commands
  if (AUTO_APPROVE_ALL_TOOLS) {
    // Bash: still check for dangerous patterns even in auto-approve mode
    if (toolName === "Bash") {
      const cmd = String(input.command || "");
      if (DANGEROUS_BASH_PATTERNS.some((pattern) => cmd.includes(pattern))) {
        console.warn(`[SDK] Dangerous Bash command blocked: ${cmd}`);
        return false;
      }
    }
    return true;
  }

  // Default behavior (when AUTO_APPROVE_ALL_TOOLS is false):
  // Read-only tools are always auto-allowed
  if (toolName === "Read" || toolName === "Glob" || toolName === "Grep") {
    return true;
  }

  // Bash: auto-allow unless the command contains dangerous patterns
  if (toolName === "Bash") {
    const cmd = String(input.command || "");
    return !DANGEROUS_BASH_PATTERNS.some((pattern) => cmd.includes(pattern));
  }

  // All other tools require approval
  return false;
}

// ---------------------------------------------------------------------------
// Tool input summariser — truncate for display
// ---------------------------------------------------------------------------

export function summarizeToolInput(
  input: Record<string, unknown>,
  maxLen: number = 200,
): string {
  try {
    const json = JSON.stringify(input);
    return json.length > maxLen ? json.slice(0, maxLen) + "..." : json;
  } catch {
    return String(input);
  }
}

// ---------------------------------------------------------------------------
// Compute a simple hash for auto-allow cache key
// ---------------------------------------------------------------------------

function toolSignature(toolName: string, input: Record<string, unknown>): string {
  return `${toolName}:${summarizeToolInput(input, 100)}`;
}

// ---------------------------------------------------------------------------
// Mark task as stuck
// ---------------------------------------------------------------------------

function markTaskStuck(taskId: string, reason: string): void {
  const task = taskStore.getTaskById(taskId);
  if (!task || task.status === "Stuck") return;

  taskStore.updateTask(taskId, {
    status: "Stuck",
    stuckReason: reason,
  });

  // Update agent status to stuck
  if (task.agentId) {
    agentStore.updateAgent(task.agentId, { status: "stuck" });
  }

  broadcast("task:update", {
    id: taskId,
    status: "Stuck",
    stuckReason: reason,
  });
}

// ---------------------------------------------------------------------------
// Broadcast tool approval request to frontend
// ---------------------------------------------------------------------------

function broadcastToolApproval(
  taskId: string,
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolUseId: string,
): void {
  broadcast("tool:approval", {
    taskId,
    sessionId,
    toolName,
    toolInput: summarizeToolInput(toolInput),
    toolUseId,
    timestamp: Date.now(),
  } satisfies ToolApprovalRequest);
}

// ---------------------------------------------------------------------------
// resolveToolDecision — called by the approve-tool API route
// ---------------------------------------------------------------------------

export function resolveToolDecision(
  taskId: string,
  decision: "allow" | "deny",
): boolean {
  const pending = pendingDecisions.get(taskId);
  if (!pending) return false;

  clearTimeout(pending.timer);
  pendingDecisions.delete(taskId);
  pending.resolve(decision);

  // If allowed, add to auto-allow cache so same tool won't be asked again
  if (decision === "allow") {
    // We don't have the original toolName/input here, but the cache is
    // populated inside createCanUseToolCallback
  }

  return true;
}

// ---------------------------------------------------------------------------
// Wait for user decision with timeout
// ---------------------------------------------------------------------------

function waitForUserDecision(
  taskId: string,
  toolName: string,
  _toolInput: Record<string, unknown>,
): Promise<"allow" | "deny"> {
  return new Promise<"allow" | "deny">((resolve) => {
    const timer = setTimeout(() => {
      pendingDecisions.delete(taskId);
      broadcast("notification", {
        taskId,
        message: `Tool approval timed out for "${toolName}", auto-denied`,
        level: "warning",
      });
      resolve("deny");
    }, TOOL_APPROVAL_TIMEOUT_MS);

    pendingDecisions.set(taskId, { resolve, timer });
  });
}

// ---------------------------------------------------------------------------
// createCanUseToolCallback — factory for the SDK canUseTool callback
// ---------------------------------------------------------------------------

export function createCanUseToolCallback(
  taskId: string,
  sessionId: string,
): (toolName: string, input: Record<string, unknown>, options: {
  signal: AbortSignal;
  suggestions?: unknown[];
  blockedPath?: string;
  decisionReason?: string;
  toolUseID: string;
  agentID?: string;
}) => Promise<PermissionResult> {
  // Ensure auto-allow cache exists for this task
  if (!autoAllowCache.has(taskId)) {
    autoAllowCache.set(taskId, new Set());
  }

  return async (toolName, input, options) => {
    const toolUseId = options.toolUseID;

    // 1. Check auto-allow rules
    if (isAutoAllowed(toolName, input)) {
      return {
        behavior: "allow",
        updatedInput: input,
        toolUseID: toolUseId,
      };
    }

    // 2. Check auto-allow cache (previously approved by user)
    const cache = autoAllowCache.get(taskId);
    const sig = toolSignature(toolName, input);
    if (cache?.has(sig)) {
      return {
        behavior: "allow",
        updatedInput: input,
        toolUseID: toolUseId,
      };
    }

    // 3. Needs human approval → mark Stuck, broadcast, wait
    const reason = `${toolName}: ${summarizeToolInput(input)}`;
    markTaskStuck(taskId, reason);
    broadcastToolApproval(taskId, sessionId, toolName, input, toolUseId);

    // 4. Wait for user decision with timeout
    const decision = await waitForUserDecision(taskId, toolName, input);

    // 5. If allowed, cache for future auto-approval
    if (decision === "allow" && cache) {
      cache.add(sig);
    }

    if (decision === "allow") {
      return {
        behavior: "allow",
        updatedInput: input,
        toolUseID: toolUseId,
      };
    }

    return {
      behavior: "deny",
      message: `Tool "${toolName}" was denied by user or timed out.`,
      toolUseID: toolUseId,
    };
  };
}

// ---------------------------------------------------------------------------
// Apply agent-specific overrides to SDK options
// ---------------------------------------------------------------------------

function applyAgentOverrides(options: Options, agent: Agent): void {
  // 1. Model override
  if (agent.model) {
    (options as Record<string, unknown>).model = agent.model;
  }

  // 2. API credentials override — pass via env to Claude Code subprocess
  // All Claude Code compatible providers (GLM, DeepSeek, Mimo, MiniMax) use
  // ANTHROPIC_AUTH_TOKEN. Anthropic official uses ANTHROPIC_API_KEY.
  // We set both so the key works regardless of provider.
  // IMPORTANT: Always pass process.env to ensure PATH is available for spawning node.
  const env: Record<string, string | undefined> = { ...process.env as Record<string, string | undefined> };
  if (agent.apiKey) {
    env.ANTHROPIC_API_KEY = agent.apiKey;
    env.ANTHROPIC_AUTH_TOKEN = agent.apiKey;
  }
  if (agent.apiBaseUrl) {
    env.ANTHROPIC_BASE_URL = agent.apiBaseUrl;
  }
  // Always set env to ensure PATH is inherited, fixing "spawn node ENOENT" error
  options.env = env;
}

// ---------------------------------------------------------------------------
// startQuery — main entry point
// ---------------------------------------------------------------------------

export async function startQuery(
  task: Task,
  agent: Agent,
  projectDir: string,
): Promise<StartQueryResult> {
  const abortController = new AbortController();

  const capabilityRuntime = resolveAgentCapabilityRuntime(agent.id);

  // Build system prompt
  const systemPrompt: Options["systemPrompt"] = {
    type: "preset",
    preset: "claude_code",
    append: [
      agent.prompt,
      capabilityRuntime.promptAppend,
      `[Project Working Directory]\nYour current working directory is: ${projectDir}\nAll output files must be written within this directory (or a subdirectory of it). Do NOT create files outside this path.`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };

  // Build canUseTool callback
  // We need a session ID for broadcasting; we'll use a placeholder until
  // the SDKInit message provides the real one
  const placeholderSessionId = `pending-${task.id}`;
  const canUseTool = createCanUseToolCallback(task.id, placeholderSessionId);

  // Determine tools
  const tools = agent.allowedTools && agent.allowedTools.length > 0
    ? Array.from(new Set([...agent.allowedTools, ...capabilityRuntime.allowedTools]))
    : capabilityRuntime.allowedTools.length > 0
      ? capabilityRuntime.allowedTools
    : undefined;

  const options: Options = {
    abortController,
    systemPrompt,
    cwd: projectDir,
    maxTurns: task.maxTurns || agent.maxTurns || undefined,
    maxBudgetUsd: task.maxBudgetUsd || agent.maxBudgetUsd || undefined,
    canUseTool,
    permissionMode: "default",
  };

  if (tools) {
    options.allowedTools = tools;
  }

  if (capabilityRuntime.mcpServers) {
    options.mcpServers = capabilityRuntime.mcpServers;
  }

  applyAgentOverrides(options, agent);

  // Debug log SDK options
  console.log(`[SDK] Starting query for task ${task.id}:`);
  console.log(`  - maxTurns: ${options.maxTurns}, maxBudgetUsd: ${options.maxBudgetUsd}`);
  console.log(`  - model: ${options.model || 'default'}, cwd: ${projectDir}`);
  console.log(`  - env PATH: ${options.env?.PATH ? 'set' : 'NOT SET (will cause spawn failure)'}`);

  const stream = sdkQuery({
    prompt: task.description,
    options,
  });

  return { stream, abortController };
}

// ---------------------------------------------------------------------------
// Resume query — resume a session with user message
// ---------------------------------------------------------------------------

export async function resumeQuery(
  sessionId: string,
  message: string,
  task: Task,
  agent: Agent,
  projectDir: string,
): Promise<StartQueryResult> {
  const abortController = new AbortController();

  const canUseTool = createCanUseToolCallback(task.id, sessionId);
  const capabilityRuntime = resolveAgentCapabilityRuntime(agent.id);

  const options: Options = {
    abortController,
    resume: sessionId,
    cwd: projectDir,
    maxTurns: task.maxTurns || agent.maxTurns || undefined,
    maxBudgetUsd: task.maxBudgetUsd || agent.maxBudgetUsd || undefined,
    canUseTool,
    permissionMode: "default",
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: [
        agent.prompt,
        capabilityRuntime.promptAppend,
        `[Project Working Directory]\nYour current working directory is: ${projectDir}\nAll output files must be written within this directory (or a subdirectory of it). Do NOT create files outside this path.`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  };

  const resumeTools = agent.allowedTools && agent.allowedTools.length > 0
    ? Array.from(new Set([...agent.allowedTools, ...capabilityRuntime.allowedTools]))
    : capabilityRuntime.allowedTools.length > 0
      ? capabilityRuntime.allowedTools
      : undefined;

  if (resumeTools) {
    options.allowedTools = resumeTools;
  }

  if (capabilityRuntime.mcpServers) {
    options.mcpServers = capabilityRuntime.mcpServers;
  }

  applyAgentOverrides(options, agent);

  const stream = sdkQuery({
    prompt: message,
    options,
  });

  return { stream, abortController };
}

// ---------------------------------------------------------------------------
// Cleanup — remove pending state for a completed/cancelled task
// ---------------------------------------------------------------------------

export function cleanupQuery(taskId: string): void {
  // Clear pending decisions
  const pending = pendingDecisions.get(taskId);
  if (pending) {
    clearTimeout(pending.timer);
    pending.resolve("deny");
    pendingDecisions.delete(taskId);
  }

  // Clear auto-allow cache
  autoAllowCache.delete(taskId);
}

// ---------------------------------------------------------------------------
// Query status — check if a task has a pending tool approval
// ---------------------------------------------------------------------------

export function hasPendingApproval(taskId: string): boolean {
  return pendingDecisions.has(taskId);
}

// ---------------------------------------------------------------------------
// Update session ID in canUseTool callback context
// After receiving SDKInit, call this to update the session ID
// ---------------------------------------------------------------------------

// The canUseTool callback is created with a placeholder sessionId.
// Since the callback is a closure, we can update the sessionId reference
// by having the caller re-create the callback. However, for simplicity,
// the broadcast will use the taskId which is sufficient for the frontend
// to identify the context.
