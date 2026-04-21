import { describe, it, expect, beforeAll, vi, beforeEach } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { app, server, startServer } from "../app.js";
import * as taskStore from "../store/taskStore.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockProcessEvent = vi.fn().mockReturnValue(true);
const mockHandleHookEvent = vi.fn();

vi.mock("../services/eventProcessor.js", () => ({
  eventProcessor: {
    processEvent: (...args: unknown[]) => mockProcessEvent(...args),
    reset: vi.fn(),
    getProcessedCount: vi.fn().mockReturnValue(0),
  },
}));

vi.mock("../services/stuckDetector.js", () => ({
  handleHookEvent: (...args: unknown[]) => mockHandleHookEvent(...args),
  isPermissionPrompt: vi.fn().mockReturnValue(false),
}));

vi.mock("../services/sdkSessionManager.js", () => ({
  sdkSessionManager: {
    startTask: vi.fn().mockResolvedValue(undefined),
    stopTask: vi.fn(),
    resumeTask: vi.fn().mockResolvedValue(undefined),
    getActiveTaskCount: vi.fn().mockReturnValue(0),
    getByTaskId: vi.fn().mockReturnValue(undefined),
    hasActiveTask: vi.fn().mockReturnValue(false),
    stopAll: vi.fn(),
  },
}));

vi.mock("../sdk/queryWrapper.js", () => ({
  resolveToolDecision: vi.fn().mockReturnValue(true),
  isAutoAllowed: vi.fn(),
  summarizeToolInput: vi.fn(),
  createCanUseToolCallback: vi.fn(),
  startQuery: vi.fn(),
  resumeQuery: vi.fn(),
  cleanupQuery: vi.fn(),
  hasPendingApproval: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOGS_DIR = path.resolve(process.cwd(), "data", "logs");

// ---------------------------------------------------------------------------
// Hook Events API Tests
// ---------------------------------------------------------------------------

describe("Hook Events API — POST /event", () => {
  let projectId: string;
  let agentId: string;
  let taskId: string;
  const sessionId = crypto.randomUUID();

  beforeAll(async () => {
    if (!server.listening) {
      await startServer(0);
    }

    const projRes = await request(app).post("/api/projects").send({
      name: "hook-events-proj",
      path: os.tmpdir(),
    });
    projectId = projRes.body.project.id;

    const agentRes = await request(app).post("/api/agents").send({
      name: "Hook Events Tester",
      avatar: "🪝",
      role: "Testing hook events endpoint",
      prompt: "You are a test agent for verifying the hook events API endpoint works correctly.",
    });
    agentId = agentRes.body.agent.id;

    const taskRes = await request(app).post("/api/tasks").send({
      title: "Hook Events Test Task",
      description: "Testing the hook events API endpoint for receiving Claude Code hook events",
      agentId,
      projectId,
    });
    taskId = taskRes.body.task.id;

    // Set session_id on the task
    taskStore.updateTask(taskId, { sessionId, status: "Running" });
  });

  beforeEach(() => {
    mockProcessEvent.mockClear();
    mockHandleHookEvent.mockClear();
  });

  it("returns { ok: true } for valid hook event", async () => {
    const res = await request(app).post("/event").send({
      hook_event_name: "PreToolUse",
      session_id: sessionId,
      tool_name: "Bash",
      tool_input: "echo hello",
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("processes event through eventProcessor", async () => {
    await request(app).post("/event").send({
      hook_event_name: "PreToolUse",
      session_id: sessionId,
      tool_name: "Read",
      tool_input: "/path/to/file",
    });

    expect(mockProcessEvent).toHaveBeenCalledTimes(1);
    const event = mockProcessEvent.mock.calls[0][0];
    expect(event.taskId).toBe(taskId);
    expect(event.source).toBe("hook");
    expect(event.eventType).toBe("PreToolUse");
    expect(event.toolName).toBe("Read");
  });

  it("calls stuckDetector for supplementary detection", async () => {
    await request(app).post("/event").send({
      hook_event_name: "Notification",
      session_id: sessionId,
      tool_output: "Claude wants to execute bash",
    });

    expect(mockHandleHookEvent).toHaveBeenCalledTimes(1);
  });

  it("ignores unknown hook event names", async () => {
    const res = await request(app).post("/event").send({
      hook_event_name: "UnknownEvent",
      session_id: sessionId,
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockProcessEvent).not.toHaveBeenCalled();
  });

  it("returns ok when session_id has no matching task", async () => {
    const res = await request(app).post("/event").send({
      hook_event_name: "PreToolUse",
      session_id: "nonexistent-session-id",
      tool_name: "Bash",
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockProcessEvent).not.toHaveBeenCalled();
  });

  it("returns ok when session_id is missing", async () => {
    const res = await request(app).post("/event").send({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockProcessEvent).not.toHaveBeenCalled();
  });

  it("truncates long tool_input to 10KB", async () => {
    const longInput = "x".repeat(20 * 1024); // 20KB
    await request(app).post("/event").send({
      hook_event_name: "PreToolUse",
      session_id: sessionId,
      tool_name: "Bash",
      tool_input: longInput,
    });

    const event = mockProcessEvent.mock.calls[0][0];
    expect(event.toolInput.length).toBeLessThanOrEqual(10 * 1024 + 20); // 10KB + truncation suffix
  });

  it("writes raw data to hooks.log", async () => {
    // Clean log if exists
    const logPath = path.join(LOGS_DIR, "hooks.log");
    if (fs.existsSync(logPath)) fs.unlinkSync(logPath);

    await request(app).post("/event").send({
      hook_event_name: "PreToolUse",
      session_id: sessionId,
      tool_name: "Bash",
      tool_input: "echo test",
    });

    expect(fs.existsSync(logPath)).toBe(true);
    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const parsed = JSON.parse(lines[lines.length - 1]);
    expect(parsed.hook_event_name).toBe("PreToolUse");
    expect(parsed.tool_name).toBe("Bash");
  });

  it("maps all known hook event names to EventTypes", async () => {
    const hookEvents = [
      "SessionStart",
      "SessionEnd",
      "PreToolUse",
      "PostToolUse",
      "Stop",
      "UserPromptSubmit",
      "Notification",
    ];

    for (const hookName of hookEvents) {
      mockProcessEvent.mockClear();
      await request(app).post("/event").send({
        hook_event_name: hookName,
        session_id: sessionId,
      });
      expect(mockProcessEvent).toHaveBeenCalledTimes(1);
      expect(mockProcessEvent.mock.calls[0][0].eventType).toBe(hookName);
    }
  });
});
