// ---------------------------------------------------------------------------
// Core domain types — mirrors requirement.md §6
// ---------------------------------------------------------------------------

// ---- Project ---------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  path: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

// ---- Agent -----------------------------------------------------------------

export type AgentStatus = "idle" | "working" | "stuck" | "offline";

export interface AgentStats {
  totalTasksCompleted: number;
  totalTasksCancelled: number;
  totalCostUsd: number;
  avgDurationMs: number;
}

export interface Agent {
  id: string;
  name: string;
  avatar: string;
  role: string;
  prompt: string;
  isEnabled: boolean;
  status: AgentStatus;
  projectId?: string;
  currentTaskId?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  allowedTools?: string[];
  taskCount: number;
  stats: AgentStats;
  lastEventAt: number;
  createdAt: number;
  updatedAt: number;
}

// ---- Task ------------------------------------------------------------------

export type TaskStatus = "Todo" | "Running" | "Done" | "Stuck" | "Cancelled";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  agentId: string;
  projectId: string;
  sessionId?: string;
  parentTaskId?: string;
  output?: string;
  completedReason?:
    | "sdk_result"
    | "max_turns"
    | "max_budget"
    | "user_cancelled"
    | "user_done"
    | "error";
  priority: 0 | 1 | 2;
  tags: string[];
  eventCount: number;
  turnCount: number;
  budgetUsed: number;
  maxTurns: number;
  maxBudgetUsd: number;
  deletedAt?: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  stuckReason?: string;
}

// ---- Event -----------------------------------------------------------------

export type EventType =
  // SDK 消息流事件
  | "SDKInit"
  | "SDKAssistant"
  | "SDKResult"
  // Hook 事件
  | "SessionStart"
  | "SessionEnd"
  | "PreToolUse"
  | "PostToolUse"
  | "Stop"
  | "UserPromptSubmit"
  | "Notification";

export interface Event {
  id: string;
  taskId: string;
  sessionId: string;
  eventType: EventType;
  source: "sdk" | "hook";
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  duration?: number;
  timestamp: number;
  raw: string;
}

// ---- Session ---------------------------------------------------------------

export type SessionStatus = "active" | "paused" | "completed" | "killed";

export interface Session {
  id: string;
  taskId: string;
  agentId: string;
  cwd: string;
  status: SessionStatus;
  startedAt: number;
  endedAt?: number;
}

// ---------------------------------------------------------------------------
// JSON file schema envelopes
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface SchemaEnvelope<T = unknown> {
  _schema_version: number;
  [key: string]: unknown;
}

export interface AgentsEnvelope extends SchemaEnvelope<Agent> {
  agents: Agent[];
}

export interface TasksEnvelope extends SchemaEnvelope<Task> {
  tasks: Task[];
}

export interface SessionsEnvelope extends SchemaEnvelope<Session> {
  sessions: Session[];
}

export interface ProjectsEnvelope extends SchemaEnvelope<Project> {
  projects: Project[];
}
