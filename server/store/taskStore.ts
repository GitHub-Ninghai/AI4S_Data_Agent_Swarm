import type { TaskStatus } from "./types.js";
import { tasksStore } from "./index.js";

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

const tasks = new Map<string, Task>();

// ---------------------------------------------------------------------------
// Query options
// ---------------------------------------------------------------------------

export interface TaskQueryOptions {
  status?: TaskStatus;
  agentId?: string;
  projectId?: string;
  priority?: 0 | 1 | 2;
  page?: number;
  limit?: number;
}

export interface TaskQueryResult {
  tasks: Task[];
  total: number;
  page: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function persist(): void {
  tasksStore.save({
    _schema_version: 1,
    tasks: Array.from(tasks.values()),
  });
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function getAllTasks(): Task[] {
  return Array.from(tasks.values());
}

export function getTaskById(id: string): Task | undefined {
  return tasks.get(id);
}

export function createTask(task: Task): Task {
  tasks.set(task.id, task);
  persist();
  return task;
}

export function updateTask(
  id: string,
  patch: Partial<Omit<Task, "id" | "createdAt">>,
): Task | undefined {
  const existing = tasks.get(id);
  if (!existing) return undefined;

  const updated: Task = {
    ...existing,
    ...patch,
  };
  tasks.set(id, updated);
  persist();
  return updated;
}

export function deleteTask(id: string): boolean {
  const deleted = tasks.delete(id);
  if (deleted) persist();
  return deleted;
}

// ---------------------------------------------------------------------------
// Query with filter & pagination
// ---------------------------------------------------------------------------

export function queryTasks(options: TaskQueryOptions = {}): TaskQueryResult {
  let result = getAllTasks();

  // Apply filters
  if (options.status !== undefined) {
    result = result.filter((t) => t.status === options.status);
  }
  if (options.agentId !== undefined) {
    result = result.filter((t) => t.agentId === options.agentId);
  }
  if (options.projectId !== undefined) {
    result = result.filter((t) => t.projectId === options.projectId);
  }
  if (options.priority !== undefined) {
    result = result.filter((t) => t.priority === options.priority);
  }

  // Sort by creation time descending (newest first)
  result.sort((a, b) => b.createdAt - a.createdAt);

  const total = result.length;
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.max(1, options.limit ?? 50);
  const start = (page - 1) * limit;
  const paginated = result.slice(start, start + limit);

  return { tasks: paginated, total, page, limit };
}

// ---------------------------------------------------------------------------
// Specialized queries
// ---------------------------------------------------------------------------

/** Find tasks by status */
export function getTasksByStatus(status: TaskStatus): Task[] {
  return getAllTasks().filter((t) => t.status === status);
}

/** Get current running/stuck task for an agent (at most one at a time) */
export function getActiveTaskForAgent(agentId: string): Task | undefined {
  return getAllTasks().find(
    (t) => t.agentId === agentId && (t.status === "Running" || t.status === "Stuck"),
  );
}

/** Count tasks with a given status */
export function countTasksByStatus(status: TaskStatus): number {
  return getAllTasks().filter((t) => t.status === status).length;
}

/** Find a task by its SDK session_id */
export function getTaskBySessionId(sessionId: string): Task | undefined {
  return getAllTasks().find((t) => t.sessionId === sessionId);
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/** Load tasks from disk into memory. Call once at startup. */
export function loadTasks(): void {
  const data = tasksStore.getData();
  const list = (data.tasks as Task[]) ?? [];
  tasks.clear();
  for (const task of list) {
    tasks.set(task.id, task);
  }
}
