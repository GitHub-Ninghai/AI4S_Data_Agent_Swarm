import type { Session } from "./types.js";
import { sessionsStore } from "./index.js";

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

/** Persisted sessions */
const sessions = new Map<string, Session>();

/** Runtime-only state (NOT persisted to disk) */
interface RuntimeSession {
  abortController?: AbortController;
  pendingToolApprovals: Map<string, Promise<"allow" | "deny">>;
}

const runtimeSessions = new Map<string, RuntimeSession>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function persist(): void {
  sessionsStore.save({
    _schema_version: 1,
    sessions: Array.from(sessions.values()),
  });
}

function ensureRuntime(id: string): RuntimeSession {
  let rt = runtimeSessions.get(id);
  if (!rt) {
    rt = { pendingToolApprovals: new Map() };
    runtimeSessions.set(id, rt);
  }
  return rt;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function getAllSessions(): Session[] {
  return Array.from(sessions.values());
}

export function getSessionById(id: string): Session | undefined {
  return sessions.get(id);
}

export function getSessionByTaskId(taskId: string): Session | undefined {
  return getAllSessions().find((s) => s.taskId === taskId);
}

export function createSession(session: Session): Session {
  sessions.set(session.id, session);
  ensureRuntime(session.id);
  persist();
  return session;
}

export function updateSession(
  id: string,
  patch: Partial<Omit<Session, "id" | "taskId" | "agentId">>,
): Session | undefined {
  const existing = sessions.get(id);
  if (!existing) return undefined;

  const updated: Session = { ...existing, ...patch };
  sessions.set(id, updated);
  persist();
  return updated;
}

// ---------------------------------------------------------------------------
// Runtime state management (not persisted)
// ---------------------------------------------------------------------------

export function getAbortController(sessionId: string): AbortController | undefined {
  return runtimeSessions.get(sessionId)?.abortController;
}

export function setAbortController(sessionId: string, controller: AbortController): void {
  ensureRuntime(sessionId).abortController = controller;
}

export function removeAbortController(sessionId: string): void {
  const rt = runtimeSessions.get(sessionId);
  if (rt) {
    delete rt.abortController;
  }
}

export function getPendingToolApproval(
  sessionId: string,
  toolUseId: string,
): Promise<"allow" | "deny"> | undefined {
  return runtimeSessions.get(sessionId)?.pendingToolApprovals.get(toolUseId);
}

export function setPendingToolApproval(
  sessionId: string,
  toolUseId: string,
  promise: Promise<"allow" | "deny">,
): void {
  ensureRuntime(sessionId).pendingToolApprovals.set(toolUseId, promise);
}

export function removePendingToolApproval(sessionId: string, toolUseId: string): void {
  runtimeSessions.get(sessionId)?.pendingToolApprovals.delete(toolUseId);
}

/** Clean up runtime state for a completed/killed session */
export function cleanupRuntime(sessionId: string): void {
  const rt = runtimeSessions.get(sessionId);
  if (rt?.abortController) {
    rt.abortController.abort();
  }
  runtimeSessions.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/** Load sessions from disk into memory. Call once at startup. */
export function loadSessions(): void {
  const data = sessionsStore.getData();
  const list = (data.sessions as Session[]) ?? [];
  sessions.clear();
  runtimeSessions.clear();
  for (const session of list) {
    sessions.set(session.id, session);
    ensureRuntime(session.id);
  }
}
