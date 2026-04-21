import { describe, it, expect, vi, beforeEach } from "vitest";
import * as taskStore from "../store/taskStore.js";
import * as agentStore from "../store/agentStore.js";
import * as projectStore from "../store/projectStore.js";
import { taskManager, TaskManagerError } from "./taskManager.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../services/wsBroadcaster.js", () => ({
  broadcast: vi.fn(),
}));

vi.mock("./sdkSessionManager.js", () => ({
  sdkSessionManager: {
    startTask: vi.fn().mockResolvedValue(undefined),
    stopTask: vi.fn(),
    getActiveTaskCount: vi.fn().mockReturnValue(0),
    getByTaskId: vi.fn().mockReturnValue(undefined),
    hasActiveTask: vi.fn().mockReturnValue(false),
    stopAll: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<agentStore.Agent> = {}) {
  return {
    id: "agent-1",
    name: "Test Agent",
    avatar: "🤖",
    role: "Tester",
    prompt: "You are a test agent for unit testing.",
    isEnabled: true,
    status: "idle" as const,
    taskCount: 0,
    stats: {
      totalTasksCompleted: 0,
      totalTasksCancelled: 0,
      totalCostUsd: 0,
      avgDurationMs: 0,
    },
    lastEventAt: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeTask(overrides: Partial<taskStore.Task> = {}) {
  return {
    id: "task-1",
    title: "Test Task",
    description: "A test task for unit testing purposes.",
    status: "Todo" as const,
    agentId: "agent-1",
    projectId: "project-1",
    priority: 1 as const,
    tags: [],
    eventCount: 0,
    turnCount: 0,
    budgetUsed: 0,
    maxTurns: 200,
    maxBudgetUsd: 5.0,
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeProject(overrides: Partial<projectStore.Project> = {}) {
  return {
    id: "project-1",
    name: "test-project",
    path: process.cwd(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TaskManager", () => {
  beforeEach(() => {
    // Clear stores
    for (const t of taskStore.getAllTasks()) taskStore.deleteTask(t.id);
    for (const a of agentStore.getAllAgents()) agentStore.deleteAgent(a.id);
    for (const p of projectStore.getAllProjects()) projectStore.deleteProject(p.id);

    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // startTask
  // -------------------------------------------------------------------------

  describe("startTask", () => {
    it("should transition Todo → Running and Agent → working", async () => {
      const agent = makeAgent();
      const project = makeProject();
      const task = makeTask();

      agentStore.createAgent(agent);
      projectStore.createProject(project);
      taskStore.createTask(task);

      await taskManager.startTask(task.id);

      const updatedTask = taskStore.getTaskById(task.id);
      expect(updatedTask?.status).toBe("Running");
      expect(updatedTask?.startedAt).toBeDefined();

      const updatedAgent = agentStore.getAgentById(agent.id);
      expect(updatedAgent?.status).toBe("working");
      expect(updatedAgent?.currentTaskId).toBe(task.id);
    });

    it("should throw TASK_NOT_FOUND for non-existent task", async () => {
      await expect(taskManager.startTask("nonexistent")).rejects.toThrow(TaskManagerError);
      await expect(taskManager.startTask("nonexistent")).rejects.toMatchObject({
        code: "TASK_NOT_FOUND",
        statusCode: 404,
      });
    });

    it("should reject if Task is not Todo", async () => {
      const agent = makeAgent();
      const project = makeProject();
      const task = makeTask({ status: "Running" });

      agentStore.createAgent(agent);
      projectStore.createProject(project);
      taskStore.createTask(task);

      await expect(taskManager.startTask(task.id)).rejects.toMatchObject({
        code: "TASK_NOT_TODO",
        statusCode: 409,
      });
    });

    it("should reject if Agent is disabled", async () => {
      const agent = makeAgent({ isEnabled: false });
      const project = makeProject();
      const task = makeTask();

      agentStore.createAgent(agent);
      projectStore.createProject(project);
      taskStore.createTask(task);

      await expect(taskManager.startTask(task.id)).rejects.toMatchObject({
        code: "AGENT_DISABLED",
      });
    });

    it("should reject if Agent is busy (not idle)", async () => {
      const agent = makeAgent({ status: "working" });
      const project = makeProject();
      const task = makeTask();

      agentStore.createAgent(agent);
      projectStore.createProject(project);
      taskStore.createTask(task);

      await expect(taskManager.startTask(task.id)).rejects.toMatchObject({
        code: "AGENT_BUSY",
      });
    });

    it("should reject with task title when Agent has active task", async () => {
      const agent = makeAgent();
      const project = makeProject();
      const activeTask = makeTask({
        id: "task-active",
        title: "正在执行的任务",
        status: "Running",
        startedAt: Date.now(),
      });
      const newTask = makeTask({ id: "task-new" });

      agentStore.createAgent(agent);
      projectStore.createProject(project);
      taskStore.createTask(activeTask);
      taskStore.createTask(newTask);

      await expect(taskManager.startTask(newTask.id)).rejects.toMatchObject({
        code: "AGENT_BUSY",
        statusCode: 409,
        message: expect.stringContaining("正在执行的任务"),
      });
    });

    it("should reject when system concurrent limit reached", async () => {
      const { sdkSessionManager } = await import("./sdkSessionManager.js");
      vi.mocked(sdkSessionManager.getActiveTaskCount).mockReturnValue(10);

      const agent = makeAgent();
      const project = makeProject();
      const task = makeTask();

      agentStore.createAgent(agent);
      projectStore.createProject(project);
      taskStore.createTask(task);

      await expect(taskManager.startTask(task.id)).rejects.toMatchObject({
        code: "RESOURCE_HAS_DEPENDENTS",
        statusCode: 409,
        message: expect.stringContaining("并发上限"),
      });

      vi.mocked(sdkSessionManager.getActiveTaskCount).mockReturnValue(0);
    });

    it("should rollback on SDK start failure", async () => {
      const { sdkSessionManager } = await import("./sdkSessionManager.js");
      vi.mocked(sdkSessionManager.startTask).mockRejectedValueOnce(new Error("SDK failed"));

      const agent = makeAgent();
      const project = makeProject();
      const task = makeTask();

      agentStore.createAgent(agent);
      projectStore.createProject(project);
      taskStore.createTask(task);

      await expect(taskManager.startTask(task.id)).rejects.toThrow("SDK failed");

      // Verify rollback
      const rolledBackTask = taskStore.getTaskById(task.id);
      expect(rolledBackTask?.status).toBe("Todo");
      expect(rolledBackTask?.startedAt).toBeUndefined();

      const rolledBackAgent = agentStore.getAgentById(agent.id);
      expect(rolledBackAgent?.status).toBe("idle");
      expect(rolledBackAgent?.currentTaskId).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // cancelTask
  // -------------------------------------------------------------------------

  describe("cancelTask", () => {
    it("should transition Running → Cancelled and Agent → idle", () => {
      const agent = makeAgent({ status: "working", currentTaskId: "task-1" });
      const task = makeTask({ status: "Running", startedAt: Date.now() - 1000 });

      agentStore.createAgent(agent);
      taskStore.createTask(task);

      taskManager.cancelTask(task.id);

      const updatedTask = taskStore.getTaskById(task.id);
      expect(updatedTask?.status).toBe("Cancelled");
      expect(updatedTask?.completedReason).toBe("user_cancelled");
      expect(updatedTask?.completedAt).toBeDefined();

      const updatedAgent = agentStore.getAgentById(agent.id);
      expect(updatedAgent?.status).toBe("idle");
    });

    it("should update agent cancelled stats", () => {
      const agent = makeAgent({ status: "working", currentTaskId: "task-1" });
      const task = makeTask({ status: "Running", startedAt: Date.now() });

      agentStore.createAgent(agent);
      taskStore.createTask(task);

      taskManager.cancelTask(task.id);

      const updatedAgent = agentStore.getAgentById(agent.id);
      expect(updatedAgent?.stats.totalTasksCancelled).toBe(1);
    });

    it("should throw for non-existent task", () => {
      expect(() => taskManager.cancelTask("nonexistent")).toThrow(TaskManagerError);
    });

    it("should reject if Task is not Running/Stuck", () => {
      const task = makeTask({ status: "Todo" });
      taskStore.createTask(task);

      expect(() => taskManager.cancelTask(task.id)).toThrow();
      try {
        taskManager.cancelTask(task.id);
      } catch (e) {
        expect((e as TaskManagerError).code).toBe("TASK_NOT_ACTIVE");
      }
    });

    it("should call sdkSessionManager.stopTask", async () => {
      const { sdkSessionManager } = await import("./sdkSessionManager.js");
      const agent = makeAgent({ status: "working", currentTaskId: "task-1" });
      const task = makeTask({ status: "Running", startedAt: Date.now() });

      agentStore.createAgent(agent);
      taskStore.createTask(task);

      taskManager.cancelTask(task.id);

      expect(sdkSessionManager.stopTask).toHaveBeenCalledWith(task.id);
    });
  });

  // -------------------------------------------------------------------------
  // doneTask
  // -------------------------------------------------------------------------

  describe("doneTask", () => {
    it("should transition Running → Done with user_done reason", () => {
      const agent = makeAgent({ status: "working", currentTaskId: "task-1" });
      const task = makeTask({ status: "Running", startedAt: Date.now() - 5000 });

      agentStore.createAgent(agent);
      taskStore.createTask(task);

      taskManager.doneTask(task.id);

      const updatedTask = taskStore.getTaskById(task.id);
      expect(updatedTask?.status).toBe("Done");
      expect(updatedTask?.completedReason).toBe("user_done");
      expect(updatedTask?.completedAt).toBeDefined();
    });

    it("should update agent stats after done", () => {
      const agent = makeAgent({
        status: "working",
        currentTaskId: "task-1",
        stats: { totalTasksCompleted: 2, totalTasksCancelled: 0, totalCostUsd: 1.5, avgDurationMs: 3000 },
      });
      const task = makeTask({
        status: "Running",
        startedAt: Date.now() - 10000,
        budgetUsed: 0.5,
      });

      agentStore.createAgent(agent);
      taskStore.createTask(task);

      taskManager.doneTask(task.id);

      const updatedAgent = agentStore.getAgentById(agent.id);
      expect(updatedAgent?.stats.totalTasksCompleted).toBe(3);
      expect(updatedAgent?.stats.totalCostUsd).toBeCloseTo(2.0);
      expect(updatedAgent?.stats.avgDurationMs).toBeGreaterThan(0);
    });

    it("should reject for Todo task", () => {
      const task = makeTask({ status: "Todo" });
      taskStore.createTask(task);

      expect(() => taskManager.doneTask(task.id)).toThrow();
      try {
        taskManager.doneTask(task.id);
      } catch (e) {
        expect((e as TaskManagerError).code).toBe("TASK_NOT_ACTIVE");
      }
    });
  });

  // -------------------------------------------------------------------------
  // completeTask (used by SDK)
  // -------------------------------------------------------------------------

  describe("completeTask", () => {
    it("should transition Running → Done with provided reason", () => {
      const agent = makeAgent({ status: "working", currentTaskId: "task-1" });
      const task = makeTask({ status: "Running", startedAt: Date.now() });

      agentStore.createAgent(agent);
      taskStore.createTask(task);

      taskManager.completeTask(task.id, "sdk_result", "Task completed successfully");

      const updatedTask = taskStore.getTaskById(task.id);
      expect(updatedTask?.status).toBe("Done");
      expect(updatedTask?.completedReason).toBe("sdk_result");
      expect(updatedTask?.output).toBe("Task completed successfully");
    });

    it("should do nothing for non-existent task", () => {
      // Should not throw
      taskManager.completeTask("nonexistent", "sdk_result");
    });

    it("should do nothing for Todo task", () => {
      const task = makeTask({ status: "Todo" });
      taskStore.createTask(task);

      taskManager.completeTask(task.id, "sdk_result");

      const unchanged = taskStore.getTaskById(task.id);
      expect(unchanged?.status).toBe("Todo");
    });

    it("should truncate output to 10000 chars", () => {
      const agent = makeAgent({ status: "working", currentTaskId: "task-1" });
      const task = makeTask({ status: "Running", startedAt: Date.now() });

      agentStore.createAgent(agent);
      taskStore.createTask(task);

      const longOutput = "x".repeat(15000);
      taskManager.completeTask(task.id, "sdk_result", longOutput);

      const updatedTask = taskStore.getTaskById(task.id);
      expect(updatedTask?.output?.length).toBe(10000);
    });
  });

  // -------------------------------------------------------------------------
  // stuckTask
  // -------------------------------------------------------------------------

  describe("stuckTask", () => {
    it("should transition Running → Stuck", () => {
      const agent = makeAgent({ status: "working", currentTaskId: "task-1" });
      const task = makeTask({ status: "Running", startedAt: Date.now() });

      agentStore.createAgent(agent);
      taskStore.createTask(task);

      taskManager.stuckTask(task.id, "需要工具审批");

      const updatedTask = taskStore.getTaskById(task.id);
      expect(updatedTask?.status).toBe("Stuck");
      expect(updatedTask?.stuckReason).toBe("需要工具审批");

      const updatedAgent = agentStore.getAgentById(agent.id);
      expect(updatedAgent?.status).toBe("stuck");
    });

    it("should do nothing for Todo task", () => {
      const task = makeTask({ status: "Todo" });
      taskStore.createTask(task);

      taskManager.stuckTask(task.id, "reason");

      const unchanged = taskStore.getTaskById(task.id);
      expect(unchanged?.status).toBe("Todo");
    });

    it("should do nothing for non-existent task", () => {
      expect(() => taskManager.stuckTask("nonexistent", "reason")).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // cancelTask — Stuck variant
  // -------------------------------------------------------------------------

  describe("cancelTask — Stuck", () => {
    it("should transition Stuck → Cancelled", () => {
      const agent = makeAgent({ status: "stuck", currentTaskId: "task-1" });
      const task = makeTask({ status: "Stuck", startedAt: Date.now() - 5000 });

      agentStore.createAgent(agent);
      taskStore.createTask(task);

      taskManager.cancelTask(task.id);

      const updatedTask = taskStore.getTaskById(task.id);
      expect(updatedTask?.status).toBe("Cancelled");
      expect(updatedTask?.completedReason).toBe("user_cancelled");

      const updatedAgent = agentStore.getAgentById(agent.id);
      expect(updatedAgent?.status).toBe("idle");
    });
  });

  // -------------------------------------------------------------------------
  // Agent status management
  // -------------------------------------------------------------------------

  describe("agent status management", () => {
    it("should keep Agent working when it has other Running tasks", () => {
      // Agent has two tasks; cancel one, the other keeps Agent working
      const agent = makeAgent({ status: "working", currentTaskId: "task-1" });

      const task1 = makeTask({ id: "task-1", status: "Running", startedAt: Date.now() });
      const task2 = makeTask({ id: "task-2", status: "Running", startedAt: Date.now(), agentId: "agent-1" });

      agentStore.createAgent(agent);
      taskStore.createTask(task1);
      taskStore.createTask(task2);

      // Cancel task1; agent should remain working because task2 is still Running
      taskManager.cancelTask("task-1");

      // After cancel, agent is still working because task2 is Running
      // (updateAgentStatus checks for running tasks)
      // Note: cancelTask calls updateAgentStatus which checks all tasks
      const updatedAgent = agentStore.getAgentById("agent-1");
      expect(updatedAgent?.status).toBe("working");
    });

    it("should set Agent idle when all tasks complete", () => {
      const agent = makeAgent({ status: "working", currentTaskId: "task-1" });
      const task = makeTask({ status: "Running", startedAt: Date.now() });

      agentStore.createAgent(agent);
      taskStore.createTask(task);

      taskManager.doneTask(task.id);

      const updatedAgent = agentStore.getAgentById(agent.id);
      expect(updatedAgent?.status).toBe("idle");
      expect(updatedAgent?.currentTaskId).toBeUndefined();
    });
  });
});
