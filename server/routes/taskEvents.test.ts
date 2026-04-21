import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import { app, server, startServer } from "../app.js";
import * as taskStore from "../store/taskStore.js";
import type { Event } from "../store/types.js";

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
// Helpers
// ---------------------------------------------------------------------------

const EVENTS_DIR = path.resolve(process.cwd(), "data", "events");

function makeEvent(overrides: Partial<Event> & { taskId: string }): Event {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 10)}`,
    sessionId: "sess-1",
    eventType: "SDKAssistant",
    source: "sdk",
    toolName: "Bash",
    toolInput: "echo hello",
    toolOutput: "hello",
    timestamp: Date.now(),
    raw: "{}",
    ...overrides,
  };
}

function writeJsonl(taskId: string, events: Event[]): void {
  if (!fs.existsSync(EVENTS_DIR)) {
    fs.mkdirSync(EVENTS_DIR, { recursive: true });
  }
  const filePath = path.join(EVENTS_DIR, `${taskId}.jsonl`);
  const lines = events.map((e) => JSON.stringify(e)).join("\n");
  fs.writeFileSync(filePath, lines + "\n", "utf-8");
}

function writeGzArchive(taskId: string, events: Event[]): void {
  if (!fs.existsSync(EVENTS_DIR)) {
    fs.mkdirSync(EVENTS_DIR, { recursive: true });
  }
  const gzPath = path.join(EVENTS_DIR, `${taskId}.jsonl.gz`);
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  const compressed = zlib.gzipSync(Buffer.from(lines, "utf-8"));
  fs.writeFileSync(gzPath, compressed);
}

function cleanupEvents(taskId: string): void {
  const jsonlPath = path.join(EVENTS_DIR, `${taskId}.jsonl`);
  const gzPath = path.join(EVENTS_DIR, `${taskId}.jsonl.gz`);
  if (fs.existsSync(jsonlPath)) fs.unlinkSync(jsonlPath);
  if (fs.existsSync(gzPath)) fs.unlinkSync(gzPath);
}

// ---------------------------------------------------------------------------
// Task Events API Tests
// ---------------------------------------------------------------------------

describe("Task Events API — GET /api/tasks/:id/events", () => {
  let projectId: string;
  let agentId: string;
  let taskId: string;

  beforeAll(async () => {
    if (!server.listening) {
      await startServer(0);
    }

    const projRes = await request(app).post("/api/projects").send({
      name: "events-test-proj",
      path: os.tmpdir(),
    });
    projectId = projRes.body.project.id;

    const agentRes = await request(app).post("/api/agents").send({
      name: "Events Tester",
      avatar: "📊",
      role: "Testing event query endpoints",
      prompt: "You are a test agent for verifying task event API endpoints work correctly.",
    });
    agentId = agentRes.body.agent.id;

    const taskRes = await request(app).post("/api/tasks").send({
      title: "Events Test Task",
      description: "Testing the events API endpoint with various scenarios",
      agentId,
      projectId,
    });
    taskId = taskRes.body.task.id;
  });

  afterEach(() => {
    cleanupEvents(taskId);
  });

  // ---- Basic tests ----

  it("returns 404 for non-existent task", async () => {
    const res = await request(app).get("/api/tasks/nonexistent-id/events");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TASK_NOT_FOUND");
  });

  it("returns empty events for task with no JSONL file", async () => {
    const res = await request(app).get(`/api/tasks/${taskId}/events`);
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(50);
  });

  it("returns events from JSONL file", async () => {
    const now = Date.now();
    const events = [
      makeEvent({ taskId, eventType: "SDKInit", timestamp: now - 3000 }),
      makeEvent({ taskId, eventType: "SDKAssistant", toolName: "Read", timestamp: now - 2000 }),
      makeEvent({ taskId, eventType: "SDKResult", timestamp: now - 1000 }),
    ];
    writeJsonl(taskId, events);

    const res = await request(app).get(`/api/tasks/${taskId}/events`);
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(3);
    expect(res.body.total).toBe(3);
    // Sorted by timestamp ascending
    expect(res.body.events[0].eventType).toBe("SDKInit");
    expect(res.body.events[2].eventType).toBe("SDKResult");
  });

  // ---- Pagination ----

  it("supports pagination", async () => {
    const now = Date.now();
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEvent({ taskId, timestamp: now + i, eventType: "SDKAssistant" }),
    );
    writeJsonl(taskId, events);

    // Page 1, limit 3
    const res1 = await request(app).get(
      `/api/tasks/${taskId}/events?page=1&limit=3`,
    );
    expect(res1.status).toBe(200);
    expect(res1.body.events).toHaveLength(3);
    expect(res1.body.total).toBe(10);
    expect(res1.body.page).toBe(1);
    expect(res1.body.limit).toBe(3);
    expect(res1.body.totalPages).toBe(4);

    // Page 2
    const res2 = await request(app).get(
      `/api/tasks/${taskId}/events?page=2&limit=3`,
    );
    expect(res2.body.events).toHaveLength(3);
    // Second page events have later timestamps
    expect(res2.body.events[0].timestamp).toBeGreaterThan(
      res1.body.events[2].timestamp,
    );
  });

  it("returns partial last page", async () => {
    const now = Date.now();
    const events = Array.from({ length: 5 }, (_, i) =>
      makeEvent({ taskId, timestamp: now + i, eventType: "SDKAssistant" }),
    );
    writeJsonl(taskId, events);

    const res = await request(app).get(
      `/api/tasks/${taskId}/events?page=2&limit=3`,
    );
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(2);
    expect(res.body.total).toBe(5);
  });

  // ---- Type filtering ----

  it("filters events by type", async () => {
    const now = Date.now();
    const events = [
      makeEvent({ taskId, eventType: "SDKInit", timestamp: now }),
      makeEvent({ taskId, eventType: "SDKAssistant", toolName: "Bash", timestamp: now + 1 }),
      makeEvent({ taskId, eventType: "SDKAssistant", toolName: "Read", timestamp: now + 2 }),
      makeEvent({ taskId, eventType: "SDKResult", timestamp: now + 3 }),
    ];
    writeJsonl(taskId, events);

    const res = await request(app).get(
      `/api/tasks/${taskId}/events?type=SDKAssistant`,
    );
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(2);
    expect(res.body.total).toBe(2);
    expect(res.body.events.every((e: Event) => e.eventType === "SDKAssistant")).toBe(true);
  });

  it("returns empty when type matches no events", async () => {
    const now = Date.now();
    const events = [
      makeEvent({ taskId, eventType: "SDKInit", timestamp: now }),
    ];
    writeJsonl(taskId, events);

    const res = await request(app).get(
      `/api/tasks/${taskId}/events?type=SDKResult`,
    );
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  // ---- GZ archive support ----

  it("reads events from .gz archive", async () => {
    const now = Date.now();
    const archivedEvents = [
      makeEvent({ taskId, eventType: "SDKInit", timestamp: now - 5000 }),
      makeEvent({ taskId, eventType: "SDKAssistant", toolName: "Bash", timestamp: now - 4000 }),
    ];
    writeGzArchive(taskId, archivedEvents);

    const res = await request(app).get(`/api/tasks/${taskId}/events`);
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(2);
    expect(res.body.total).toBe(2);
  });

  it("merges archived and current events", async () => {
    const now = Date.now();
    const archivedEvents = [
      makeEvent({ taskId, eventType: "SDKInit", timestamp: now - 10000 }),
      makeEvent({ taskId, eventType: "SDKAssistant", toolName: "Bash", timestamp: now - 9000 }),
    ];
    writeGzArchive(taskId, archivedEvents);

    const currentEvents = [
      makeEvent({ taskId, eventType: "SDKAssistant", toolName: "Read", timestamp: now - 1000 }),
      makeEvent({ taskId, eventType: "SDKResult", timestamp: now }),
    ];
    writeJsonl(taskId, currentEvents);

    const res = await request(app).get(`/api/tasks/${taskId}/events`);
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(4);
    expect(res.body.total).toBe(4);
    // Sorted by timestamp ascending
    expect(res.body.events[0].eventType).toBe("SDKInit");
    expect(res.body.events[3].eventType).toBe("SDKResult");
  });

  it("handles malformed JSONL lines gracefully", async () => {
    const now = Date.now();
    const validEvent = makeEvent({ taskId, eventType: "SDKInit", timestamp: now });
    const filePath = path.join(EVENTS_DIR, `${taskId}.jsonl`);
    if (!fs.existsSync(EVENTS_DIR)) {
      fs.mkdirSync(EVENTS_DIR, { recursive: true });
    }
    // Write mix of valid and invalid lines
    fs.writeFileSync(
      filePath,
      `not-json\n${JSON.stringify(validEvent)}\n\n{"broken\n`,
      "utf-8",
    );

    const res = await request(app).get(`/api/tasks/${taskId}/events`);
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventType).toBe("SDKInit");
  });

  // ---- Default values ----

  it("uses default pagination values", async () => {
    const res = await request(app).get(`/api/tasks/${taskId}/events`);
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// SDK Status API Tests — GET /api/tasks/:id/sdk-status
// ---------------------------------------------------------------------------

describe("SDK Status API — GET /api/tasks/:id/sdk-status", () => {
  let projectId: string;
  let agentId: string;
  let taskId: string;

  beforeAll(async () => {
    if (!server.listening) {
      await startServer(0);
    }

    const projRes = await request(app).post("/api/projects").send({
      name: "sdk-status-proj",
      path: os.tmpdir(),
    });
    projectId = projRes.body.project.id;

    const agentRes = await request(app).post("/api/agents").send({
      name: "SDK Status Tester",
      avatar: "📡",
      role: "Testing SDK status endpoint",
      prompt: "You are a test agent for verifying the SDK status API endpoint works correctly.",
    });
    agentId = agentRes.body.agent.id;

    const taskRes = await request(app).post("/api/tasks").send({
      title: "SDK Status Test Task",
      description: "Testing the SDK status API endpoint for real-time status query",
      agentId,
      projectId,
    });
    taskId = taskRes.body.task.id;
  });

  it("returns 404 for non-existent task", async () => {
    const res = await request(app).get("/api/tasks/nonexistent-id/sdk-status");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TASK_NOT_FOUND");
  });

  it("returns running=false for idle task", async () => {
    const res = await request(app).get(`/api/tasks/${taskId}/sdk-status`);
    expect(res.status).toBe(200);
    expect(res.body.running).toBe(false);
    expect(typeof res.body.turnCount).toBe("number");
    expect(typeof res.body.budgetUsed).toBe("number");
    expect(typeof res.body.maxBudgetUsd).toBe("number");
  });

  it("returns correct fields with updated task values", async () => {
    // Update task with some values
    taskStore.updateTask(taskId, {
      turnCount: 42,
      budgetUsed: 2.56,
      maxBudgetUsd: 10.0,
    });

    const res = await request(app).get(`/api/tasks/${taskId}/sdk-status`);
    expect(res.status).toBe(200);
    expect(res.body.running).toBe(false);
    expect(res.body.turnCount).toBe(42);
    expect(res.body.budgetUsed).toBeCloseTo(2.56);
    expect(res.body.maxBudgetUsd).toBeCloseTo(10.0);
  });
});
