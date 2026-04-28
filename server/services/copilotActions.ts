// ---------------------------------------------------------------------------
// Copilot 操作执行器 — 将 CopilotAction 转为实际数据操作
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import * as agentStore from "../store/agentStore.js";
import * as taskStore from "../store/taskStore.js";
import * as projectStore from "../store/projectStore.js";
import { broadcast } from "./wsBroadcaster.js";
import type { Agent, Task } from "../store/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CopilotActionType =
  | "create_agent"
  | "create_task"
  | "create_pipeline"
  | "create_data_pipeline"
  | "update_agent"
  | "update_task"
  | "query_status";

export interface CopilotAction {
  type: CopilotActionType;
  summary: string;
  params: Record<string, unknown>;
  confirmationRequired: boolean;
}

export interface ActionResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Defaults (matching routes/agents.ts)
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TURNS = 200;
const DEFAULT_MAX_BUDGET_USD = 5.0;
const DEFAULT_ALLOWED_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Glob",
  "WebFetch",
];

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

export function executeAction(action: CopilotAction): ActionResult {
  switch (action.type) {
    case "create_agent":
      return createAgent(action.params);
    case "create_task":
      return createTask(action.params);
    case "create_pipeline":
      return createPipeline(action.params);
    case "create_data_pipeline":
      return createDataPipeline(action.params);
    case "update_agent":
      return updateAgent(action.params);
    case "update_task":
      return updateTask(action.params);
    case "query_status":
      return queryStatus(action.params);
    default:
      return { success: false, message: `未知操作类型: ${action.type}` };
  }
}

// ---------------------------------------------------------------------------
// create_agent
// ---------------------------------------------------------------------------

function createAgent(params: Record<string, unknown>): ActionResult {
  const name = String(params.name ?? "");
  const avatar = String(params.avatar ?? "🤖");
  const role = String(params.role ?? "");
  const prompt = String(params.prompt ?? "");

  if (!name || !role || !prompt) {
    return { success: false, message: "缺少必要参数: name, role, prompt" };
  }

  const now = Date.now();
  const agent: Agent = {
    id: crypto.randomUUID(),
    name,
    avatar,
    role,
    prompt,
    isEnabled: true,
    status: "idle",
    projectId: params.projectId ? String(params.projectId) : undefined,
    maxTurns: typeof params.maxTurns === "number" ? params.maxTurns : DEFAULT_MAX_TURNS,
    maxBudgetUsd: typeof params.maxBudgetUsd === "number" ? params.maxBudgetUsd : DEFAULT_MAX_BUDGET_USD,
    allowedTools: Array.isArray(params.allowedTools)
      ? params.allowedTools.map(String)
      : [...DEFAULT_ALLOWED_TOOLS],
    taskCount: 0,
    stats: {
      totalTasksCompleted: 0,
      totalTasksCancelled: 0,
      totalCostUsd: 0,
      avgDurationMs: 0,
    },
    lastEventAt: 0,
    createdAt: now,
    updatedAt: now,
  };

  agentStore.createAgent(agent);
  broadcast("agent:update", agent);

  return {
    success: true,
    message: `Agent "${name}" 创建成功`,
    data: { agentId: agent.id, agentName: agent.name },
  };
}

// ---------------------------------------------------------------------------
// create_task
// ---------------------------------------------------------------------------

function createTask(params: Record<string, unknown>): ActionResult {
  const title = String(params.title ?? "");
  const description = String(params.description ?? "");
  const agentId = String(params.agentId ?? "");
  const projectId = String(params.projectId ?? "");

  if (!title || !agentId) {
    return { success: false, message: "缺少必要参数: title, agentId" };
  }

  const agent = agentStore.getAgentById(agentId);
  if (!agent) {
    return { success: false, message: `Agent "${agentId}" 不存在` };
  }

  const now = Date.now();
  const task: Task = {
    id: crypto.randomUUID(),
    title,
    description,
    status: "Todo",
    agentId,
    projectId: projectId || agent.projectId || "",
    parentTaskId: params.parentTaskId ? String(params.parentTaskId) : undefined,
    priority: (params.priority as 0 | 1 | 2) ?? 1,
    tags: Array.isArray(params.tags) ? params.tags.map(String) : [],
    eventCount: 0,
    turnCount: 0,
    budgetUsed: 0,
    maxTurns: typeof params.maxTurns === "number" ? params.maxTurns : agent.maxTurns ?? DEFAULT_MAX_TURNS,
    maxBudgetUsd: typeof params.maxBudgetUsd === "number" ? params.maxBudgetUsd : agent.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD,
    createdAt: now,
  };

  taskStore.createTask(task);
  broadcast("task:update", task);

  return {
    success: true,
    message: `Task "${title}" 创建成功`,
    data: { taskId: task.id, taskTitle: task.title },
  };
}

