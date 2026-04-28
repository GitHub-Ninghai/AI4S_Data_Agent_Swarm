import { useState, useEffect, useCallback, useRef } from "react";
import type { Task, CreateTaskData, UpdateTaskData, Agent } from "../../types";
import { useAppState, useAppDispatch } from "../../store/AppContext";
import * as api from "../../api/client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRIORITY_OPTIONS: { value: 0 | 1 | 2; label: string }[] = [
  { value: 0, label: "低" },
  { value: 1, label: "中" },
  { value: 2, label: "高" },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormState {
  title: string;
  description: string;
  agentId: string;
  projectId: string;
  priority: 0 | 1 | 2;
  tags: string[];
  tagInput: string;
  maxTurns: string;
  maxBudgetUsd: string;
  // New project inline creation
  newProjectName: string;
  newProjectPath: string;
  createNewProject: boolean;
}

interface FormErrors {
  title?: string;
  description?: string;
  agentId?: string;
  projectId?: string;
  tagInput?: string;
  newProjectName?: string;
  newProjectPath?: string;
  maxTurns?: string;
  maxBudgetUsd?: string;
}

interface TaskFormModalProps {
  task?: Task;
  defaultAgentId?: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Agent-based task presets
// ---------------------------------------------------------------------------

const AGENT_PRESETS: Record<string, { title: string; description: string }> = {
  "论文爬取专家": {
    title: "论文爬取 — 【替换为搜索关键词】",
    description: `## 搜索范围
- 关键词：【替换为具体关键词，如 "microgrid voltage control"】
- 目标论文数量：5-10 篇
- 输出目录：papers/

## 工作要求
1. 优先使用 Semantic Scholar API 搜索
2. 优先选择有 arXiv ID 或开放获取 PDF 的论文
3. PDF 下载后验证文件大小 > 100KB 且文件头为 %PDF-
4. 输出 papers.json 清单`,
  },
  "PDF 解析专家": {
    title: "PDF 解析 — 【替换为论文标识】",
    description: `## 解析范围
- 输入目录：papers/
- 输出目录：parsed_papers/
- 解析模式：extract + VLM（保留公式、表格、图片）

## 工作要求
1. 使用 mineru-open-api extract --model vlm 解析
2. 生成结构化 JSON（标题、摘要、章节、公式、表格、图片、参考文献）
3. 每篇论文生成独立的 _structured.json
4. 输出 summary.json 统计解析结果`,
  },
  "数据合成专家": {
    title: "数据合成 — 【替换为论文标识】",
    description: `## 合成范围
- 输入目录：parsed_papers/
- 输出目录：parsed_papers/（与输入同目录）

## 工作要求
1. 读取 _structured.json，一次处理一篇论文
2. 生成 Q&A 问答对（至少 15 对：simple 5 + medium 5 + hard 5）
3. 生成知识三元组（至少 20 条）
4. 生成章节摘要（summaries.json）
5. 输出 synthesis_report.json 统计报告`,
  },
  "质检专家": {
    title: "数据质检 — 【替换为论文标识】",
    description: `## 质检范围
- 输入目录：parsed_papers/

## 工作要求
1. 格式检查：JSON 合法性、必填字段、difficulty 值范围
2. 内容检查：对照 _structured.json 验证事实准确性
3. 去重检查：问题语义相似度 > 80% 标记为重复
4. 输出 passed.jsonl、flagged.jsonl、quality_report.json
5. 质检不修改原始数据，只标记问题`,
  },
  "流程编排专家": {
    title: "完整流水线 — 【替换为搜索关键词】",
    description: `## 流水线配置
- 搜索关键词：【替换为具体关键词】
- 论文数量：5 篇
- 输出目录：项目根目录

## 流水线阶段
1. 论文爬取 → papers.json + papers/*.pdf
2. PDF 解析 → parsed_papers/*/_structured.json
3. 数据合成 → qa_pairs.jsonl + knowledge_triples.jsonl + summaries.json
4. 数据质检 → passed.jsonl + flagged.jsonl + quality_report.json
5. 输出 pipeline_report.json`,
  },
  "Sci-Evo 生成专家": {
    title: "Sci-Evo 数据生成 — 【替换为论文标识】",
    description: `## 生成范围
- 输入目录：parsed_papers/
- 输出目录：sci_evo_data/

## 工作要求
1. 读取 _structured.json 和 output.md，一次处理一篇论文
2. 分析论文科研闭环：问题 → 假设 → 方法 → 验证 → 结论
3. 生成 5-8 个 trajectory step，thought 含 [Background][Gap][Decision]
4. action 类型：theoretical_derivation / algorithm_design / simulation / experimental_validation / parameter_tuning
5. 输出 sci_evo_data/Sci-Evo_<paper_id>.json
6. 验证 JSON 三段式结构完整性`,
  },
};

function getAgentPreset(agent: Agent | undefined): { title: string; description: string } {
  if (!agent) return { title: "", description: "" };
  const preset = AGENT_PRESETS[agent.name];
  if (preset) return preset;
  // Fallback: generate from agent metadata
  return {
    title: `${agent.name} — 【替换为任务描述】`,
    description: `## 任务说明\n使用 ${agent.name} 完成以下工作：\n\n【请替换为具体任务描述，至少 10 个字符】`,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  const title = form.title.trim();

  if (!title) {
    errors.title = "标题不能为空";
  } else if (title.length > 100) {
    errors.title = "标题不能超过 100 个字符";
  }

  const desc = form.description.trim();
  if (!desc) {
    errors.description = "描述不能为空";
  } else if (desc.length < 10) {
    errors.description = "描述至少 10 个字符";
  } else if (desc.length > 10000) {
    errors.description = "描述不能超过 10000 个字符";
  }

  if (!form.agentId) {
    errors.agentId = "必须选择 Agent";
  }

  if (form.createNewProject) {
    const name = form.newProjectName.trim();
    if (!name) {
      errors.newProjectName = "项目名称不能为空";
    } else if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      errors.newProjectName = "只允许字母、数字、下划线和连字符";
    }
    if (!form.newProjectPath.trim()) {
      errors.newProjectPath = "项目路径不能为空";
    }
  } else {
    if (!form.projectId) {
      errors.projectId = "必须选择 Project";
    }
  }

  if (form.tags.length >= 10 && form.tagInput.trim()) {
    errors.tagInput = "最多 10 个标签";
  }

  if (form.maxTurns) {
    const v = Number(form.maxTurns);
    if (isNaN(v) || v < 1 || v > 500) {
      errors.maxTurns = "最大轮次范围: 1-500";
    }
  }

  if (form.maxBudgetUsd) {
    const v = Number(form.maxBudgetUsd);
    if (isNaN(v) || v < 0.1 || v > 50) {
      errors.maxBudgetUsd = "预算上限范围: 0.1-50.0";
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskFormModal({ task, defaultAgentId, onClose }: TaskFormModalProps) {
  const isEdit = !!task;
  const { agents, projects, activeProjectId } = useAppState();
  const dispatch = useAppDispatch();
  const descFileRef = useRef<HTMLInputElement>(null);

  const enabledAgents = [...agents.values()].filter((a) => a.isEnabled);

  // Resolve the initial agent — from drag-drop, or fallback to first enabled agent
  const initAgentId = task
    ? task.agentId
    : (defaultAgentId ?? enabledAgents[0]?.id ?? "");
  const initAgent = initAgentId ? agents.get(initAgentId) : undefined;
  const preset = !isEdit && initAgent ? getAgentPreset(initAgent) : null;

  const [form, setForm] = useState<FormState>(() => {
    if (task) {
      return {
        title: task.title,
        description: task.description,
        agentId: task.agentId,
        projectId: task.projectId,
        priority: task.priority,
        tags: [...task.tags],
        tagInput: "",
        maxTurns: task.maxTurns ? String(task.maxTurns) : "",
        maxBudgetUsd: task.maxBudgetUsd ? String(task.maxBudgetUsd) : "",
        newProjectName: "",
        newProjectPath: "",
        createNewProject: false,
      };
    }
    return {
      title: preset?.title ?? "",
      description: preset?.description ?? "",
      agentId: initAgentId,
      projectId: activeProjectId ?? "",
      priority: 1,
      tags: [],
      tagInput: "",
      maxTurns: "",
      maxBudgetUsd: "",
      newProjectName: "",
      newProjectPath: "",
      createNewProject: false,
    };
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Edit mode: only Todo tasks can change agentId
  const canChangeAgent = !isEdit || task?.status === "Todo";

  // Status icon for agent dropdown
  const STATUS_ICONS: Record<string, string> = {
    idle: "🟢",
    working: "🔵",
    stuck: "🟡",
    offline: "⚫",
  };

  // Agent status warning
  const selectedAgent = form.agentId ? agents.get(form.agentId) : null;
  const agentWarning = selectedAgent
    ? selectedAgent.status === "working"
      ? { type: "warning" as const, message: "⚠️ 该 Agent 当前正在执行任务，启动按钮将置灰直到 Agent 空闲" }
      : selectedAgent.status === "stuck"
        ? { type: "warning" as const, message: "⚠️ 该 Agent 当前阻塞中，启动按钮将置灰直到 Agent 恢复" }
        : selectedAgent.status === "offline"
          ? { type: "error" as const, message: "⚠️ 该 Agent 已停用，无法启动任务" }
          : null
    : null;

  const validateForm = useCallback(() => {
    setErrors(validate(form));
  }, [form]);

  useEffect(() => {
    validateForm();
  }, [validateForm]);

  const hasErrors = Object.values(errors).some((e) => !!e);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // When changing agentId in create mode, auto-fill title/description preset
      if (key === "agentId" && !isEdit && typeof value === "string" && value) {
        const agent = agents.get(value);
        const p = getAgentPreset(agent);
        // Only fill if user hasn't customized (still matches old preset or is empty)
        const oldAgent = prev.agentId ? agents.get(prev.agentId) : undefined;
        const oldPreset = getAgentPreset(oldAgent);
        const titleIsDefault = !prev.title || prev.title === oldPreset.title;
        const descIsDefault = !prev.description || prev.description === oldPreset.description;
        if (titleIsDefault) next.title = p.title;
        if (descIsDefault) next.description = p.description;
      }
      return next;
    });
    setSubmitError(null);
  }

  // File upload for description
  function handleDescFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = [".txt", ".md", ".markdown"];
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    if (!allowed.includes(ext)) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") {
        setForm((prev) => {
          const current = prev.description.trim();
          return {
            ...prev,
            description: current ? `${current}\n\n--- 上传文件: ${file.name} ---\n\n${text}` : text,
          };
        });
        setSubmitError(null);
      }
    };
    reader.readAsText(file);
    // Reset input so the same file can be re-selected
    e.target.value = "";
  }

