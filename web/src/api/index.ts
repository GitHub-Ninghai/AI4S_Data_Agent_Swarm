/**
 * ============================================================
 * API Adaptation Layer
 *
 * Bridges the gap between the frontend's expected data formats
 * and the backend's actual API contract.
 *
 * Key differences handled:
 *   - Backend uses `prompt` instead of `systemPrompt`
 *   - Backend agents have `role`, `isEnabled`, `stats` fields
 *   - Backend responses are raw: `{ agents: [...] }`, `{ agent: {...} }`
 *   - Backend events use `GET /api/tasks/:id/events`
 *   - Backend task actions: `/start`, `/stop`, `/done`, `/retry`
 *   - Tool approval: `POST /api/tasks/:id/approve-tool`
 *   - Auth endpoints return `{ code: 0, data: {...} }` envelope
 *   - WS messages: `{ type, data }` mapped to frontend event types
 * ============================================================
 */

import type {
  Agent,
  AgentStatus,
  Event,
  EventType,
  AgentCapabilityBinding,
  Project,
  Task,
  TaskStatus,
  Priority,
} from "../types";

// ---------------------------------------------------------------------------
// Tool key mapping — frontend categories to backend tool names
// ---------------------------------------------------------------------------

const TOOL_KEY_MAP: Record<string, string[]> = {
  file: ["Read", "Write", "Edit", "Glob", "Grep"],
  shell: ["Bash"],
  network: ["WebFetch"],
  code: ["Bash", "Read", "Write", "Edit"],
  crawler: ["WebFetch", "Bash"],
  search: ["Bash", "WebFetch"],
};

