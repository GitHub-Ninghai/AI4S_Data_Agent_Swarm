// ---------------------------------------------------------------------------
// Copilot 核心服务 — 通过智谱 Anthropic 兼容代理调用 GLM 模型
// 使用 ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL（与 Claude Code 相同的配置）
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import * as agentStore from "../store/agentStore.js";
import * as taskStore from "../store/taskStore.js";
import * as projectStore from "../store/projectStore.js";
import type { CopilotAction } from "./copilotActions.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CopilotResponse {
  message: string;
  actions: CopilotAction[];
  needsConfirmation: boolean;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string | Anthropic.ContentBlockParam[];
}

interface Session {
  messages: ConversationMessage[];
  pendingActions: CopilotAction[];
  createdAt: number;
  lastActivityAt: number;
}

// ---------------------------------------------------------------------------
// Config — 复用 Claude Code 的环境变量
// ---------------------------------------------------------------------------

const COPILOT_AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || "";
const COPILOT_BASE_URL = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
const COPILOT_MODEL = process.env.COPILOT_MODEL || "glm-5";

function getClient(): Anthropic | null {
  if (!COPILOT_AUTH_TOKEN) return null;
  return new Anthropic({
    apiKey: COPILOT_AUTH_TOKEN,
    baseURL: COPILOT_BASE_URL,
  });
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

const sessions = new Map<string, Session>();
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_MESSAGES = 20;

// Periodic cleanup of expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivityAt > SESSION_TIMEOUT_MS) {
      sessions.delete(id);
    }
  }
}, 60_000).unref();

export function createSession(): string {
  const id = crypto.randomUUID();
  sessions.set(id, {
    messages: [],
    pendingActions: [],
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  });
  return id;
}