  function addTag() {
    const tag = form.tagInput.trim();
    if (!tag) return;
    if (tag.length > 20) return;
    if (form.tags.length >= 10) return;
    if (form.tags.includes(tag)) return;
    setForm((prev) => ({
      ...prev,
      tags: [...prev.tags, tag],
      tagInput: "",
    }));
    setSubmitError(null);
  }

  function removeTag(tag: string) {
    setForm((prev) => ({
      ...prev,
      tags: prev.tags.filter((t) => t !== tag),
    }));
  }

  async function handleSubmit() {
    const validationErrors = validate(form);
    setErrors(validationErrors);
    if (Object.values(validationErrors).some((e) => !!e)) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      let projectId = form.projectId;

      // Create new project if needed
      if (form.createNewProject) {
        const projRes = await api.createProject({
          name: form.newProjectName.trim(),
          path: form.newProjectPath.trim(),
        });
        projectId = projRes.project.id;
        dispatch({ type: "SET_PROJECTS", projects: [...projects, projRes.project] });
      }

      if (isEdit && task) {
        const data: UpdateTaskData = {
          title: form.title.trim(),
          description: form.description.trim(),
          priority: form.priority,
          tags: form.tags,
        };
        if (canChangeAgent) {
          data.agentId = form.agentId;
        }
        const res = await api.updateTask(task.id, data);
        dispatch({ type: "UPDATE_TASK", task: res.task });
      } else {
        const data: CreateTaskData = {
          title: form.title.trim(),
          description: form.description.trim(),
          agentId: form.agentId,
          projectId: projectId!,
          priority: form.priority,
          tags: form.tags.length > 0 ? form.tags : undefined,
          maxTurns: form.maxTurns ? Number(form.maxTurns) : undefined,
          maxBudgetUsd: form.maxBudgetUsd ? Number(form.maxBudgetUsd) : undefined,
        };
        const res = await api.createTask(data);
        dispatch({ type: "UPDATE_TASK", task: res.task });
      }
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "操作失败";
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? "编辑 Task" : "创建 Task"}</h2>
          <button className="modal-close" onClick={onClose}>
            {"\u00D7"}
          </button>
        </div>