/** Expand frontend tool category keys into deduplicated backend tool names. */
function expandToolKeys(keys: string[]): string[] {
  const set = new Set<string>();
  for (const key of keys) {
    const tools = TOOL_KEY_MAP[key];
    if (tools) {
      for (const t of tools) set.add(t);
    } else {
      // If it is already a real tool name, pass through
      set.add(key);
    }
  }
  return Array.from(set);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Empty string — Vite dev server proxies `/api/*` and `/ws` to
 * `http://localhost:3456` automatically (see vite.config.ts).
 */
const API_BASE_URL = "";

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

function getHeaders(): HeadersInit {
  const token = localStorage.getItem("token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// ---------------------------------------------------------------------------
// Generic request helper
// ---------------------------------------------------------------------------

/**
 * Send a request to the backend.
 *
 * The backend does NOT use a `{ code, data, message }` envelope for most
 * endpoints — it returns raw shapes like `{ agents: [...] }` or `{ task: {...} }`.
 * This function returns the raw parsed JSON so callers can extract the
 * relevant property.
 */
async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const options: RequestInit = {
    method,
    headers: getHeaders(),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };

  const res = await fetch(url, options);

  if (!res.ok) {
    // Handle 401 Unauthorized — redirect to login page
    if (res.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/auth.html";
      throw new Error("请先登录");
    }

    // Try to extract structured error from the backend
    let errorMessage = `HTTP ${res.status}: ${res.statusText}`;
    try {
      const errBody = await res.json();
      if (errBody?.error?.message) {
        errorMessage = errBody.error.message;
      }
    } catch {
      // Response body was not JSON — stick with status text
    }
    throw new Error(errorMessage);
  }

  // 204 No Content
  if (res.status === 204) {
    return undefined as unknown as T;
  }

  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Backend Agent shape (from server/store/types.ts)
// ---------------------------------------------------------------------------

interface BackendAgent {
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
  model?: string;
  apiKey?: string; // masked, e.g. "****7a2b"
  apiBaseUrl?: string;
  hasApiKey?: boolean;
  taskCount: number;
  stats: {
    totalTasksCompleted: number;
    totalTasksCancelled: number;
    totalCostUsd: number;
    avgDurationMs: number;
  };
  lastEventAt: number;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Backend Task shape (from server/store/types.ts)
// ---------------------------------------------------------------------------

interface BackendTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  agentId: string;
  projectId: string;
  sessionId?: string;
  parentTaskId?: string;
  output?: string;
  completedReason?: string;
  priority: Priority;
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
  lastEventAt?: number;
  pipelineType?: string;
  inputFiles?: string[];
  autodataMeta?: {
    groupId: string;
    round: number;
    role: "challenger" | "weak_solver" | "strong_solver" | "judge";
  };
}

// ---------------------------------------------------------------------------
// Backend Event shape (from server/store/types.ts)
// ---------------------------------------------------------------------------

interface BackendEvent {
  id: string;
  taskId: string;
  sessionId: string;
  eventType: string;
  source: "sdk" | "hook";
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  duration?: number;
  timestamp: number;
  raw: string;
}

// ---------------------------------------------------------------------------
// Mapper: Backend Event Type -> Frontend Event Type
// ---------------------------------------------------------------------------

const EVENT_TYPE_MAP: Record<string, EventType> = {
  SDKInit: "task_started",
  SDKAssistant: "message_sent",
  SDKResult: "task_completed",
  PreToolUse: "tool_call",
  PostToolUse: "tool_result",
  SessionStart: "task_started",
  SessionEnd: "task_completed",
  Notification: "task_stuck",
  Stop: "task_stopped",
  UserPromptSubmit: "message_sent",
};

// ---------------------------------------------------------------------------
// Mapper: Backend Agent -> Frontend Agent
// ---------------------------------------------------------------------------

function mapAgentFromBackend(raw: BackendAgent): Agent {
  return {
    id: raw.id,
    name: raw.name,
    avatar: raw.avatar || raw.name.charAt(0),
    status: raw.status,
    model: raw.model ?? "",
    systemPrompt: raw.prompt,
    maxTurns: raw.maxTurns ?? 200,
    maxBudgetUsd: raw.maxBudgetUsd ?? 5.0,
    allowedTools: raw.allowedTools ?? [],
    projectId: raw.projectId ?? "",
    taskCount: raw.taskCount,
    lastEventAt: raw.lastEventAt,
    apiBaseUrl: raw.apiBaseUrl ?? "",
    hasApiKey: raw.hasApiKey ?? false,
  };
}

// ---------------------------------------------------------------------------
// Mapper: Frontend Agent -> Backend Agent (for create/update bodies)
// ---------------------------------------------------------------------------

function mapAgentToBackend(
  agent: Partial<Agent> & { name: string },
  apiKey?: string
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: agent.name,
    role: agent.name, // Auto-fill role from name
    prompt: agent.systemPrompt ?? "",
    avatar: agent.avatar || agent.name.charAt(0),
  };

  if (agent.systemPrompt !== undefined) {
    result.prompt = agent.systemPrompt;
  }
  if (agent.maxTurns !== undefined) {
    result.maxTurns = agent.maxTurns;
  }
  if (agent.maxBudgetUsd !== undefined) {
    result.maxBudgetUsd = agent.maxBudgetUsd;
  }
  if (agent.projectId !== undefined) {
    result.projectId = agent.projectId;
  }
  if (agent.allowedTools !== undefined) {
    // Expand category keys (e.g. 'file', 'shell') into real tool names
    result.allowedTools = expandToolKeys(agent.allowedTools);
  }
  if (agent.model !== undefined) {
    result.model = agent.model;
  }
  if (agent.apiBaseUrl !== undefined) {
    result.apiBaseUrl = agent.apiBaseUrl;
  }
  if (apiKey !== undefined) {
    result.apiKey = apiKey;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Mapper: Backend Task -> Frontend Task
// ---------------------------------------------------------------------------

function mapTaskFromBackend(raw: BackendTask): Task {
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description,
    status: raw.status,
    priority: raw.priority,
    agentId: raw.agentId,
    projectId: raw.projectId,
    tags: raw.tags,
    maxTurns: raw.maxTurns,
    maxBudgetUsd: raw.maxBudgetUsd,
    turnCount: raw.turnCount,
    budgetUsed: raw.budgetUsed,
    createdAt: raw.createdAt,
    ...(raw.autodataMeta ? { autodataMeta: raw.autodataMeta } : {}),
    ...(raw.pipelineType ? { pipelineType: raw.pipelineType as any } : {}),
    ...(raw.inputFiles ? { inputFiles: raw.inputFiles } : {}),
    ...(raw.completedReason ? { completedReason: raw.completedReason } : {}),
    ...(raw.startedAt ? { startedAt: raw.startedAt } : {}),
    ...(raw.completedAt ? { completedAt: raw.completedAt } : {}),
    ...(raw.stuckReason ? { stuckReason: raw.stuckReason } : {}),
    ...(raw.eventCount !== undefined ? { eventCount: raw.eventCount } : {}),
  };
}

// ---------------------------------------------------------------------------
// Mapper: Backend Event -> Frontend Event
// ---------------------------------------------------------------------------

function mapEventFromBackend(raw: BackendEvent): Event {
  return {
    id: raw.id,
    taskId: raw.taskId,
    type: EVENT_TYPE_MAP[raw.eventType] || "error",
    data: {
      source: raw.source,
      toolName: raw.toolName,
      toolInput: raw.toolInput,
      toolOutput: raw.toolOutput,
      duration: raw.duration,
      sessionId: raw.sessionId,
      raw: raw.raw,
    },
    createdAt: raw.timestamp,
  };
}

// ===========================================================================
// API: Projects
// ===========================================================================

export const ProjectApi = {
  /** GET /api/projects — response: { projects: [...] } */
  async list(): Promise<Project[]> {
    const res = await request<{ projects: Project[] }>("GET", "/api/projects");
    return res.projects ?? [];
  },

  /** POST /api/projects — response: { project: {...} } */
  async create(body: {
    name: string;
    path?: string;
    description?: string;
  }): Promise<Project> {
    const res = await request<{ project: Project }>(
      "POST",
      "/api/projects",
      body
    );
    return res.project;
  },

  /** PUT /api/projects/:id — response: { project: {...} } */
  async update(id: string, body: Partial<Project>): Promise<Project> {
    const res = await request<{ project: Project }>(
      "PUT",
      `/api/projects/${id}`,
      body
    );
    return res.project;
  },

  /** DELETE /api/projects/:id — response: { ok: true } */
  async remove(id: string): Promise<void> {
    await request("DELETE", `/api/projects/${id}`);
  },
};

// ===========================================================================
// API: Capabilities
// ===========================================================================

interface BackendCapabilityBinding {
  agentId: string;
  capabilityId: string;
  enabled: boolean;
}

function mapCapabilityBinding(raw: BackendCapabilityBinding): AgentCapabilityBinding {
  return {
    agentId: raw.agentId,
    capabilityId: raw.capabilityId,
    enabled: raw.enabled,
  };
}

export const CapabilityApi = {
  async listBindings(): Promise<AgentCapabilityBinding[]> {
    const res = await request<{ bindings: BackendCapabilityBinding[] }>(
      "GET",
      "/api/capabilities/bindings"
    );
    return (res.bindings ?? []).map(mapCapabilityBinding);
  },

  async setBinding(
    agentId: string,
    capabilityId: string,
    enabled: boolean
  ): Promise<AgentCapabilityBinding> {
    const res = await request<{ binding: BackendCapabilityBinding }>(
      "PUT",
      `/api/capabilities/agents/${agentId}/bindings/${capabilityId}`,
      { enabled }
    );
    return mapCapabilityBinding(res.binding);
  },
};

// ===========================================================================
// API: Agents
// ===========================================================================

export const AgentApi = {
  /**
   * GET /api/agents — response: { agents: [...] }
   * Optional projectId filter is not natively supported by the backend
   * GET endpoint, so we filter client-side if needed.
   */
  async list(projectId?: string): Promise<Agent[]> {
    const res = await request<{ agents: BackendAgent[] }>("GET", "/api/agents");
    let agents = (res.agents ?? []).map(mapAgentFromBackend);
    if (projectId) {
      agents = agents.filter(a => a.projectId === projectId);
    }
    return agents;
  },

  /** GET /api/agents/:id — response: { agent: {...} } */
  async get(id: string): Promise<Agent> {
    const res = await request<{ agent: BackendAgent }>(
      "GET",
      `/api/agents/${id}`
    );
    return mapAgentFromBackend(res.agent);
  },

  /** POST /api/agents — response: { agent: {...} } */
  async create(
    body: Partial<Agent> & { name: string },
    apiKey?: string
  ): Promise<Agent> {
    const backendBody = mapAgentToBackend(body, apiKey);
    const res = await request<{ agent: BackendAgent }>(
      "POST",
      "/api/agents",
      backendBody
    );
    return mapAgentFromBackend(res.agent);
  },

  /** PUT /api/agents/:id — response: { agent: {...} } */
  async update(
    id: string,
    body: Partial<Agent>,
    apiKey?: string
  ): Promise<Agent> {
    const backendBody = mapAgentToBackend(
      body as Partial<Agent> & { name: string },
      apiKey
    );
    const res = await request<{ agent: BackendAgent }>(
      "PUT",
      `/api/agents/${id}`,
      backendBody
    );
    return mapAgentFromBackend(res.agent);
  },

  /** DELETE /api/agents/:id — response: { ok: true } */
  async remove(id: string): Promise<void> {
    await request("DELETE", `/api/agents/${id}`);
  },

  /** POST /api/agents/test-connection — verify model API connectivity */
  async testConnection(
    model: string,
    apiKey: string,
    apiBaseUrl: string
  ): Promise<{
    ok: boolean;
    model?: string;
    message?: string;
    error?: string;
  }> {
    return request("POST", "/api/agents/test-connection", {
      model,
      apiKey,
      apiBaseUrl,
    });
  },

  /** POST /api/agents/:id/start — enable agent, response: { agent: {...} } */
  async start(id: string): Promise<Agent> {
    const res = await request<{ agent: BackendAgent }>(
      "POST",
      `/api/agents/${id}/start`
    );
    return mapAgentFromBackend(res.agent);
  },

  /** POST /api/agents/:id/stop — disable agent, response: { agent: {...} } */
  async stop(id: string): Promise<Agent> {
    const res = await request<{ agent: BackendAgent }>(
      "POST",
      `/api/agents/${id}/stop`
    );
    return mapAgentFromBackend(res.agent);
  },
};

// ===========================================================================
// API: Tasks
// ===========================================================================

export const TaskApi = {
  /**
   * GET /api/tasks — response: { tasks: [...], total, page, limit, totalPages }
   * Returns the tasks array directly for backward compatibility with consumers
   * that expect `Task[]`.
   */
  async list(params?: {
    projectId?: string;
    status?: string;
    agentId?: string;
    q?: string;
    page?: number;
    limit?: number;
  }): Promise<Task[]> {
    const qs = params
      ? "?" +
        new URLSearchParams(
          Object.entries(params).reduce<Record<string, string>>(
            (acc, [k, v]) => {
              if (v !== undefined && v !== null) {
                acc[k] = String(v);
              }
              return acc;
            },
            {}
          )
        ).toString()
      : "";
    const res = await request<{
      tasks: BackendTask[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>("GET", `/api/tasks${qs}`);
    return (res.tasks ?? []).map(mapTaskFromBackend);
  },

  /** GET /api/tasks/:id — response: { task: {...} } */
  async get(id: string): Promise<Task> {
    const res = await request<{ task: BackendTask }>("GET", `/api/tasks/${id}`);
    return mapTaskFromBackend(res.task);
  },

  /** POST /api/tasks — response: { task: {...} } */
  async create(
    body: Partial<Task> & {
      title: string;
      description: string;
      agentId: string;
      projectId: string;
    }
  ): Promise<Task> {
    const res = await request<{ task: BackendTask }>(
      "POST",
      "/api/tasks",
      body
    );
    return mapTaskFromBackend(res.task);
  },

  /** PUT /api/tasks/:id — response: { task: {...} } */
  async update(id: string, body: Partial<Task>): Promise<Task> {
    const res = await request<{ task: BackendTask }>(
      "PUT",
      `/api/tasks/${id}`,
      body
    );
    return mapTaskFromBackend(res.task);
  },

  /** DELETE /api/tasks/:id — response: { ok: true } */
  async remove(id: string): Promise<void> {
    await request("DELETE", `/api/tasks/${id}`);
  },

  /** POST /api/tasks/:id/start — response: { task: {...} } */
  async start(id: string): Promise<Task> {
    const res = await request<{ task: BackendTask }>(
      "POST",
      `/api/tasks/${id}/start`
    );
    return mapTaskFromBackend(res.task);
  },

  /** POST /api/tasks/:id/stop — response: { task: {...} } */
  async stop(id: string): Promise<Task> {
    const res = await request<{ task: BackendTask }>(
      "POST",
      `/api/tasks/${id}/stop`
    );
    return mapTaskFromBackend(res.task);
  },

  /** POST /api/tasks/:id/retry — response: { task: {...} } */
  async retry(id: string): Promise<Task> {
    const res = await request<{ task: BackendTask }>(
      "POST",
      `/api/tasks/${id}/retry`
    );
    return mapTaskFromBackend(res.task);
  },

  /** POST /api/tasks/:id/done — mark task as done, response: { task: {...} } */
  async complete(id: string): Promise<Task> {
    const res = await request<{ task: BackendTask }>(
      "POST",
      `/api/tasks/${id}/done`
    );
    return mapTaskFromBackend(res.task);
  },

  /** POST /api/tasks/:id/message — send user message to a stuck task */
  async sendMessage(
    id: string,
    message: string,
    allowTool?: { decision: "allow" | "deny" }
  ): Promise<void> {
    await request("POST", `/api/tasks/${id}/message`, {
      message,
      ...(allowTool ? { allowTool } : {}),
    });
  },
};

// ===========================================================================
// API: Events
// ===========================================================================

export const EventApi = {
  /**
   * GET /api/tasks/:id/events — response: { events: [...], total, page, limit, totalPages }
   * Returns the events array directly for backward compatibility with consumers
   * that expect `Event[]`.
   */
  async list(
    taskId: string,
    params?: { page?: number; limit?: number; type?: string }
  ): Promise<Event[]> {
    const qs = params
      ? "?" +
        new URLSearchParams(
          Object.entries(params).reduce<Record<string, string>>(
            (acc, [k, v]) => {
              if (v !== undefined && v !== null) {
                acc[k] = String(v);
              }
              return acc;
            },
            {}
          )
        ).toString()
      : "";
    const res = await request<{
      events: BackendEvent[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>("GET", `/api/tasks/${taskId}/events${qs}`);
    return (res.events ?? []).map(mapEventFromBackend);
  },
};

// ===========================================================================
// API: User / Auth
// ===========================================================================

interface AuthResponse {
  code: number;
  data: {
    token: string;
    user: {
      id: string;
      name: string;
      email: string;
      avatar?: string;
      role: string;
      createdAt: number;
    };
  };
  message: string;
  timestamp: number;
}

interface ProfileResponse {
  code: number;
  data: {
    id: string;
    name: string;
    email: string;
    avatar?: string;
    role: string;
    createdAt: number;
  };
  message: string;
  timestamp: number;
}

export interface UserInfo {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: string;
  createdAt: number;
}

export const UserApi = {
  /** POST /api/auth/login — returns { code: 0, data: { token, user } } */
  async login(
    account: string,
    password: string
  ): Promise<{ token: string; user: UserInfo }> {
    const res = await request<AuthResponse>("POST", "/api/auth/login", {
      account,
      password,
    });
    return { token: res.data.token, user: res.data.user };
  },

  /** POST /api/auth/register — returns { code: 0, data: { token, user } } */
  async register(body: {
    name?: string;
    email: string;
    password: string;
  }): Promise<{ token: string; user: UserInfo }> {
    const res = await request<AuthResponse>("POST", "/api/auth/register", body);
    return { token: res.data.token, user: res.data.user };
  },

  /** POST /api/auth/logout — returns { code: 0, data: null } */
  async logout(): Promise<void> {
    await request("POST", "/api/auth/logout");
    localStorage.removeItem("token");
  },

  /** GET /api/user/profile — returns { code: 0, data: { ...user } } */
  async profile(): Promise<UserInfo> {
    const res = await request<ProfileResponse>("GET", "/api/user/profile");
    return res.data;
  },

  /** PUT /api/user/profile — returns { code: 0, data: { ...user } } */
  async updateProfile(body: {
    name?: string;
    avatar?: string;
  }): Promise<UserInfo> {
    const res = await request<ProfileResponse>(
      "PUT",
      "/api/user/profile",
      body
    );
    return res.data;
  },
};

// ===========================================================================
// API: Files
// ===========================================================================

export interface ProjectFile {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  size: number;
  source: "uploads" | "papers";
}

export const FileApi = {
  /** GET /api/files/:projectId — list PDF files in project */
  async list(projectId: string): Promise<ProjectFile[]> {
    const res = await request<{ files: ProjectFile[] }>(
      "GET",
      `/api/files/${projectId}`
    );
    return res.files ?? [];
  },

  /** POST /api/files/upload — upload PDFs */
  async upload(projectId: string, files: File[]): Promise<ProjectFile[]> {
    const formData = new FormData();
    formData.append("projectId", projectId);
    for (const f of files) {
      formData.append("files", f);
    }
    const token = localStorage.getItem("token");
    const res = await fetch(`${API_BASE_URL}/api/files/upload`, {
      method: "POST",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Upload failed: ${res.status}`);
    }
    const data = (await res.json()) as { files: ProjectFile[] };
    return data.files ?? [];
  },
};

// ===========================================================================
// API: Tool Approval
// ===========================================================================

export const ToolApprovalApi = {
  /**
   * POST /api/tasks/:id/approve-tool — approve pending tool call
   * Body: { decision: 'allow' }
   */
  async approve(taskId: string): Promise<void> {
    await request("POST", `/api/tasks/${taskId}/approve-tool`, {
      decision: "allow",
    });
  },

  /**
   * POST /api/tasks/:id/approve-tool — reject pending tool call
   * Body: { decision: 'deny' }
   */
  async reject(taskId: string): Promise<void> {
    await request("POST", `/api/tasks/${taskId}/approve-tool`, {
      decision: "deny",
    });
  },
};

// ===========================================================================
// API: Copilot
// ===========================================================================

export interface CopilotChatResponse {
  sessionId: string;
  message: string;
  actions?: Record<string, unknown>[];
  needsConfirmation?: boolean;
}

export const CopilotApi = {
  /** POST /api/copilot/chat */
  async chat(
    sessionId: string | undefined,
    message: string
  ): Promise<CopilotChatResponse> {
    return request<CopilotChatResponse>("POST", "/api/copilot/chat", {
      sessionId,
      message,
    });
  },

  /** POST /api/copilot/confirm */
  async confirm(
    sessionId: string,
    actionIndex: number,
    confirmed: boolean
  ): Promise<{ success: boolean; message: string; data?: unknown }> {
    return request("POST", "/api/copilot/confirm", {
      sessionId,
      actionIndex,
      confirmed,
    });
  },
};

// ===========================================================================
// WebSocket adapter
// ===========================================================================

export type FrontendWsType =
  | "agent.status"
  | "task.status"
  | "task.progress"
  | "event.new"
  | "approval.new"
  | "system.notify";

export interface WSMessage {
  type: FrontendWsType;
  payload: Record<string, unknown>;
  timestamp: number;
}

/**
 * Map backend WS message type strings to frontend-expected type strings.
 *
 * Backend broadcasts: task:update, agent:update, agent:delete, task:budget,
 *                     event:new, tool:approval, notification, project:update,
 *                     project:delete
 */
const WS_TYPE_MAP: Record<string, FrontendWsType> = {
  "task:update": "task.status",
  "agent:update": "agent.status",
  "agent:delete": "agent.status",
  "task:budget": "task.progress",
  "event:new": "event.new",
  "tool:approval": "approval.new",
  notification: "system.notify",
};

interface BackendWsMessage {
  type: string;
  data: unknown;
}

/**
 * Create a WebSocket connection through the Vite proxy (`/ws` -> `ws://localhost:3456/ws`).
 * Incoming messages are transformed from backend format to frontend format before
 * being dispatched via the `onMessage` callback.
 */
export function createWebSocket(
  onMessage: (msg: WSMessage) => void
): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("[WS] Connected");
  };

  ws.onmessage = e => {
    try {
      const raw = JSON.parse(e.data as string) as BackendWsMessage;
      const mappedType = WS_TYPE_MAP[raw.type];

      if (!mappedType) {
        // Unrecognised message type — skip silently (e.g. project:update)
        return;
      }

      const msg: WSMessage = {
        type: mappedType,
        payload:
          raw.data && typeof raw.data === "object"
            ? (raw.data as Record<string, unknown>)
            : { value: raw.data },
        timestamp: Date.now(),
      };

      onMessage(msg);
    } catch (err) {
      console.error("[WS] Failed to parse message:", err);
    }
  };

  ws.onerror = () => {
    // Silently ignore — reconnect logic in onclose handles recovery
  };

  ws.onclose = () => {
    console.log("[WS] Disconnected");
  };

  return ws;
}

// ===========================================================================
// API: Autodata
// ===========================================================================

export interface AutodataRoleModel {
  model: string;
  apiKey: string;
  apiBaseUrl: string;
}

export interface AutodataGroupRound {
  round: number;
  challengerTaskId: string;
  weakSolverTaskId?: string;
  strongSolverTaskId?: string;
  judgeTaskId?: string;
  weakDone: boolean;
  strongDone: boolean;
  scores?: {
    weakScore: number;
    strongScore: number;
    gap: number;
    passed: boolean;
  };
  taskStatuses?: Record<string, { id: string; status: string }>;
}

export interface AutodataGroup {
  groupId: string;
  projectId: string;
  inputFiles: string[];
  status: "running" | "accepted" | "rejected" | "error";
  currentRound: number;
  maxRounds: number;
  createdAt: number;
  completedAt?: number;
  challengerAgentId: string;
  weakSolverAgentId: string;
  strongSolverAgentId: string;
  judgeAgentId: string;
  rounds: AutodataGroupRound[];
  lastFailureReason?: string;
}

export const AutodataApi = {
  /** POST /api/autodata/create */
  async create(params: {
    projectId: string;
    inputFiles: string[];
    maxRounds?: number;
    challenger: AutodataRoleModel;
    weakSolver: AutodataRoleModel;
    strongSolver: AutodataRoleModel;
    judge: AutodataRoleModel;
  }): Promise<{ group: AutodataGroup; firstTaskId: string }> {
    return request("POST", "/api/autodata/create", params);
  },

  /** GET /api/autodata/groups */
  async listGroups(): Promise<AutodataGroup[]> {
    const res = await request<{ groups: AutodataGroup[] }>(
      "GET",
      "/api/autodata/groups"
    );
    return res.groups ?? [];
  },

  /** GET /api/autodata/groups/:id */
  async getGroup(id: string): Promise<AutodataGroup> {
    const res = await request<{ group: AutodataGroup }>(
      "GET",
      `/api/autodata/groups/${id}`
    );
    return res.group;
  },

  /** POST /api/autodata/groups/:id/retry */
  async retry(id: string): Promise<{ group: AutodataGroup; taskId?: string }> {
    return request("POST", `/api/autodata/groups/${id}/retry`);
  },
};