// ---------------------------------------------------------------------------
// create_pipeline — 创建多个关联 Task
// ---------------------------------------------------------------------------

function createPipeline(params: Record<string, unknown>): ActionResult {
  const steps = params.steps as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(steps) || steps.length === 0) {
    return { success: false, message: "pipeline 至少需要一个 step" };
  }

  const results: Array<{ taskId: string; title: string }> = [];
  let parentTaskId: string | undefined;

  for (const step of steps) {
    const title = String(step.title ?? "");
    const agentId = String(step.agentId ?? "");
    if (!title || !agentId) {
      return {
        success: false,
        message: `pipeline 步骤缺少 title 或 agentId`,
        data: { createdTasks: results },
      };
    }

    const result = createTask({
      ...step,
      parentTaskId,
    });

    if (!result.success) {
      return {
        success: false,
        message: `pipeline 步骤 "${title}" 创建失败: ${result.message}`,
        data: { createdTasks: results },
      };
    }

    const taskId = (result.data as Record<string, string>).taskId;
    parentTaskId = taskId;
    results.push({ taskId, title });
  }

  return {
    success: true,
    message: `Pipeline 创建成功，共 ${results.length} 个任务`,
    data: { tasks: results },
  };
}

// ---------------------------------------------------------------------------
// update_agent
// ---------------------------------------------------------------------------

function updateAgent(params: Record<string, unknown>): ActionResult {
  const id = String(params.id ?? params.agentId ?? "");
  if (!id) {
    return { success: false, message: "缺少 agent id" };
  }

  const existing = agentStore.getAgentById(id);
  if (!existing) {
    return { success: false, message: `Agent "${id}" 不存在` };
  }

  const patch: Record<string, unknown> = {};
  const allowedFields = [
    "name", "avatar", "role", "prompt", "projectId",
    "maxTurns", "maxBudgetUsd", "allowedTools", "isEnabled",
  ];

  for (const field of allowedFields) {
    if (params[field] !== undefined) {
      patch[field] = params[field];
    }
  }

  const updated = agentStore.updateAgent(id, patch);
  if (!updated) {
    return { success: false, message: "更新 Agent 失败" };
  }

  broadcast("agent:update", updated);

  return {
    success: true,
    message: `Agent "${updated.name}" 更新成功`,
    data: { agentId: updated.id, agentName: updated.name },
  };
}

// ---------------------------------------------------------------------------
// update_task
// ---------------------------------------------------------------------------

function updateTask(params: Record<string, unknown>): ActionResult {
  const id = String(params.id ?? params.taskId ?? "");
  if (!id) {
    return { success: false, message: "缺少 task id" };
  }

  const existing = taskStore.getTaskById(id);
  if (!existing) {
    return { success: false, message: `Task "${id}" 不存在` };
  }

  const patch: Record<string, unknown> = {};
  const allowedFields = [
    "title", "description", "agentId", "priority", "tags",
  ];

  for (const field of allowedFields) {
    if (params[field] !== undefined) {
      patch[field] = params[field];
    }
  }

  const updated = taskStore.updateTask(id, patch);
  if (!updated) {
    return { success: false, message: "更新 Task 失败" };
  }

  broadcast("task:update", updated);

  return {
    success: true,
    message: `Task "${updated.title}" 更新成功`,
    data: { taskId: updated.id, taskTitle: updated.title },
  };
}

// ---------------------------------------------------------------------------
// query_status — 只读查询
// ---------------------------------------------------------------------------

function queryStatus(params: Record<string, unknown>): ActionResult {
  const target = String(params.target ?? "all");

  const agents = agentStore.getAllAgents();
  const tasks = taskStore.getAllTasks();
  const projects = projectStore.getAllProjects();

  if (target === "agents" || target === "all") {
    const summary = agents.map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      role: a.role,
      taskCount: a.taskCount,
    }));

    return {
      success: true,
      message: `共 ${agents.length} 个 Agent`,
      data: { agents: summary },
    };
  }

  if (target === "tasks" || target === "all") {
    const statusCounts = {
      Todo: tasks.filter((t) => t.status === "Todo").length,
      Running: tasks.filter((t) => t.status === "Running").length,
      Done: tasks.filter((t) => t.status === "Done").length,
      Stuck: tasks.filter((t) => t.status === "Stuck").length,
      Cancelled: tasks.filter((t) => t.status === "Cancelled").length,
    };

    return {
      success: true,
      message: `共 ${tasks.length} 个 Task`,
      data: { taskStatusCounts: statusCounts, totalTasks: tasks.length },
    };
  }

  if (target === "projects") {
    return {
      success: true,
      message: `共 ${projects.length} 个 Project`,
      data: { projects: projects.map((p) => ({ id: p.id, name: p.name })) },
    };
  }

  return {
    success: true,
    message: "系统状态",
    data: {
      agentCount: agents.length,
      taskCount: tasks.length,
      projectCount: projects.length,
    },
  };
}