export function deleteSession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  const agents = agentStore.getAllAgents();
  const tasks = taskStore.getAllTasks();
  const projects = projectStore.getAllProjects();

  const agentList = agents
    .map((a) => `- ${a.name} (id: ${a.id}, status: ${a.status}, role: ${a.role})`)
    .join("\n");

  const taskSummary = {
    total: tasks.length,
    Todo: tasks.filter((t) => t.status === "Todo").length,
    Running: tasks.filter((t) => t.status === "Running").length,
    Done: tasks.filter((t) => t.status === "Done").length,
    Stuck: tasks.filter((t) => t.status === "Stuck").length,
  };

  const projectList = projects
    .map((p) => `- ${p.name} (id: ${p.id})`)
    .join("\n");

  return `你是 Agent Swarm 平台的 Copilot 副驾驶。用户通过自然语言与你对话，你帮助用户创建 Agent、创建 Task、创建流水线、修改配置、查询状态。

## 当前系统状态

### Agents
${agentList || "（暂无 Agent）"}

### Tasks 概况
- 总计: ${taskSummary.total}
- Todo: ${taskSummary.Todo}, Running: ${taskSummary.Running}, Done: ${taskSummary.Done}, Stuck: ${taskSummary.Stuck}

### Projects
${projectList || "（暂无 Project）"}

## 你的能力

1. **创建 Agent** — type: create_agent
2. **创建 Task** — type: create_task
3. **创建流水线** — type: create_pipeline（一次性创建多个关联 Task）
4. **创建数据流水线** — type: create_data_pipeline（预设 Q&A 或 Sci-Evo 流水线）
5. **更新 Agent** — type: update_agent
6. **更新 Task** — type: update_task
7. **查询状态** — type: query_status

## 预设 Agent 模板（AI4S 专家）

1. 论文爬取专家 — 从 Semantic Scholar API 搜索和下载学术论文 PDF
2. PDF 解析专家 — 使用 MinerU API 将 PDF 解析为结构化 Markdown
3. 数据合成专家 — 基于解析内容生成高质量 Q&A 训练数据
4. 质检专家 — 对合成数据进行质量审核和评分
5. 流程编排专家 — 编排多个 Agent 完成完整数据合成流水线
6. Sci-Evo 生成专家 — 基于论文解析结果生成科学演化三段式 JSON

## 交互规则

1. 用户意图不明确或参数不完整时，主动追问（不要调用工具，直接回复文字）
2. 所有创建/修改操作（create_agent, create_task, create_pipeline, update_agent, update_task）必须先调用 execute_action 工具生成预览，等待用户确认后执行
3. 查询类操作（query_status）可以直接调用工具执行，不需要确认
4. 当用户提到"创建流水线"或"完整流程"时，推荐 create_pipeline 类型
5. 当用户提到"生成训练数据"、"Q&A数据"、"问答对"时，推荐 create_data_pipeline（pipelineType: "qa"）
6. 当用户提到"Sci-Evo"、"科学演化"、"演化数据"时，推荐 create_data_pipeline（pipelineType: "scievo"）
7. 当用户提到某个预设专家时，自动推荐对应的模板参数，包括完整的 prompt
6. 使用中文回复

## 输出格式

当你需要执行操作时，调用 execute_action 工具。
当只需要文字回复（如追问、说明）时，直接返回文字内容，不调用工具。`;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const EXECUTE_ACTION_TOOL: Anthropic.Tool = {
  name: "execute_action",
  description: "执行一个操作（创建 Agent/Task、更新配置、查询状态等）",
  input_schema: {
    type: "object" as const,
    properties: {
      type: {
        type: "string" as const,
        enum: [
          "create_agent",
          "create_task",
          "create_pipeline",
          "create_data_pipeline",
          "update_agent",
          "update_task",
          "query_status",
        ],
        description: "操作类型",
      },
      summary: {
        type: "string" as const,
        description: "操作摘要（中文，展示给用户）",
      },
      params: {
        type: "object" as const,
        description: "操作参数",
        properties: {
          name: { type: "string" as const, description: "Agent 名称" },
          avatar: { type: "string" as const, description: "Agent 头像 emoji" },
          role: { type: "string" as const, description: "Agent 角色描述" },
          prompt: { type: "string" as const, description: "Agent 系统提示词" },
          projectId: { type: "string" as const, description: "关联项目 ID" },
          maxTurns: { type: "number" as const, description: "最大轮次" },
          maxBudgetUsd: { type: "number" as const, description: "预算上限 USD" },
          allowedTools: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "允许使用的工具列表",
          },
          title: { type: "string" as const, description: "Task 标题" },
          description: { type: "string" as const, description: "Task 描述" },
          agentId: { type: "string" as const, description: "关联 Agent ID" },
          priority: { type: "number" as const, description: "优先级 0/1/2" },
          tags: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "标签列表",
          },
          parentTaskId: { type: "string" as const, description: "父任务 ID（流水线用）" },
          steps: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                title: { type: "string" as const },
                description: { type: "string" as const },
                agentId: { type: "string" as const },
              },
            },
            description: "流水线步骤列表",
          },
          id: { type: "string" as const, description: "要更新的资源 ID" },
          target: { type: "string" as const, description: "查询目标: agents/tasks/projects/all" },
          pipelineType: { type: "string" as const, description: "数据流水线类型: qa 或 scievo（create_data_pipeline 用）" },
          pdfFiles: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "PDF 文件路径列表（create_data_pipeline 用）",
          },
        },
      },
      confirmationRequired: {
        type: "boolean" as const,
        description: "是否需要用户确认",
      },
    },
    required: ["type", "summary", "params", "confirmationRequired"] as const,
  },
};

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export async function chat(
  sessionId: string,
  userMessage: string,
): Promise<CopilotResponse> {
  const client = getClient();
  if (!client) {
    return {
      message:
        "Copilot 功能未配置。请确保 ANTHROPIC_AUTH_TOKEN 环境变量已设置。",
      actions: [],
      needsConfirmation: false,
    };
  }

  let session = sessions.get(sessionId);
  if (!session) {
    sessionId = createSession();
    session = sessions.get(sessionId)!;
  }

  // Update activity timestamp
  session.lastActivityAt = Date.now();

  // Add user message
  session.messages.push({ role: "user", content: userMessage });

  // Trim to last MAX_MESSAGES
  if (session.messages.length > MAX_MESSAGES) {
    session.messages = session.messages.slice(-MAX_MESSAGES);
  }

  const systemPrompt = buildSystemPrompt();

  try {
    const response = await client.messages.create({
      model: COPILOT_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: session.messages as Anthropic.MessageParam[],
      tools: [EXECUTE_ACTION_TOOL],
    });

    // Extract text and tool_use blocks from response
    const textParts: string[] = [];
    const actions: CopilotAction[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "tool_use") {
        const input = block.input as Record<string, unknown>;
        actions.push({
          type: input.type as CopilotAction["type"],
          summary: String(input.summary ?? ""),
          params: (input.params as Record<string, unknown>) ?? {},
          confirmationRequired: Boolean(input.confirmationRequired),
        });
      }
    }

    // Build assistant message for history
    const assistantContent: ConversationMessage["content"] = [];
    if (textParts.length > 0) {
      assistantContent.push({ type: "text", text: textParts.join("\n") });
    }
    for (const block of response.content) {
      if (block.type === "tool_use") {
        assistantContent.push(block);
      }
    }
    session.messages.push({ role: "assistant", content: assistantContent });

    // Trim again
    if (session.messages.length > MAX_MESSAGES) {
      session.messages = session.messages.slice(-MAX_MESSAGES);
    }

    // Store pending actions for confirmation
    session.pendingActions = actions;

    const needsConfirmation = actions.some(
      (a) => a.confirmationRequired && a.type !== "query_status",
    );

    return {
      message: textParts.join("\n"),
      actions,
      needsConfirmation,
    };
  } catch (err) {
    const errorMsg =
      err instanceof Error ? err.message : "调用 API 失败";
    console.error("[Copilot] API error:", errorMsg);
    return {
      message: `Copilot 暂时不可用: ${errorMsg}`,
      actions: [],
      needsConfirmation: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Confirm action
// ---------------------------------------------------------------------------

export function getPendingActions(sessionId: string): CopilotAction[] {
  const session = sessions.get(sessionId);
  return session?.pendingActions ?? [];
}

export function clearPendingActions(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.pendingActions = [];
  }
}
