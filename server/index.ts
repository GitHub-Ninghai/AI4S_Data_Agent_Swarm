// Agent Swarm Server entry point
// Delegates to app.ts which contains all Express configuration
import { app, server, startServer, gracefulShutdown } from "./app.js";

export { app, server, startServer };

// Always start the server when this file is the entry point
startServer()
  .then(() => {
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  })
  .catch((err) => {
    console.error("[Agent Swarm] Failed to start server:", err);
    process.exit(1);
  });
