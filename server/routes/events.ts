import { Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as taskStore from "../store/taskStore.js";
import { eventProcessor } from "../services/eventProcessor.js";
import { handleHookEvent } from "../services/stuckDetector.js";
import type { Event, EventType } from "../store/types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const LOGS_DIR = path.resolve(process.cwd(), "data", "logs");
const MAX_TOOL_INPUT = 10 * 1024; // 10KB

// ---------------------------------------------------------------------------
// Hook event name → EventType mapping
// ---------------------------------------------------------------------------

const HOOK_EVENT_MAP: Record<string, EventType> = {
  SessionStart: "SessionStart",
  SessionEnd: "SessionEnd",
  PreToolUse: "PreToolUse",
  PostToolUse: "PostToolUse",
  Stop: "Stop",
  UserPromptSubmit: "UserPromptSubmit",
  Notification: "Notification",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(value: string | undefined, maxLen: number): string | undefined {
  if (!value) return undefined;
  return value.length > maxLen ? value.slice(0, maxLen) + "...[truncated]" : value;
}

function appendToHookLog(rawData: unknown): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
  const logPath = path.join(LOGS_DIR, "hooks.log");
  const line = JSON.stringify({ ...rawData, _receivedAt: Date.now() }) + "\n";
  fs.appendFileSync(logPath, line, "utf-8");
}

// ---------------------------------------------------------------------------
// Router — POST /event (no /api prefix, per requirement)
// ---------------------------------------------------------------------------

export const eventsRouter = Router();

eventsRouter.post("/event", (req, res) => {
  const {
    hook_event_name,
    session_id,
    cwd: _cwd,  // eslint-disable-line @typescript-eslint/no-unused-vars
    tool_name,
    tool_input,
    tool_output,
  } = req.body;

  // Map hook event name to internal EventType
  const eventType = HOOK_EVENT_MAP[hook_event_name];
  if (!eventType) {
    // Unknown hook event — acknowledge but ignore
    return res.json({ ok: true });
  }

  // Find task by SDK session_id
  const task = session_id
    ? taskStore.getTaskBySessionId(session_id)
    : undefined;

  if (!task) {
    // Can't associate with any task — log and acknowledge
    console.log(
      `[HookEvent] No task found for session_id=${session_id}, event=${hook_event_name}`,
    );
    appendToHookLog(req.body);
    return res.json({ ok: true });
  }

  // Build internal Event object
  const event: Event = {
    id: crypto.randomUUID(),
    taskId: task.id,
    sessionId: session_id || "unknown",
    eventType,
    source: "hook",
    toolName: tool_name,
    toolInput: truncate(
      typeof tool_input === "string" ? tool_input : JSON.stringify(tool_input),
      MAX_TOOL_INPUT,
    ),
    toolOutput: truncate(
      typeof tool_output === "string" ? tool_output : undefined,
      MAX_TOOL_INPUT,
    ),
    timestamp: Date.now(),
    raw: truncate(JSON.stringify(req.body), MAX_TOOL_INPUT) || "{}",
  };

  // Process through event pipeline
  eventProcessor.processEvent(event);

  // Supplementary stuck detection
  handleHookEvent(event);

  // Log raw hook data
  appendToHookLog(req.body);

  res.json({ ok: true });
});