        <div className="modal-body">
          {/* Title */}
          <label className="form-label">
            标题
            <input
              className={`form-input ${errors.title ? "form-input-error" : ""}`}
              value={form.title}
              onChange={(e) => updateField("title", e.target.value)}
              placeholder="Task 标题"
              maxLength={100}
            />
            <span className="form-count">{form.title.length}/100</span>
            {errors.title && <span className="form-error">{errors.title}</span>}
          </label>

          {/* Description */}
          <label className="form-label">
            <div className="form-label-row">
              <span>描述</span>
              <button
                type="button"
                className="btn btn-small btn-file-upload"
                onClick={() => descFileRef.current?.click()}
                title="上传 .txt 或 .md 文件到描述区域"
              >
                上传文件
              </button>
              <input
                ref={descFileRef}
                type="file"
                accept=".txt,.md,.markdown"
                style={{ display: "none" }}
                onChange={handleDescFileUpload}
              />
            </div>
            <textarea
              className={`form-textarea ${errors.description ? "form-input-error" : ""}`}
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
              placeholder="任务描述，支持 Markdown 格式（至少 10 个字符）"
              rows={8}
              maxLength={10000}
            />
            <span className="form-count">{form.description.length}/10000</span>
            {errors.description && <span className="form-error">{errors.description}</span>}
          </label>

