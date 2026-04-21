import {
  createContext,
  useContext,
  useReducer,
  useEffect,

  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { Agent, Task, Project } from "../types";
import * as api from "../api/client";
import { useWebSocket, type WSHandlers } from "../hooks/useWebSocket";

// ---------------------------------------------------------------------------
// Notification
// ---------------------------------------------------------------------------

export interface Notification {
  id: string;
  type: "info" | "warning" | "error" | "stuck" | "success";
  message: string;
  timestamp: number;
  taskId?: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface AppState {
  agents: Map<string, Agent>;
  tasks: Map<string, Task>;
  projects: Project[];
  selectedTaskId: string | null;
  selectedAgentId: string | null;
  notifications: Notification[];
  wsConnected: boolean;
  activeProjectId: string | null;
  loading: boolean;
}

const initialState: AppState = {
  agents: new Map(),
  tasks: new Map(),
  projects: [],
  selectedTaskId: null,
  selectedAgentId: null,
  notifications: [],
  wsConnected: false,
  activeProjectId: null,
  loading: true,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type AppAction =
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_AGENTS"; agents: Agent[] }
  | { type: "UPDATE_AGENT"; agent: Agent }
  | { type: "REMOVE_AGENT"; agentId: string }
  | { type: "SET_TASKS"; tasks: Task[] }
  | { type: "UPDATE_TASK"; task: Task }
  | { type: "REMOVE_TASK"; taskId: string }
  | { type: "SET_PROJECTS"; projects: Project[] }
  | { type: "SET_SELECTED_TASK"; taskId: string | null }
  | { type: "SET_SELECTED_AGENT"; agentId: string | null }
  | { type: "ADD_NOTIFICATION"; notification: Notification }
  | { type: "DISMISS_NOTIFICATION"; id: string }
  | { type: "SET_WS_CONNECTED"; connected: boolean }
  | { type: "SET_ACTIVE_PROJECT"; projectId: string | null };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_LOADING":
      return { ...state, loading: action.loading };

    case "SET_AGENTS": {
      const agents = new Map<string, Agent>();
      for (const a of action.agents) agents.set(a.id, a);
      return { ...state, agents };
    }

    case "UPDATE_AGENT": {
      const agents = new Map(state.agents);
      agents.set(action.agent.id, action.agent);
      return { ...state, agents };
    }

    case "REMOVE_AGENT": {
      const agents = new Map(state.agents);
      agents.delete(action.agentId);
      return { ...state, agents };
    }

    case "SET_TASKS": {
      const tasks = new Map<string, Task>();
      for (const t of action.tasks) tasks.set(t.id, t);
      return { ...state, tasks };
    }

    case "UPDATE_TASK": {
      const tasks = new Map(state.tasks);
      tasks.set(action.task.id, action.task);
      return { ...state, tasks };
    }

    case "REMOVE_TASK": {
      const tasks = new Map(state.tasks);
      tasks.delete(action.taskId);
      return { ...state, tasks };
    }

    case "SET_PROJECTS":
      return { ...state, projects: action.projects };

    case "SET_SELECTED_TASK":
      return { ...state, selectedTaskId: action.taskId };

    case "SET_SELECTED_AGENT":
      return { ...state, selectedAgentId: action.agentId };

    case "ADD_NOTIFICATION": {
      const MAX_NOTIFICATIONS = 3;
      const incoming = action.notification;
      let current = [...state.notifications, incoming];

      // Enforce max 3: remove oldest non-stuck notifications
      if (current.length > MAX_NOTIFICATIONS) {
        const stuck = current.filter((n) => n.type === "stuck");
        const nonStuck = current.filter((n) => n.type !== "stuck");
        const excess = current.length - MAX_NOTIFICATIONS;
        nonStuck.splice(0, excess);
        current = [...nonStuck, ...stuck];
      }

      return { ...state, notifications: current };
    }

    case "DISMISS_NOTIFICATION":
      return {
        ...state,
        notifications: state.notifications.filter(
          (n) => n.id !== action.id,
        ),
      };

    case "SET_WS_CONNECTED":
      return { ...state, wsConnected: action.connected };

    case "SET_ACTIVE_PROJECT":
      return { ...state, activeProjectId: action.projectId };
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useAppState(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppState must be used within AppProvider");
  return ctx.state;
}

export function useAppDispatch(): React.Dispatch<AppAction> {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppDispatch must be used within AppProvider");
  return ctx.dispatch;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // Register global API error handler
  useEffect(() => {
    api.setApiErrorHandler((error) => {
      dispatch({
        type: "ADD_NOTIFICATION",
        notification: {
          id: crypto.randomUUID(),
          type: "error",
          message: error.message,
          timestamp: Date.now(),
        },
      });
    });
  }, []);

  // Load initial data from API
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [agentsRes, tasksRes, projectsRes] = await Promise.all([
          api.getAgents(),
          api.getTasks(),
          api.getProjects(),
        ]);

        if (cancelled) return;

        dispatch({ type: "SET_AGENTS", agents: agentsRes.agents });
        dispatch({
          type: "SET_TASKS",
          tasks: tasksRes.tasks ?? tasksRes.items ?? [],
        });
        dispatch({ type: "SET_PROJECTS", projects: projectsRes.projects });
        dispatch({ type: "SET_LOADING", loading: false });
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to load initial data:", err);
        dispatch({ type: "SET_LOADING", loading: false });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // WebSocket handlers
  const wsHandlers: WSHandlers = useMemo(
    () => ({
      onTaskUpdate: (data) => {
        const task = data as Task;
        if (task?.id) {
          dispatch({ type: "UPDATE_TASK", task });
        }
      },
      onAgentUpdate: (data) => {
        const agent = data as Agent;
        if (agent?.id) {
          dispatch({ type: "UPDATE_AGENT", agent });
        }
      },
      onEventNew: (_data) => {
        // Events are loaded on demand via getTaskEvents
      },
      onToolApproval: (data) => {
        const d = data as { taskId?: string; toolName?: string };
        dispatch({
          type: "ADD_NOTIFICATION",
          notification: {
            id: crypto.randomUUID(),
            type: "stuck",
            message: d.toolName
              ? `工具审批请求: ${d.toolName}`
              : "工具审批请求",
            timestamp: Date.now(),
            taskId: d.taskId,
          },
        });
      },
      onNotification: (data) => {
        const d = data as { message?: string; type?: string };
        dispatch({
          type: "ADD_NOTIFICATION",
          notification: {
            id: crypto.randomUUID(),
            type: (d.type as Notification["type"]) ?? "info",
            message: d.message ?? "收到通知",
            timestamp: Date.now(),
          },
        });
      },
      onError: (data) => {
        const d = data as { message?: string };
        dispatch({
          type: "ADD_NOTIFICATION",
          notification: {
            id: crypto.randomUUID(),
            type: "error",
            message: d.message ?? "WebSocket 错误",
            timestamp: Date.now(),
          },
        });
      },
    }),
    [],
  );

  const { connected, reconnectCount } = useWebSocket(wsHandlers);

  // Track previous connected state to detect reconnection
  const prevConnectedRef = useRef(false);

  useEffect(() => {
    dispatch({ type: "SET_WS_CONNECTED", connected });

    // Detect reconnection (was disconnected, now connected)
    if (connected && prevConnectedRef.current === false && reconnectCount > 0) {
      dispatch({
        type: "ADD_NOTIFICATION",
        notification: {
          id: crypto.randomUUID(),
          type: "info",
          message: "连接已恢复",
          timestamp: Date.now(),
        },
      });
    }
    prevConnectedRef.current = connected;
  }, [connected, reconnectCount]);

  const value = useMemo(
    () => ({ state, dispatch }),
    [state, dispatch],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
