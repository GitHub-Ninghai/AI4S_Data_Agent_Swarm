import { describe, it, expect, vi, beforeEach } from "vitest";
import { sdkSessionManager } from "./sdkSessionManager.js";
import * as taskStore from "../store/taskStore.js";
import * as agentStore from "../store/agentStore.js";
import * as sessionStore from "../store/sessionStore.js";
import type { Task, Agent } from "../store/types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../store/taskStore.js", () => ({
  getTaskById: vi.fn(),
  updateTask: vi.fn(),
  getAllTasks: vi.fn(() => []),
}));

vi.mock("../store/agentStore.js", () => ({
  getAgentById: vi.fn(),
  updateAgent: vi.fn(),
}));

vi.mock("../store/sessionStore.js", () => ({
  getSessionByTaskId: vi.fn(),
  setAbortController: vi.fn(),
  updateSession: vi.fn(),
}));

vi.mock("../services/wsBroadcaster.js", () => ({
  broadcast: vi.fn(),
}));

vi.mock("../sdk/queryWrapper.js", () => ({
  startQuery: vi.fn(),
  resumeQuery: vi.fn(),
  cleanupQuery: vi.fn(),
}));

vi.mock("../sdk/messageParser.js", () => ({
  parseMessage: vi.fn(() => []),
  extractSessionId: vi.fn(() => undefined),
  extractCostInfo: vi.fn(() => undefined),
}));

import { startQuery, resumeQuery, cleanupQuery } from "../sdk/queryWrapper.js";
import { parseMessage, extractSessionId, extractCostInfo } from "../sdk/messageParser.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SDKSessionManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkSessionManager.stopAll();
  });

  const mockTask: Task = {
    id: "task-1",
    title: "Test Task",
    description: "A test task",
    status: "Todo",
    agentId: "agent-1",
    projectId: "project-1",
    priority: 1,
    tags: [],
    eventCount: 0,
    turnCount: 0,
    budgetUsed: 0,
    maxTurns: 100,
    maxBudgetUsd: 5,
    createdAt: Date.now(),
  };

  const mockAgent: Agent = {
    id: "agent-1",
    name: "Test Agent",
    avatar: "🤖",
    role: "Tester",
    prompt: "You are a test agent.",
    isEnabled: true,
    status: "idle",
    taskCount: 1,
    stats: {
      totalTasksCompleted: 0,
      totalTasksCancelled: 0,
      totalCostUsd: 0,
      avgDurationMs: 0,
    },
    lastEventAt: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // -----------------------------------------------------------------------
  // startTask
  // -----------------------------------------------------------------------

  describe("startTask", () => {
    it("registers active query and starts consuming stream", async () => {
      const mockStream = (async function* () {
        // empty stream
      })();

      (startQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
        stream: mockStream,
        abortController: new AbortController(),
      });

      (sessionStore.getSessionByTaskId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      await sdkSessionManager.startTask(mockTask, mockAgent, "/test/dir");

      expect(startQuery).toHaveBeenCalledWith(mockTask, mockAgent, "/test/dir");
      expect(sdkSessionManager.hasActiveTask("task-1")).toBe(true);
      expect(sdkSessionManager.getByTaskId("task-1")).toBeDefined();
      expect(sdkSessionManager.getByTaskId("task-1")!.stream).toBe(mockStream);
    });

    it("stores AbortController in sessionStore if session exists", async () => {
      const abortController = new AbortController();
      const mockStream = (async function* () {})();

      (startQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
        stream: mockStream,
        abortController,
      });

      (sessionStore.getSessionByTaskId as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "session-1",
        taskId: "task-1",
      });

      await sdkSessionManager.startTask(mockTask, mockAgent, "/test/dir");

      expect(sessionStore.setAbortController).toHaveBeenCalledWith("session-1", abortController);
    });
  });

  // -----------------------------------------------------------------------
  // stopTask
  // -----------------------------------------------------------------------

  describe("stopTask", () => {
    it("aborts the active query and cleans up", async () => {
      const abortController = new AbortController();
      const mockStream = (async function* () {})();

      (startQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
        stream: mockStream,
        abortController,
      });

      (sessionStore.getSessionByTaskId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      await sdkSessionManager.startTask(mockTask, mockAgent, "/test/dir");
      expect(sdkSessionManager.hasActiveTask("task-1")).toBe(true);

      sdkSessionManager.stopTask("task-1");

      expect(abortController.signal.aborted).toBe(true);
      expect(cleanupQuery).toHaveBeenCalledWith("task-1");
      expect(sdkSessionManager.hasActiveTask("task-1")).toBe(false);
    });

    it("handles stopTask when task is not active", () => {
      expect(() => sdkSessionManager.stopTask("nonexistent")).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // bindSession
  // -----------------------------------------------------------------------

  describe("bindSession", () => {
    it("binds session ID to task and creates reverse mapping", async () => {
      const abortController = new AbortController();
      const mockStream = (async function* () {})();

      (startQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
        stream: mockStream,
        abortController,
      });

      (sessionStore.getSessionByTaskId as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "session-old",
        taskId: "task-1",
      });

      await sdkSessionManager.startTask(mockTask, mockAgent, "/test/dir");

      sdkSessionManager.bindSession("task-1", "sdk-session-123");

      expect(taskStore.updateTask).toHaveBeenCalledWith("task-1", {
        sessionId: "sdk-session-123",
      });

      expect(sessionStore.updateSession).toHaveBeenCalledWith("session-old", {
        status: "active",
      });

      expect(sdkSessionManager.getTaskIdBySession("sdk-session-123")).toBe("task-1");

      const entry = sdkSessionManager.getByTaskId("task-1");
      expect(entry?.sessionId).toBe("sdk-session-123");
    });
  });

  // -----------------------------------------------------------------------
  // Query methods
  // -----------------------------------------------------------------------

  describe("query methods", () => {
    it("getByTaskId returns undefined for nonexistent task", () => {
      expect(sdkSessionManager.getByTaskId("nonexistent")).toBeUndefined();
    });

    it("getTaskIdBySession returns undefined for unknown session", () => {
      expect(sdkSessionManager.getTaskIdBySession("unknown-session")).toBeUndefined();
    });

    it("getActiveTaskCount returns correct count", async () => {
      expect(sdkSessionManager.getActiveTaskCount()).toBe(0);

      const mockStream = (async function* () {})();
      (startQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
        stream: mockStream,
        abortController: new AbortController(),
      });
      (sessionStore.getSessionByTaskId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      await sdkSessionManager.startTask(mockTask, mockAgent, "/test");
      expect(sdkSessionManager.getActiveTaskCount()).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // stopAll
  // -----------------------------------------------------------------------

  describe("stopAll", () => {
    it("stops all active queries", async () => {
      const mockStream = (async function* () {})();
      (startQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
        stream: mockStream,
        abortController: new AbortController(),
      });
      (sessionStore.getSessionByTaskId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      await sdkSessionManager.startTask(mockTask, mockAgent, "/test");
      sdkSessionManager.stopAll();

      expect(sdkSessionManager.getActiveTaskCount()).toBe(0);
      expect(sdkSessionManager.getByTaskId("task-1")).toBeUndefined();
    });
  });
});
