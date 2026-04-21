import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import request from "supertest";
import os from "node:os";
import { app, server, startServer } from "../app.js";
import * as taskStore from "../store/taskStore.js";
import * as agentStore from "../store/agentStore.js";

// ---------------------------------------------------------------------------
// Mocks — prevent real SDK calls during tests
// ---------------------------------------------------------------------------

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
// Task Action API Tests
// ---------------------------------------------------------------------------

describe("Task Action API", () => {
  let projectId: string;
  let agentId: string;

  beforeAll(async () => {
    if (!server.listening) {
      await startServer(0);
    }

    const projRes = await request(app).post("/api/projects").send({
      name: "action-test-proj",
      path: os.tmpdir(),
    });
    projectId = projRes.body.project.id;

    const agentRes = await request(app).post("/api/agents").send({
      name: "Action Tester",
      avatar: "🎯",
      role: "Testing task action endpoints",
      prompt: "You are a test agent for verifying task action API endpoints work correctly.",
    });
    agentId = agentRes.body.agent.id;
  });

  beforeEach(() => {
    // Reset agent to idle and enabled between tests
    agentStore.updateAgent(agentId, {
      status: "idle",
      isEnabled: true,
      currentTaskId: undefined,
    });

    // Clean up any leftover Running/Stuck tasks for this agent
    for (const t of taskStore.getAllTasks()) {
      if (t.agentId === agentId && (t.status === "Running" || t.status === "Stuck")) {
        taskStore.updateTask(t.id, {
          status: "Cancelled",
          completedAt: Date.now(),
          completedReason: "test_cleanup",
        });
      }
    }

    vi.clearAllMocks();
  });

  afterAll(() => {
    if (server.listening) {
      server.close();
    }
  });

  // Helper: create a Todo task
  async function createTodoTask(title = "Action Test Task") {
    const res = await request(app).post("/api/tasks").send({
      title,
      description: "A task for testing action endpoints like start, stop, done, and retry.",
      agentId,
      projectId,
    });
    return res.body.task;
  }

  // -------------------------------------------------------------------------
  // POST /api/tasks/:id/start
  // -------------------------------------------------------------------------

  describe("POST /api/tasks/:id/start", () => {
    it("starts a Todo task", async () => {
      const task = await createTodoTask();

      const res = await request(app).post(`/api/tasks/${task.id}/start`);

      expect(res.status).toBe(200);
      expect(res.body.task.status).toBe("Running");
      expect(res.body.task.startedAt).toBeDefined();
    });

    it("returns 404 for nonexistent task", async () => {
      const res = await request(app).post("/api/tasks/nonexistent/start");
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("TASK_NOT_FOUND");
    });

    it("rejects starting a non-Todo task", async () => {
      const task = await createTodoTask();
      taskStore.updateTask(task.id, { status: "Running", startedAt: Date.now() });

      const res = await request(app).post(`/api/tasks/${task.id}/start`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("TASK_NOT_TODO");
    });

    it("rejects if agent is disabled", async () => {
      agentStore.updateAgent(agentId, { isEnabled: false });
      const task = await createTodoTask();

      const res = await request(app).post(`/api/tasks/${task.id}/start`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("AGENT_DISABLED");

      // Clean up
      agentStore.updateAgent(agentId, { isEnabled: true });
    });

    it("updates agent to working status", async () => {
      // Reset agent to idle first
      agentStore.updateAgent(agentId, { status: "idle" });
      const task = await createTodoTask();

      await request(app).post(`/api/tasks/${task.id}/start`);

      const agent = agentStore.getAgentById(agentId);
      expect(agent?.status).toBe("working");
      expect(agent?.currentTaskId).toBe(task.id);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/tasks/:id/stop
  // -------------------------------------------------------------------------

  describe("POST /api/tasks/:id/stop", () => {
    it("stops a Running task", async () => {
      const task = await createTodoTask();
      taskStore.updateTask(task.id, { status: "Running", startedAt: Date.now() });
      agentStore.updateAgent(agentId, { status: "working", currentTaskId: task.id });

      const res = await request(app).post(`/api/tasks/${task.id}/stop`);

      expect(res.status).toBe(200);
      expect(res.body.task.status).toBe("Cancelled");
      expect(res.body.task.completedReason).toBe("user_cancelled");
    });

    it("returns 404 for nonexistent task", async () => {
      const res = await request(app).post("/api/tasks/nonexistent/stop");
      expect(res.status).toBe(404);
    });

    it("rejects stopping a Todo task", async () => {
      const task = await createTodoTask();

      const res = await request(app).post(`/api/tasks/${task.id}/stop`);
      expect(res.status).toBe(409);
    });

    it("sets agent back to idle", async () => {
      const task = await createTodoTask();
      taskStore.updateTask(task.id, { status: "Running", startedAt: Date.now() });
      agentStore.updateAgent(agentId, { status: "working", currentTaskId: task.id });

      await request(app).post(`/api/tasks/${task.id}/stop`);

      const agent = agentStore.getAgentById(agentId);
      expect(agent?.status).toBe("idle");
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/tasks/:id/done
  // -------------------------------------------------------------------------

  describe("POST /api/tasks/:id/done", () => {
    it("marks a Running task as Done", async () => {
      const task = await createTodoTask();
      taskStore.updateTask(task.id, { status: "Running", startedAt: Date.now() });
      agentStore.updateAgent(agentId, { status: "working", currentTaskId: task.id });

      const res = await request(app).post(`/api/tasks/${task.id}/done`);

      expect(res.status).toBe(200);
      expect(res.body.task.status).toBe("Done");
      expect(res.body.task.completedReason).toBe("user_done");
    });

    it("returns 404 for nonexistent task", async () => {
      const res = await request(app).post("/api/tasks/nonexistent/done");
      expect(res.status).toBe(404);
    });

    it("rejects for Todo task", async () => {
      const task = await createTodoTask();

      const res = await request(app).post(`/api/tasks/${task.id}/done`);
      expect(res.status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/tasks/:id/message
  // -------------------------------------------------------------------------

  describe("POST /api/tasks/:id/message", () => {
    it("returns 404 for nonexistent task", async () => {
      const res = await request(app)
        .post("/api/tasks/nonexistent/message")
        .send({ message: "hello" });

      expect(res.status).toBe(404);
    });

    it("rejects non-Stuck task", async () => {
      const task = await createTodoTask();

      const res = await request(app)
        .post(`/api/tasks/${task.id}/message`)
        .send({ message: "hello" });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("TASK_NOT_STUCK");
    });

    it("rejects empty message", async () => {
      const task = await createTodoTask();
      taskStore.updateTask(task.id, {
        status: "Stuck",
        sessionId: "test-session",
        stuckReason: "waiting for approval",
      });

      const res = await request(app)
        .post(`/api/tasks/${task.id}/message`)
        .send({ message: "" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("sends message to Stuck task and resumes", async () => {
      const task = await createTodoTask();
      taskStore.updateTask(task.id, {
        status: "Stuck",
        sessionId: "test-session-id",
        stuckReason: "waiting for approval",
      });
      agentStore.updateAgent(agentId, { status: "stuck" });

      const res = await request(app)
        .post(`/api/tasks/${task.id}/message`)
        .send({ message: "Continue with the task" });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify task is back to Running
      const updatedTask = taskStore.getTaskById(task.id);
      expect(updatedTask?.status).toBe("Running");

      // Verify agent is working
      const agent = agentStore.getAgentById(agentId);
      expect(agent?.status).toBe("working");
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/tasks/:id/approve-tool
  // -------------------------------------------------------------------------

  describe("POST /api/tasks/:id/approve-tool", () => {
    it("returns 404 for nonexistent task", async () => {
      const res = await request(app)
        .post("/api/tasks/nonexistent/approve-tool")
        .send({ decision: "allow" });

      expect(res.status).toBe(404);
    });

    it("rejects non-Stuck task", async () => {
      const task = await createTodoTask();

      const res = await request(app)
        .post(`/api/tasks/${task.id}/approve-tool`)
        .send({ decision: "allow" });

      expect(res.status).toBe(409);
    });

    it("rejects invalid decision", async () => {
      const task = await createTodoTask();
      taskStore.updateTask(task.id, { status: "Stuck", stuckReason: "tool approval" });

      const res = await request(app)
        .post(`/api/tasks/${task.id}/approve-tool`)
        .send({ decision: "maybe" });

      expect(res.status).toBe(400);
    });

    it("allows a tool and transitions to Running", async () => {
      const task = await createTodoTask();
      taskStore.updateTask(task.id, {
        status: "Stuck",
        stuckReason: "Write tool needs approval",
      });
      agentStore.updateAgent(agentId, { status: "stuck" });

      const res = await request(app)
        .post(`/api/tasks/${task.id}/approve-tool`)
        .send({ decision: "allow" });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify task is Running
      const updatedTask = taskStore.getTaskById(task.id);
      expect(updatedTask?.status).toBe("Running");

      const agent = agentStore.getAgentById(agentId);
      expect(agent?.status).toBe("working");
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/tasks/:id/retry
  // -------------------------------------------------------------------------

  describe("POST /api/tasks/:id/retry", () => {
    it("creates a retry task from a Done task", async () => {
      const task = await createTodoTask("Original Task");
      taskStore.updateTask(task.id, {
        status: "Done",
        completedAt: Date.now(),
        completedReason: "sdk_result",
        budgetUsed: 0.5,
      });

      const res = await request(app).post(`/api/tasks/${task.id}/retry`);

      expect(res.status).toBe(201);
      expect(res.body.task.title).toBe("Original Task(重试)");
      expect(res.body.task.status).toBe("Todo");
      expect(res.body.task.parentTaskId).toBe(task.id);
      expect(res.body.task.agentId).toBe(agentId);
      expect(res.body.task.projectId).toBe(projectId);
      expect(res.body.task.budgetUsed).toBe(0);
      expect(res.body.task.eventCount).toBe(0);
    });

    it("creates a retry task from a Cancelled task", async () => {
      const task = await createTodoTask("Cancelled Task");
      taskStore.updateTask(task.id, {
        status: "Cancelled",
        completedAt: Date.now(),
        completedReason: "user_cancelled",
      });

      const res = await request(app).post(`/api/tasks/${task.id}/retry`);

      expect(res.status).toBe(201);
      expect(res.body.task.title).toContain("重试");
    });

    it("returns 404 for nonexistent task", async () => {
      const res = await request(app).post("/api/tasks/nonexistent/retry");
      expect(res.status).toBe(404);
    });

    it("rejects retry for Todo task", async () => {
      const task = await createTodoTask();

      const res = await request(app).post(`/api/tasks/${task.id}/retry`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("TASK_NOT_RETRYABLE");
    });

    it("rejects retry for Running task", async () => {
      const task = await createTodoTask();
      taskStore.updateTask(task.id, { status: "Running", startedAt: Date.now() });

      const res = await request(app).post(`/api/tasks/${task.id}/retry`);
      expect(res.status).toBe(409);
    });

    it("increments agent taskCount", async () => {
      const task = await createTodoTask("Count Retry");
      taskStore.updateTask(task.id, {
        status: "Done",
        completedAt: Date.now(),
        completedReason: "sdk_result",
      });

      const agentBefore = agentStore.getAgentById(agentId);

      await request(app).post(`/api/tasks/${task.id}/retry`);

      const agentAfter = agentStore.getAgentById(agentId);
      expect(agentAfter!.taskCount).toBe(agentBefore!.taskCount + 1);
    });

    it("preserves original task tags and config", async () => {
      const task = await createTodoTask();
      taskStore.updateTask(task.id, {
        status: "Done",
        completedAt: Date.now(),
        completedReason: "sdk_result",
      });
      // Update task with custom config
      taskStore.updateTask(task.id, {
        tags: ["important", "data"],
        maxTurns: 50,
        maxBudgetUsd: 1.0,
        priority: 2,
      });

      const res = await request(app).post(`/api/tasks/${task.id}/retry`);

      expect(res.body.task.tags).toEqual(["important", "data"]);
      expect(res.body.task.maxTurns).toBe(50);
      expect(res.body.task.maxBudgetUsd).toBe(1.0);
      expect(res.body.task.priority).toBe(2);
    });
  });
});