// ---------------------------------------------------------------------------
// create_data_pipeline — 创建预设数据流水线（Q&A / Sci-Evo）
// ---------------------------------------------------------------------------

type PipelineType = "qa" | "scievo";

interface PipelineStepTemplate {
  agentName: string;
  title: string;
  description: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
}

const DATA_PIPELINE_TEMPLATES: Record<PipelineType, PipelineStepTemplate[]> = {
  qa: [
    {
      agentName: "PDF 解析专家",
      title: "PDF 解析",
      description: "使用 MinerU 解析上传的论文 PDF 为结构化 JSON",
      maxTurns: 150,
      maxBudgetUsd: 5.0,
    },
    {
      agentName: "数据合成专家",
      title: "Q&A 数据合成",
      description: "基于论文解析结果生成 Q&A 训练数据、知识三元组、摘要",
      maxTurns: 200,
      maxBudgetUsd: 5.0,
    },
    {
      agentName: "质检专家",
      title: "数据质检",
      description: "对合成数据执行质量审核：格式检查、事实验证、去重检测",
      maxTurns: 100,
      maxBudgetUsd: 3.0,
    },
  ],
  scievo: [
    {
      agentName: "PDF 解析专家",
      title: "PDF 解析",
      description: "使用 MinerU 解析上传的论文 PDF 为结构化 JSON",
      maxTurns: 150,
      maxBudgetUsd: 5.0,
    },
    {
      agentName: "Sci-Evo 生成专家",
      title: "Sci-Evo 科学演化数据生成",
      description: "基于论文解析结果生成 Sci-Evo 三段式 JSON 数据",
      maxTurns: 150,
      maxBudgetUsd: 5.0,
    },
  ],
};

function createDataPipeline(params: Record<string, unknown>): ActionResult {
  const pipelineType = String(params.pipelineType ?? "") as PipelineType;
  const projectId = String(params.projectId ?? "");
  const pdfFiles = params.pdfFiles as string[] | undefined;

  if (pipelineType !== "qa" && pipelineType !== "scievo") {
    return { success: false, message: "pipelineType 必须是 'qa' 或 'scievo'" };
  }

  if (!projectId) {
    return { success: false, message: "缺少 projectId" };
  }

  const project = projectStore.getProjectById(projectId);
  if (!project) {
    return { success: false, message: `Project "${projectId}" 不存在` };
  }

  const steps = DATA_PIPELINE_TEMPLATES[pipelineType];
  const pdfList = Array.isArray(pdfFiles) ? pdfFiles.join(", ") : "（用户将通过流水线弹窗选择）";
  const pipelineLabel = pipelineType === "qa" ? "Q&A 训练数据" : "Sci-Evo 科学演化";

  const results: Array<{ taskId: string; title: string }> = [];
  let parentTaskId: string | undefined;

  for (const step of steps) {
    const agents = agentStore.getAllAgents();
    const agent = agents.find((a) => a.name === step.agentName);

    if (!agent) {
      return {
        success: false,
        message: `找不到预置 Agent: "${step.agentName}"`,
        data: { createdTasks: results },
      };
    }

    const now = Date.now();
    const task: Task = {
      id: crypto.randomUUID(),
      title: step.title,
      description: `${step.description}\n\n流水线类型: ${pipelineLabel}\nPDF 文件: ${pdfList}\n项目路径: ${project.path}`,
      status: "Todo",
      agentId: agent.id,
      projectId,
      parentTaskId,
      pipelineType,
      inputFiles: Array.isArray(pdfFiles) ? pdfFiles : undefined,
      priority: 1,
      tags: [pipelineType, "pipeline", step.title],
      eventCount: 0,
      turnCount: 0,
      budgetUsed: 0,
      maxTurns: step.maxTurns ?? DEFAULT_MAX_TURNS,
      maxBudgetUsd: step.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD,
      createdAt: now,
    };

    taskStore.createTask(task);
    agentStore.updateAgent(agent.id, { taskCount: agent.taskCount + 1 });
    broadcast("task:update", task);
    broadcast("agent:update", agentStore.getAgentById(agent.id));

    parentTaskId = task.id;
    results.push({ taskId: task.id, title: task.title });
  }

  return {
    success: true,
    message: `${pipelineLabel}流水线创建成功，共 ${results.length} 个任务`,
    data: { tasks: results, pipelineType, projectId },
  };
}
