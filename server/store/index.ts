import path from "node:path";
import { FileStore } from "./fileStore.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 1;

const DATA_DIR = path.resolve(process.cwd(), "data");

function dataPath(filename: string): string {
  return path.join(DATA_DIR, filename);
}

// ---------------------------------------------------------------------------
// Default envelopes
// ---------------------------------------------------------------------------

function emptyEnvelope(collection: string): Record<string, unknown> {
  return { _schema_version: SCHEMA_VERSION, [collection]: [] };
}

// ---------------------------------------------------------------------------
// Store instances (singleton per file)
// ---------------------------------------------------------------------------

export const agentsStore = new FileStore({
  filePath: dataPath("agents.json"),
  defaultValue: emptyEnvelope("agents"),
  currentVersion: SCHEMA_VERSION,
});

export const tasksStore = new FileStore({
  filePath: dataPath("tasks.json"),
  defaultValue: emptyEnvelope("tasks"),
  currentVersion: SCHEMA_VERSION,
});

export const sessionsStore = new FileStore({
  filePath: dataPath("sessions.json"),
  defaultValue: emptyEnvelope("sessions"),
  currentVersion: SCHEMA_VERSION,
});

export const projectsStore = new FileStore({
  filePath: dataPath("projects.json"),
  defaultValue: emptyEnvelope("projects"),
  currentVersion: SCHEMA_VERSION,
});

// ---------------------------------------------------------------------------
// Re-exports: low-level file store
// ---------------------------------------------------------------------------

export { FileStore } from "./fileStore.js";
export type { FileStoreOptions, MigrationFn } from "./fileStore.js";

// ---------------------------------------------------------------------------
// Re-exports: in-memory stores
// ---------------------------------------------------------------------------

export * as agentStore from "./agentStore.js";
export * as taskStore from "./taskStore.js";
export * as sessionStore from "./sessionStore.js";
export * as projectStore from "./projectStore.js";

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

const ALL_FILE_STORES = [agentsStore, tasksStore, sessionsStore, projectsStore];

/**
 * Load all file stores from disk (creating default files if needed),
 * run pending schema migrations, then populate in-memory Maps.
 * Call once at server startup.
 */
export async function loadAllStores(): Promise<void> {
  // 1. Load raw JSON from disk + run migrations
  await Promise.all(ALL_FILE_STORES.map((s) => s.load()));

  // 2. Populate in-memory Maps from persisted data
  const { loadAgents } = await import("./agentStore.js");
  const { loadTasks } = await import("./taskStore.js");
  const { loadSessions } = await import("./sessionStore.js");
  const { loadProjects } = await import("./projectStore.js");

  loadAgents();
  loadTasks();
  loadSessions();
  loadProjects();
}

/**
 * Return all FileStore instances for diagnostic / testing purposes.
 */
export function getAllStores(): FileStore[] {
  return [...ALL_FILE_STORES];
}