          {/* Agent + Project row */}
          <div className="modal-row">
            <div className="modal-field">
              <label className="form-label">
                Agent
                <select
                  className={`form-select ${errors.agentId ? "form-input-error" : ""}`}
                  value={form.agentId}
                  onChange={(e) => updateField("agentId", e.target.value)}
                  disabled={!canChangeAgent}
                >
                  <option value="">选择 Agent</option>
                  {enabledAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {STATUS_ICONS[a.status] ?? "⚪"} {a.avatar} {a.name}
                    </option>
                  ))}
                </select>
                {errors.agentId && <span className="form-error">{errors.agentId}</span>}
                {agentWarning && (
                  <span className={`form-agent-warning ${agentWarning.type === "error" ? "form-agent-warning-error" : ""}`}>
                    {agentWarning.message}
                  </span>
                )}
                {isEdit && !canChangeAgent && (
                  <span className="form-hint">运行中的 Task 不可更改 Agent</span>
                )}
              </label>
            </div>
            <div className="modal-field">
              <label className="form-label">
                Project
                {!form.createNewProject ? (
                  <>
                    <div className="modal-row-inner">
                      <select
                        className={`form-select ${errors.projectId ? "form-input-error" : ""}`}
                        value={form.projectId}
                        onChange={(e) => updateField("projectId", e.target.value)}
                        disabled={isEdit}
                      >
                        <option value="">选择 Project</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      {!isEdit && (
                        <button
                          type="button"
                          className="btn btn-small btn-inline"
                          onClick={() => updateField("createNewProject", true)}
                        >
                          新建
                        </button>
                      )}
                    </div>
                    {errors.projectId && <span className="form-error">{errors.projectId}</span>}
                  </>
                ) : (
                  <>
                    <div className="modal-row-inner">
                      <input
                        className={`form-input ${errors.newProjectName ? "form-input-error" : ""}`}
                        value={form.newProjectName}
                        onChange={(e) => updateField("newProjectName", e.target.value)}
                        placeholder="项目名称"
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-inline"
                        onClick={() => updateField("createNewProject", false)}
                      >
                        取消
                      </button>
                    </div>
                    {errors.newProjectName && <span className="form-error">{errors.newProjectName}</span>}
                    <input
                      className={`form-input ${errors.newProjectPath ? "form-input-error" : ""}`}
                      value={form.newProjectPath}
                      onChange={(e) => updateField("newProjectPath", e.target.value)}
                      placeholder="项目绝对路径"
                      style={{ marginTop: "0.375rem" }}
                    />
                    {errors.newProjectPath && <span className="form-error">{errors.newProjectPath}</span>}
                  </>
                )}
              </label>
            </div>
          </div>

          {/* Priority */}
          <div className="form-label">
            优先级
            <div className="priority-group">
              {PRIORITY_OPTIONS.map((opt) => (
                <label key={opt.value} className="priority-option">
                  <input
                    type="radio"
                    name="priority"
                    checked={form.priority === opt.value}
                    onChange={() => updateField("priority", opt.value)}
                  />
                  <span className={`priority-label priority-${opt.value}`}>
                    {opt.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div className="form-label">
            标签
            <div className="tag-input-row">
              <input
                className={`form-input ${errors.tagInput ? "form-input-error" : ""}`}
                value={form.tagInput}
                onChange={(e) => updateField("tagInput", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="输入标签后按 Enter"
                maxLength={20}
              />
              <button
                type="button"
                className="btn btn-small btn-inline"
                onClick={addTag}
                disabled={!form.tagInput.trim() || form.tags.length >= 10}
              >
                添加
              </button>
            </div>
            {errors.tagInput && <span className="form-error">{errors.tagInput}</span>}
            {form.tags.length > 0 && (
              <div className="tag-list">
                {form.tags.map((tag) => (
                  <span key={tag} className="tag-item">
                    {tag}
                    <button
                      type="button"
                      className="tag-remove"
                      onClick={() => removeTag(tag)}
                    >
                      {"\u00D7"}
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Config row (optional overrides) */}
          <div className="modal-row">
            <div className="modal-field">
              <label className="form-label">
                最大轮次（留空继承 Agent 配置）
                <input
                  type="number"
                  className={`form-input ${errors.maxTurns ? "form-input-error" : ""}`}
                  value={form.maxTurns}
                  onChange={(e) => updateField("maxTurns", e.target.value)}
                  placeholder="继承 Agent 配置"
                  min={1}
                  max={500}
                />
                {errors.maxTurns && <span className="form-error">{errors.maxTurns}</span>}
              </label>
            </div>
            <div className="modal-field">
              <label className="form-label">
                预算上限 USD（留空继承 Agent 配置）
                <input
                  type="number"
                  className={`form-input ${errors.maxBudgetUsd ? "form-input-error" : ""}`}
                  value={form.maxBudgetUsd}
                  onChange={(e) => updateField("maxBudgetUsd", e.target.value)}
                  placeholder="继承 Agent 配置"
                  min={0.1}
                  max={50}
                  step={0.1}
                />
                {errors.maxBudgetUsd && <span className="form-error">{errors.maxBudgetUsd}</span>}
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          {submitError && (
            <span className="modal-error">{submitError}</span>
          )}
          <div className="modal-actions">
            <button
              className="btn btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={submitting || hasErrors}
            >
              {submitting ? (
                <span className="btn-loading">
                  <span className="spinner spinner-sm spinner-white" />
                  {isEdit ? "保存中" : "创建中"}
                </span>
              ) : (
                isEdit ? "保存" : "创建"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
