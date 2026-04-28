// ---------------------------------------------------------------------------
// 数据流水线路由 — 创建预设数据流水线（Q&A / Sci-Evo）
// ---------------------------------------------------------------------------

import { Router } from "express";
import crypto from "node:crypto";
import * as taskStore from "../store/taskStore.js";
import * as agentStore from "../store/agentStore.js";
import * as projectStore from "../store/projectStore.js";
import { broadcast } from "../services/wsBroadcaster.js";
import type { Task } from "../store/types.js";

export const pipelineRouter = Router();

// ---------------------------------------------------------------------------
// Pipeline type definitions
// ---------------------------------------------------------------------------

type PipelineType = "qa" | "scievo";

interface PipelineStep {
  agentName: string;
  title: string;
  description: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
}

const PIPELINE_TEMPLATES: Record<PipelineType, PipelineStep[]> = {
  qa: [
    {
      agentName: "PDF 解析专家",
      title: "PDF 解析",
      description: "使用 MinerU 解析上传的论文 PDF 为结构化 JSON，提取标题、摘要、章节、公式、表格、参考文献",
      maxTurns: 150,
      maxBudgetUsd: 5.0,
    },
    {
      agentName: "数据合成专家",
      title: "Q&A 数据合成",
      description: "基于论文解析结果生成高质量 Q&A 训练数据、知识三元组、章节摘要",
      maxTurns: 200,
      maxBudgetUsd: 5.0,
    },
    {
      agentName: "质检专家",
      title: "数据质检",
      description: "对合成训练数据执行质量审核：格式检查、事实验证、去重检测、标签校验",
      maxTurns: 100,
      maxBudgetUsd: 3.0,
    },
  ],
  scievo: [
    {
      agentName: "PDF 解析专家",
      title: "PDF 解析",
      description: "使用 MinerU 解析上传的论文 PDF 为结构化 JSON，提取标题、摘要、章节、公式、表格、参考文献",
      maxTurns: 150,
      maxBudgetUsd: 5.0,
    },
    {
      agentName: "Sci-Evo 生成专家",
      title: "Sci-Evo 科学演化数据生成",
      description: "基于论文解析结果生成 Sci-Evo 科学演化三段式 JSON 数据：问题建模→方法设计→验证分析",
      maxTurns: 150,
      maxBudgetUsd: 5.0,
    },
  ],
};

// ---------------------------------------------------------------------------
// POST /api/pipeline/create — 创建数据流水线
// ---------------------------------------------------------------------------

pipelineRouter.post("/create", (req, res) => {
  const { pipelineType, projectId, pdfFiles, maxTurns, maxBudgetUsd } = req.body as {
    pipelineType: PipelineType;
    projectId: string;
    pdfFiles: string[];
    maxTurns?: number;
    maxBudgetUsd?: number;
  };

  // 验证 pipelineType
  if (pipelineType !== "qa" && pipelineType !== "scievo") {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "pipelineType must be 'qa' or 'scievo'",
      },
    });
  }

  // 验证 projectId
  if (!projectId) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "projectId is required" },
    });
  }

  const project = projectStore.getProjectById(projectId);
  if (!project) {
    return res.status(404).json({
      error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
    });
  }

  // 验证 pdfFiles
  if (!Array.isArray(pdfFiles) || pdfFiles.length === 0) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "pdfFiles must be a non-empty array" },
    });
  }

  // 获取流水线模板
  const steps = PIPELINE_TEMPLATES[pipelineType];
  if (!steps) {
    return res.status(400).json({
      error: { code: "INVALID_PIPELINE", message: `Unknown pipeline type: ${pipelineType}` },
    });
  }

  // 构建 PDF 文件列表描述
  const pdfList = pdfFiles.join(", ");
  const pipelineLabel = pipelineType === "qa" ? "Q&A 训练数据" : "Sci-Evo 科学演化";

  // 为每个步骤查找对应 Agent 并创建 Task
  const createdTasks: Task[] = [];
  let parentTaskId: string | undefined;

  for (const step of steps) {
    // 按名称查找 Agent
    const agents = agentStore.getAllAgents();
    const agent = agents.find((a) => a.name === step.agentName);

    if (!agent) {
      return res.status(404).json({
        error: {
          code: "AGENT_NOT_FOUND",
          message: `找不到预置 Agent: "${step.agentName}"，请确保系统已初始化`,
        },
      });
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
      priority: 1,
      tags: [pipelineType, "pipeline", step.title],
      eventCount: 0,
      turnCount: 0,
      budgetUsed: 0,
      maxTurns: maxTurns ?? step.maxTurns ?? 200,
      maxBudgetUsd: maxBudgetUsd ?? step.maxBudgetUsd ?? 5.0,
      createdAt: now,
    };

    taskStore.createTask(task);
    agentStore.updateAgent(agent.id, { taskCount: agent.taskCount + 1 });

    broadcast("task:update", task);
    broadcast("agent:update", agentStore.getAgentById(agent.id));

    parentTaskId = task.id;
    createdTasks.push(task);
  }

  res.status(201).json({
    pipeline: {
      type: pipelineType,
      projectId,
      pdfFiles,
      tasks: createdTasks,
    },
  });
});
