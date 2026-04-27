import type {
  Agent,
  AgentStats,
  CreateAgentData,
  UpdateAgentData,
  Project,
  CreateProjectData,
  UpdateProjectData,
  Task,
  CreateTaskData,
  UpdateTaskData,
  Event,
  HealthStatus,
  PaginatedResponse,
  CopilotChatResponse,
  CopilotConfirmResponse,
} from "../types";

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ---------------------------------------------------------------------------
// Global error handler — registered by AppContext
// ---------------------------------------------------------------------------

type ApiErrorHandler = (error: ApiError) => void;

let globalErrorHandler: ApiErrorHandler | null = null;

export function setApiErrorHandler(handler: ApiErrorHandler): void {
  globalErrorHandler = handler;
}

// ---------------------------------------------------------------------------
// Base request helper
// ---------------------------------------------------------------------------

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    const err = new ApiError(
      "NETWORK_ERROR",
      networkErr instanceof Error ? networkErr.message : "网络请求失败",
      0,
    );
    globalErrorHandler?.(err);
    throw err;
  }

  if (!res.ok) {
    let code = "UNKNOWN";
    let message = res.statusText;
    try {
      const err = await res.json();
      if (err.error) {
        code = err.error.code ?? code;
        message = err.error.message ?? message;
      }
    } catch {
      // use defaults
    }
    const err = new ApiError(code, message, res.status);
    globalErrorHandler?.(err);
    throw err;
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export function getHealth(): Promise<HealthStatus> {
  return request("GET", "/api/health");
}

// ---------------------------------------------------------------------------
// Agent API
// ---------------------------------------------------------------------------

export function getAgents(): Promise<{ agents: Agent[] }> {
  return request("GET", "/api/agents");
}

export function getAgent(id: string): Promise<{ agent: Agent }> {
  return request("GET", `/api/agents/${id}`);
}

export function createAgent(data: CreateAgentData): Promise<{ agent: Agent }> {
  return request("POST", "/api/agents", data);
}

export function updateAgent(
  id: string,
  data: UpdateAgentData,
): Promise<{ agent: Agent }> {
  return request("PUT", `/api/agents/${id}`, data);
}

export function deleteAgent(id: string): Promise<void> {
  return request("DELETE", `/api/agents/${id}`);
}

export function getAgentStats(
  id: string,
): Promise<{ stats: AgentStats; recentTasks: Task[] }> {
  return request("GET", `/api/agents/${id}/stats`);
}

// ---------------------------------------------------------------------------
// Project API
// ---------------------------------------------------------------------------

export function getProjects(): Promise<{ projects: Project[] }> {
  return request("GET", "/api/projects");
}

export function createProject(
  data: CreateProjectData,
): Promise<{ project: Project }> {
  return request("POST", "/api/projects", data);
}

export function updateProject(
  id: string,
  data: UpdateProjectData,
): Promise<{ project: Project }> {
  return request("PUT", `/api/projects/${id}`, data);
}

export function deleteProject(id: string): Promise<void> {
  return request("DELETE", `/api/projects/${id}`);
}

// ---------------------------------------------------------------------------
// Task API
// ---------------------------------------------------------------------------

export interface TaskQueryOptions {
  projectId?: string;
  status?: string;
  agentId?: string;
  q?: string;
  page?: number;
  limit?: number;
  includeDeleted?: boolean;
}

export function getTasks(
  opts?: TaskQueryOptions,
): Promise<PaginatedResponse<Task> & { tasks: Task[] }> {
  const params = new URLSearchParams();
  if (opts?.projectId) params.set("projectId", opts.projectId);
  if (opts?.status) params.set("status", opts.status);
  if (opts?.agentId) params.set("agentId", opts.agentId);
  if (opts?.q) params.set("q", opts.q);
  if (opts?.page) params.set("page", String(opts.page));
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.includeDeleted) params.set("includeDeleted", "true");
  const qs = params.toString();
  return request("GET", `/api/tasks${qs ? `?${qs}` : ""}`);
}

export function getTask(id: string): Promise<{ task: Task }> {
  return request("GET", `/api/tasks/${id}`);
}

export function createTask(data: CreateTaskData): Promise<{ task: Task }> {
  return request("POST", "/api/tasks", data);
}

export function updateTask(
  id: string,
  data: UpdateTaskData,
): Promise<{ task: Task }> {
  return request("PUT", `/api/tasks/${id}`, data);
}

export function deleteTask(id: string): Promise<void> {
  return request("DELETE", `/api/tasks/${id}`);
}

// Task actions

export function startTask(id: string): Promise<{ task: Task }> {
  return request("POST", `/api/tasks/${id}/start`);
}

export function stopTask(id: string): Promise<{ task: Task }> {
  return request("POST", `/api/tasks/${id}/stop`);
}

export function doneTask(id: string): Promise<{ task: Task }> {
  return request("POST", `/api/tasks/${id}/done`);
}

export function messageTask(
  id: string,
  message: string,
  allowTool?: string,
): Promise<{ task: Task }> {
  return request("POST", `/api/tasks/${id}/message`, { message, allowTool });
}

export function approveTool(
  id: string,
  decision: "allow" | "deny",
): Promise<void> {
  return request("POST", `/api/tasks/${id}/approve-tool`, { decision });
}

export function retryTask(id: string): Promise<{ task: Task }> {
  return request("POST", `/api/tasks/${id}/retry`);
}

// ---------------------------------------------------------------------------
// Event API
// ---------------------------------------------------------------------------

export interface EventQueryOptions {
  type?: string;
  page?: number;
  limit?: number;
}

export function getTaskEvents(
  taskId: string,
  opts?: EventQueryOptions,
): Promise<PaginatedResponse<Event> & { events: Event[] }> {
  const params = new URLSearchParams();
  if (opts?.type) params.set("type", opts.type);
  if (opts?.page) params.set("page", String(opts.page));
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return request(
    "GET",
    `/api/tasks/${taskId}/events${qs ? `?${qs}` : ""}`,
  );
}

export function getTaskSdkStatus(
  taskId: string,
): Promise<{ running: boolean; turnCount: number; budgetUsed: number; maxBudgetUsd: number }> {
  return request("GET", `/api/tasks/${taskId}/sdk-status`);
}

// ---------------------------------------------------------------------------
// Copilot API
// ---------------------------------------------------------------------------

export function sendCopilotMessage(
  params: { sessionId?: string; message: string },
): Promise<CopilotChatResponse> {
  return request("POST", "/api/copilot/chat", params);
}

export function confirmCopilotAction(
  sessionId: string,
  actionIndex: number,
  confirmed: boolean,
): Promise<CopilotConfirmResponse> {
  return request("POST", "/api/copilot/confirm", {
    sessionId,
    actionIndex,
    confirmed,
  });
}

export function createCopilotSession(): Promise<{ sessionId: string }> {
  return request("POST", "/api/copilot/session");
}

export function deleteCopilotSession(sessionId: string): Promise<{ ok: boolean }> {
  return request("DELETE", `/api/copilot/session/${sessionId}`);
}
