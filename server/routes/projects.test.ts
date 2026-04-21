import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app, server, startServer } from "../app.js";
import * as projectStore from "../store/projectStore.js";
import * as taskStore from "../store/taskStore.js";
import os from "node:os";

describe("Project API", () => {
  beforeAll(async () => {
    if (!server.listening) {
      await startServer(0);
    }
  });

  afterAll(() => {
    if (server.listening) {
      server.close();
    }
  });

  const validPath = os.tmpdir();

  describe("GET /api/projects", () => {
    it("returns empty list initially", async () => {
      const res = await request(app).get("/api/projects");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("projects");
      expect(Array.isArray(res.body.projects)).toBe(true);
    });
  });

  describe("POST /api/projects", () => {
    it("creates a project with valid data", async () => {
      const res = await request(app).post("/api/projects").send({
        name: "test-project",
        path: validPath,
        description: "A test project",
      });

      expect(res.status).toBe(201);
      expect(res.body.project).toMatchObject({
        name: "test-project",
        path: validPath,
        description: "A test project",
      });
      expect(res.body.project.id).toBeDefined();
      expect(res.body.project.createdAt).toBeDefined();
    });

    it("rejects invalid name (special characters)", async () => {
      const res = await request(app).post("/api/projects").send({
        name: "invalid name!",
        path: validPath,
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects missing name", async () => {
      const res = await request(app).post("/api/projects").send({
        path: validPath,
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects relative path", async () => {
      const res = await request(app).post("/api/projects").send({
        name: "test-proj",
        path: "relative/path",
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects nonexistent path", async () => {
      const res = await request(app).post("/api/projects").send({
        name: "test-proj",
        path: "/nonexistent/path/12345",
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("PUT /api/projects/:id", () => {
    it("updates description", async () => {
      // Create first
      const createRes = await request(app).post("/api/projects").send({
        name: "update-test",
        path: validPath,
      });
      const id = createRes.body.project.id;

      const updateRes = await request(app)
        .put(`/api/projects/${id}`)
        .send({ description: "Updated description" });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.project.description).toBe("Updated description");
    });

    it("returns 404 for nonexistent id", async () => {
      const res = await request(app)
        .put("/api/projects/nonexistent-id")
        .send({ description: "test" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("PROJECT_NOT_FOUND");
    });

    it("rejects invalid name on update", async () => {
      const createRes = await request(app).post("/api/projects").send({
        name: "valid-name",
        path: validPath,
      });
      const id = createRes.body.project.id;

      const updateRes = await request(app)
        .put(`/api/projects/${id}`)
        .send({ name: "bad name!" });

      expect(updateRes.status).toBe(400);
    });
  });

  describe("DELETE /api/projects/:id", () => {
    it("deletes an existing project", async () => {
      const createRes = await request(app).post("/api/projects").send({
        name: "delete-test",
        path: validPath,
      });
      const id = createRes.body.project.id;

      const deleteRes = await request(app).delete(`/api/projects/${id}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.ok).toBe(true);
    });

    it("returns 404 for nonexistent id", async () => {
      const res = await request(app).delete("/api/projects/nonexistent-id");
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("PROJECT_NOT_FOUND");
    });

    it("rejects delete when active tasks exist", async () => {
      const createRes = await request(app).post("/api/projects").send({
        name: "protected-proj",
        path: validPath,
      });
      const projectId = createRes.body.project.id;

      // Create a Running task for this project
      taskStore.createTask({
        id: "task-blocking-delete",
        title: "Blocking Task",
        description: "test",
        status: "Running",
        agentId: "agent-1",
        projectId,
        priority: 1,
        tags: [],
        eventCount: 0,
        turnCount: 0,
        budgetUsed: 0,
        maxTurns: 100,
        maxBudgetUsd: 5.0,
        createdAt: Date.now(),
      });

      const deleteRes = await request(app).delete(`/api/projects/${projectId}`);
      expect(deleteRes.status).toBe(409);
      expect(deleteRes.body.error.code).toBe("RESOURCE_HAS_DEPENDENTS");

      // Clean up
      taskStore.deleteTask("task-blocking-delete");
      projectStore.deleteProject(projectId);
    });
  });
});
