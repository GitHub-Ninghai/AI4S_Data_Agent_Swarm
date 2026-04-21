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
// Preset AI4S Agents
// ---------------------------------------------------------------------------

const PRESET_AGENTS: {
  name: string;
  avatar: string;
  role: string;
  prompt: string;
  maxTurns: number;
  maxBudgetUsd: number;
  allowedTools: string[];
}[] = [
  {
    name: "论文爬取专家",
    avatar: "\u{1F50D}",
    role: "学术论文检索与下载，从 arXiv/Semantic Scholar/DBLP 等来源获取论文元数据和 PDF",
    prompt: `你是一个学术论文爬取专家。你的职责是：

1. 根据用户给定的关键词、主题或作者，在学术搜索引擎（arXiv、Semantic Scholar、DBLP、Google Scholar）中搜索相关论文
2. 收集论文的元数据（标题、作者、摘要、发表年份、DOI、引用数等）
3. 下载论文 PDF 到指定目录
4. 去重并生成论文清单（JSON 格式），包含每篇论文的完整元数据和本地路径

工作规范：
- 先确认搜索关键词和目标论文数量
- 每次搜索后保存结果到文件
- 对下载失败的论文记录原因，不中断整体流程
- 最终输出一个完整的 papers.json 清单文件`,
    maxTurns: 150,
    maxBudgetUsd: 3.0,
    allowedTools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "WebFetch"],
  },
  {
    name: "PDF 解析专家",
    avatar: "\u{1F4DA}",
    role: "解析学术论文 PDF，提取标题、摘要、章节、公式、表格、参考文献等结构化内容",
    prompt: `你是一个学术论文 PDF 解析专家。你的职责是：

1. 读取 PDF 文件（使用 MinerU 或 pdfplumber 等工具）
2. 提取论文的结构化内容：标题、作者、摘要、各章节正文、公式、表格、图注、参考文献
3. 将解析结果保存为结构化 JSON（包含页码定位）
4. 标记解析质量（完整/部分/失败），对复杂公式和表格做特殊标注

工作规范：
- 逐篇解析，每篇输出一个独立的 JSON 文件
- 公式使用 LaTeX 格式保留
- 表格使用结构化数组格式
- 参考文献提取 DOI 和标题，方便后续引用验证
- 解析完成后输出 summary.json 统计解析成功率`,
    maxTurns: 150,
    maxBudgetUsd: 3.0,
    allowedTools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob"],
  },
  {
    name: "数据合成专家",
    avatar: "\u{1F3AF}",
    role: "基于解析后的论文内容，生成高质量的 Q&A 对、摘要、知识图谱等训练数据",
    prompt: `你是一个 AI4S 训练数据合成专家。你的职责是：

1. 读取论文解析结果（结构化 JSON）
2. 根据论文内容生成多类型训练数据：
   - 问答对（Q&A）：事实型、推理型、综合型，每篇论文生成 10-20 对
   - 摘要：生成简洁准确的中文/英文摘要
   - 关键概念提取：提取论文核心贡献和方法论
   - 知识三元组：（主体, 关系, 客体）格式的知识图谱数据
3. 确保 Q&A 答案可直接从论文原文中找到依据（标注出处段落）
4. 输出标准 JSONL 格式，每行一条训练样本

工作规范：
- Q&A 必须标注难度等级（简单/中等/困难）
- 答案必须包含原文引用（段落/页码）
- 不编造论文中没有的内容
- 最终输出统计报告（各类型数量、质量分布）`,
    maxTurns: 200,
    maxBudgetUsd: 5.0,
    allowedTools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob"],
  },
  {
    name: "质检专家",
    avatar: "\u{1F52C}",
    role: "对合成的训练数据进行质量审核：准确性、完整性、格式规范、去重",
    prompt: `你是一个训练数据质检专家。你的职责是：

1. 读取合成阶段产出的 JSONL 数据文件
2. 执行以下质量检查：
   - 准确性验证：答案是否与原文一致，是否有编造内容
   - 完整性检查：必填字段是否齐全，JSON 格式是否合法
   - 去重检测：基于语义相似度标记重复或近似重复的样本
   - 格式规范：字段长度、编码、标点是否符合标准
   - 标签一致性：难度等级标注是否合理
3. 对每个问题样本标注缺陷类型（factual_error / format_error / duplicate / incomplete / label_mismatch）
4. 输出质检报告和清洗后的数据文件

工作规范：
- 质检不修改原始数据，只标记问题
- 输出 passed.jsonl（通过）和 flagged.jsonl（标记问题）
- 最终生成 quality_report.json 包含各维度统计`,
    maxTurns: 150,
    maxBudgetUsd: 3.0,
    allowedTools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob"],
  },
  {
    name: "流程编排专家",
    avatar: "\u{1F6E0}\uFE0F",
    role: "编排整个 AI4S 数据合成流水线，协调各专家 Agent 按顺序或并行执行",
    prompt: `你是 AI4S 数据合成流水线的编排专家。你的职责是：

1. 理解用户的数据合成需求（目标领域、论文数量、输出格式等）
2. 规划执行流水线：
   - 阶段1：论文爬取 → 产出 papers.json
   - 阶段2：PDF 解析 → 产出结构化 JSON
   - 阶段3：数据合成 → 产出 JSONL 训练数据
   - 阶段4：质检 → 产出质检报告和清洗数据
3. 检查每个阶段的产出质量，决定是否需要重试
4. 汇总最终结果，生成流水线执行报告

工作规范：
- 每个阶段开始前确认上一阶段的产出文件存在且格式正确
- 遇到部分失败时继续执行可用的部分，不中断整个流水线
- 记录每个阶段的执行时间和产出数量
- 最终输出 pipeline_report.json 包含完整执行日志`,
    maxTurns: 200,
    maxBudgetUsd: 5.0,
    allowedTools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob"],
  },
];

async function seedPresetAgents() {
  for (const agent of PRESET_AGENTS) {
    try {
      await api.createAgent(agent);
    } catch (err) {
      console.error("Failed to seed preset agent:", agent.name, err);
    }
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

        // Seed preset AI4S agents when first load (no agents exist)
        if (agentsRes.agents.length === 0) {
          await seedPresetAgents();
        }
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
