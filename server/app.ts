import "dotenv/config";

import express from "express";
import cors from "cors";
import http from "node:http";
import { loadAllStores } from "./store/index.js";
import * as taskStore from "./store/taskStore.js";
import { initWebSocket, getConnectedClientCount } from "./services/wsBroadcaster.js";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "3456", 10);
const MAX_CONCURRENT_TASKS = parseInt(
  process.env.MAX_CONCURRENT_TASKS || "10",
  10,
);
const MAX_WS_CLIENTS = parseInt(process.env.MAX_WS_CLIENTS || "10", 10);

// ---------------------------------------------------------------------------
// App & Server
// ---------------------------------------------------------------------------

export const app = express();
export const server = http.createServer(app);

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ],
  }),
);

app.use(express.json({ limit: "10mb" }));

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/api/health", (_req, res) => {
  const allTasks = taskStore.getAllTasks();
  const activeTaskCount = allTasks.filter(
    (t) => t.status === "Running" || t.status === "Stuck",
  ).length;

  res.json({
    status: "ok",
    version: "0.1.0",
    uptime: process.uptime(),
    activeTaskCount,
    maxConcurrentTasks: MAX_CONCURRENT_TASKS,
    storageOk: true,
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
  details?: unknown;
}

app.use(
  (
    err: ApiError,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const statusCode = err.statusCode ?? 500;
    const code = err.code ?? "INTERNAL_ERROR";
    const message =
      statusCode === 500 && !process.env.DEBUG
        ? "Internal server error"
        : err.message;

    if (statusCode >= 500) {
      console.error(`[ERROR] ${code}: ${err.message}`, err.stack);
    }

    res.status(statusCode).json({
      error: {
        code,
        message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  },
);

// ---------------------------------------------------------------------------
// Start (only when run directly, not when imported)
// ---------------------------------------------------------------------------

export async function startServer(): Promise<void> {
  await loadAllStores();

  // Initialise WebSocket on the same HTTP server
  initWebSocket(server, MAX_WS_CLIENTS);

  return new Promise((resolve) => {
    server.listen(PORT, "127.0.0.1", () => {
      console.log(
        `[Agent Swarm] Server listening on http://127.0.0.1:${PORT}`,
      );
      console.log(
        `[Agent Swarm] WebSocket: ws://127.0.0.1:${PORT}/ws`,
      );
      console.log(
        `[Agent Swarm] Health check: http://127.0.0.1:${PORT}/api/health`,
      );
      resolve();
    });
  });
}

// Auto-start when run directly (not when imported by tests)
const isMainModule =
  process.argv[1]?.endsWith("index.ts") ||
  process.argv[1]?.endsWith("index.js") ||
  process.argv[1]?.includes("tsx");

if (isMainModule) {
  startServer().catch((err) => {
    console.error("[Agent Swarm] Failed to start server:", err);
    process.exit(1);
  });
}
