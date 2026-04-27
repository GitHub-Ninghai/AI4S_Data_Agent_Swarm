// ---------------------------------------------------------------------------
// Frontend types — aligned with server/store/types.ts
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
  | "SDKInit"
  | "SDKAssistant"
  | "SDKResult"
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

// ---- Health ----------------------------------------------------------------

export interface HealthStatus {
  status: string;
  version: string;
  uptime: number;
  activeTaskCount: number;
  maxConcurrentTasks: number;
  storageOk: boolean;
}

// ---- WebSocket -------------------------------------------------------------

export type WSMessageType =
  | "task:update"
  | "agent:update"
  | "event:new"
  | "tool:approval"
  | "task:budget"
  | "notification"
  | "error";

export interface WSMessage<T = unknown> {
  type: WSMessageType;
  data: T;
}

// ---- API helpers -----------------------------------------------------------

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CreateAgentData {
  name: string;
  avatar: string;
  role: string;
  prompt: string;
  projectId?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  allowedTools?: string[];
}

export interface UpdateAgentData {
  name?: string;
  avatar?: string;
  role?: string;
  prompt?: string;
  isEnabled?: boolean;
  maxTurns?: number;
  maxBudgetUsd?: number;
  allowedTools?: string[];
}

export interface CreateProjectData {
  name: string;
  path: string;
  description?: string;
}

export interface UpdateProjectData {
  name?: string;
  path?: string;
  description?: string;
}

export interface CreateTaskData {
  title: string;
  description: string;
  agentId: string;
  projectId: string;
  priority?: 0 | 1 | 2;
  tags?: string[];
  maxTurns?: number;
  maxBudgetUsd?: number;
}

export interface UpdateTaskData {
  title?: string;
  description?: string;
  agentId?: string;
  priority?: 0 | 1 | 2;
  tags?: string[];
}

// ---- Copilot ---------------------------------------------------------------

export type CopilotActionType =
  | "create_agent"
  | "create_task"
  | "create_pipeline"
  | "update_agent"
  | "update_task"
  | "query_status";

export interface CopilotAction {
  type: CopilotActionType;
  summary: string;
  params: Record<string, unknown>;
  confirmationRequired: boolean;
}

export interface CopilotChatResponse {
  sessionId: string;
  message: string;
  actions: CopilotAction[];
  needsConfirmation: boolean;
}

export interface CopilotConfirmResponse {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}
