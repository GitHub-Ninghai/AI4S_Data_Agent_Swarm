import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import os from "node:os";
import { app, server, startServer } from "../app.js";
import * as taskStore from "../store/taskStore.js";

describe("Task API", () => {
  let projectId: string;
  let agentId: string;

  beforeAll(async () => {
    if (!server.listening) {
      await startServer(0);
    }

    // Create a project and agent for task tests
    const projRes = await request(app).post("/api/projects").send({
      name: "task-test-proj",
      path: os.tmpdir(),
    });
    projectId = projRes.body.project.id;

    const agentRes = await request(app).post("/api/agents").send({
      name: "Task Tester",
      avatar: "🔧",
      role: "Testing task API endpoints",
      prompt: "You are a task testing agent. Follow instructions and verify your work carefully.",
    });
    agentId = agentRes.body.agent.id;
  });

  afterAll(() => {
    if (server.listening) {
      server.close();
    }
  });

  const validTask = {
    title: "Test Task",
    description: "A test task for verifying the Task API endpoints work correctly.",
    agentId: "placeholder",
    projectId: "placeholder",
  };

  describe("POST /api/tasks", () => {
    it("creates a task with valid data", async () => {
      const res = await request(app)
        .post("/api/tasks")
        .send({ ...validTask, agentId, projectId });

      expect(res.status).toBe(201);
      expect(res.body.task).toMatchObject({
        title: "Test Task",
        status: "Todo",
        priority: 1,
        tags: [],
        eventCount: 0,
        turnCount: 0,
        budgetUsed: 0,
      });
      expect(res.body.task.id).toBeDefined();
      expect(res.body.task.maxTurns).toBe(200);
      expect(res.body.task.maxBudgetUsd).toBe(5.0);
    });

    it("inherits config from agent", async () => {
      // Create agent with custom config
      const customAgent = await request(app).post("/api/agents").send({
        name: "Custom Agent",
        avatar: "⚡",
        role: "Testing inheritance",
        prompt: "You are a custom agent for testing config inheritance behavior.",
        maxTurns: 50,
        maxBudgetUsd: 1.0,
      });

      const res = await request(app)
        .post("/api/tasks")
        .send({
          ...validTask,
          agentId: customAgent.body.agent.id,
          projectId,
        });

      expect(res.status).toBe(201);
      expect(res.body.task.maxTurns).toBe(50);
      expect(res.body.task.maxBudgetUsd).toBe(1.0);
    });

    it("rejects missing title", async () => {
      const res = await request(app)
        .post("/api/tasks")
        .send({ description: "a".repeat(10), agentId, projectId });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects short description", async () => {
      const res = await request(app)
        .post("/api/tasks")
        .send({ ...validTask, description: "short", agentId, projectId });

      expect(res.status).toBe(400);
    });

    it("rejects nonexistent agent", async () => {
      const res = await request(app)
        .post("/api/tasks")
        .send({ ...validTask, agentId: "nonexistent", projectId });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("AGENT_NOT_FOUND");
    });

    it("rejects nonexistent project", async () => {
      const res = await request(app)
        .post("/api/tasks")
        .send({ ...validTask, agentId, projectId: "nonexistent" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("PROJECT_NOT_FOUND");
    });

    it("increments agent taskCount", async () => {
      const agentBefore = (await request(app).get(`/api/agents/${agentId}`)).body.agent;

      await request(app)
        .post("/api/tasks")
        .send({
          title: "Count Test",
          description: "Testing that taskCount increments correctly when creating a task.",
          agentId,
          projectId,
        });

      const agentAfter = (await request(app).get(`/api/agents/${agentId}`)).body.agent;
      expect(agentAfter.taskCount).toBe(agentBefore.taskCount + 1);
    });
  });

  describe("GET /api/tasks", () => {
    it("returns tasks with pagination", async () => {
      const res = await request(app).get("/api/tasks");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("tasks");
      expect(res.body).toHaveProperty("total");
      expect(res.body).toHaveProperty("page");
      expect(res.body).toHaveProperty("limit");
      expect(res.body).toHaveProperty("totalPages");
    });

    it("filters by status", async () => {
      const res = await request(app).get("/api/tasks?status=Todo");
      expect(res.status).toBe(200);
      for (const t of res.body.tasks) {
        expect(t.status).toBe("Todo");
      }
    });

    it("filters by agentId", async () => {
      const res = await request(app).get(`/api/tasks?agentId=${agentId}`);
      expect(res.status).toBe(200);
      for (const t of res.body.tasks) {
        expect(t.agentId).toBe(agentId);
      }
    });

    it("filters by keyword search", async () => {
      const res = await request(app).get("/api/tasks?q=Test");
      expect(res.status).toBe(200);
      expect(res.body.tasks.length).toBeGreaterThan(0);
    });

    it("excludes soft-deleted by default", async () => {
      // Create and soft-delete a task
      const createRes = await request(app)
        .post("/api/tasks")
        .send({
          title: "To Soft Delete",
          description: "This task will be soft deleted for testing the filter behavior.",
          agentId,
          projectId,
        });
      const taskId = createRes.body.task.id;

      // Mark as Done
      taskStore.updateTask(taskId, { status: "Done", completedAt: Date.now(), completedReason: "sdk_result" });

      // Delete (soft)
      await request(app).delete(`/api/tasks/${taskId}`);

      const res = await request(app).get("/api/tasks");
      const found = res.body.tasks.find((t: any) => t.id === taskId);
      expect(found).toBeUndefined();
    });

    it("includes soft-deleted with includeDeleted=true", async () => {
      const res = await request(app).get("/api/tasks?includeDeleted=true");
      // Should include tasks with deletedAt
      const deleted = res.body.tasks.filter((t: any) => t.deletedAt !== undefined);
      expect(deleted.length).toBeGreaterThan(0);
    });
  });

  describe("GET /api/tasks/:id", () => {
    it("returns a task by id", async () => {
      const createRes = await request(app)
        .post("/api/tasks")
        .send({
          title: "Get By ID",
          description: "Testing get task by ID endpoint for individual task retrieval.",
          agentId,
          projectId,
        });
      const id = createRes.body.task.id;

      const getRes = await request(app).get(`/api/tasks/${id}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.task.id).toBe(id);
    });

    it("returns 404 for nonexistent id", async () => {
      const res = await request(app).get("/api/tasks/nonexistent-id");
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("TASK_NOT_FOUND");
    });
  });

  describe("PUT /api/tasks/:id", () => {
    it("updates title", async () => {
      const createRes = await request(app)
        .post("/api/tasks")
        .send({
          title: "Original Title",
          description: "Testing the PUT endpoint for updating task title field correctly.",
          agentId,
          projectId,
        });
      const id = createRes.body.task.id;

      const updateRes = await request(app)
        .put(`/api/tasks/${id}`)
        .send({ title: "Updated Title" });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.task.title).toBe("Updated Title");
    });

    it("returns 404 for nonexistent id", async () => {
      const res = await request(app)
        .put("/api/tasks/nonexistent-id")
        .send({ title: "test" });

      expect(res.status).toBe(404);
    });

    it("allows agentId change for Todo tasks", async () => {
      const createRes = await request(app)
        .post("/api/tasks")
        .send({
          title: "Agent Change",
          description: "Testing agent reassignment for Todo status task in the system.",
          agentId,
          projectId,
        });
      const id = createRes.body.task.id;

      // Create another agent
      const newAgent = await request(app).post("/api/agents").send({
        name: "New Agent",
        avatar: "🆕",
        role: "Testing agent reassignment",
        prompt: "You are a new agent for testing agent reassignment in task updates.",
      });

      const updateRes = await request(app)
        .put(`/api/tasks/${id}`)
        .send({ agentId: newAgent.body.agent.id });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.task.agentId).toBe(newAgent.body.agent.id);
    });

    it("blocks agentId change for Running tasks", async () => {
      const createRes = await request(app)
        .post("/api/tasks")
        .send({
          title: "Running Task",
          description: "Testing that running tasks cannot change their assigned agent.",
          agentId,
          projectId,
        });
      const id = createRes.body.task.id;

      // Manually set to Running
      taskStore.updateTask(id, { status: "Running", startedAt: Date.now() });

      const updateRes = await request(app)
        .put(`/api/tasks/${id}`)
        .send({ agentId: "different-agent" });

      expect(updateRes.status).toBe(409);
      expect(updateRes.body.error.code).toBe("TASK_ALREADY_RUNNING");

      // Clean up
      taskStore.updateTask(id, { status: "Todo" });
    });
  });

  describe("DELETE /api/tasks/:id", () => {
    it("hard deletes Todo tasks", async () => {
      const createRes = await request(app)
        .post("/api/tasks")
        .send({
          title: "Delete Me",
          description: "Testing hard deletion of Todo status tasks from the system.",
          agentId,
          projectId,
        });
      const id = createRes.body.task.id;

      const deleteRes = await request(app).delete(`/api/tasks/${id}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.ok).toBe(true);

      // Verify it's gone
      const getRes = await request(app).get(`/api/tasks/${id}`);
      expect(getRes.status).toBe(404);
    });

    it("soft deletes Done tasks", async () => {
      const createRes = await request(app)
        .post("/api/tasks")
        .send({
          title: "Done Task",
          description: "Testing soft deletion of Done status tasks in the system.",
          agentId,
          projectId,
        });
      const id = createRes.body.task.id;

      taskStore.updateTask(id, { status: "Done", completedAt: Date.now(), completedReason: "sdk_result" });

      const deleteRes = await request(app).delete(`/api/tasks/${id}`);
      expect(deleteRes.status).toBe(200);

      // Still exists but with deletedAt
      const task = taskStore.getTaskById(id);
      expect(task).toBeDefined();
      expect(task!.deletedAt).toBeDefined();
    });

    it("rejects delete for Running tasks", async () => {
      const createRes = await request(app)
        .post("/api/tasks")
        .send({
          title: "Running Delete",
          description: "Testing that running tasks cannot be deleted from the system.",
          agentId,
          projectId,
        });
      const id = createRes.body.task.id;

      taskStore.updateTask(id, { status: "Running", startedAt: Date.now() });

      const deleteRes = await request(app).delete(`/api/tasks/${id}`);
      expect(deleteRes.status).toBe(409);
      expect(deleteRes.body.error.code).toBe("TASK_ALREADY_RUNNING");

      // Clean up
      taskStore.updateTask(id, { status: "Todo" });
    });

    it("returns 404 for nonexistent id", async () => {
      const res = await request(app).delete("/api/tasks/nonexistent-id");
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("TASK_NOT_FOUND");
    });
  });
});
