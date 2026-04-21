// Agent Swarm Server entry point
// Delegates to app.ts which contains all Express configuration
export { app, server, startServer } from "./app.js";

import { startServer } from "./app.js";

startServer().catch((err) => {
  console.error("[Agent Swarm] Failed to start server:", err);
  process.exit(1);
});
