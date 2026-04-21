import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app, server, startServer } from "./app.js";

describe("Express Server", () => {
  beforeAll(async () => {
    if (!server.listening) {
      await startServer();
    }
  });

  afterAll(() => {
    server.close();
  });

  describe("GET /api/health", () => {
    it("returns status ok", async () => {
      const res = await request(app).get("/api/health");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("status", "ok");
      expect(res.body).toHaveProperty("version");
      expect(res.body).toHaveProperty("uptime");
      expect(res.body).toHaveProperty("activeTaskCount");
      expect(res.body).toHaveProperty("storageOk", true);
    });

    it("activeTaskCount is a number", async () => {
      const res = await request(app).get("/api/health");
      expect(typeof res.body.activeTaskCount).toBe("number");
    });
  });

  describe("Error handling middleware", () => {
    it("returns 404 for unknown routes", async () => {
      const res = await request(app).get("/api/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("CORS", () => {
    it("allows requests from localhost:5173", async () => {
      const res = await request(app)
        .options("/api/health")
        .set("Origin", "http://localhost:5173");

      expect(res.headers["access-control-allow-origin"]).toBe(
        "http://localhost:5173",
      );
    });

    it("rejects requests from other origins", async () => {
      const res = await request(app)
        .options("/api/health")
        .set("Origin", "http://evil.com");

      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });
});
