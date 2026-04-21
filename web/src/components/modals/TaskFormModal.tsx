import { useState, useEffect, useCallback } from "react";
import type { Task, CreateTaskData, UpdateTaskData } from "../../types";
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
  onClose: () => void;
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

export function TaskFormModal({ task, onClose }: TaskFormModalProps) {
  const isEdit = !!task;
  const { agents, projects } = useAppState();
  const dispatch = useAppDispatch();

  const enabledAgents = [...agents.values()].filter((a) => a.isEnabled);

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
      title: "",
      description: "",
      agentId: "",
      projectId: "",
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
    setForm((prev) => ({ ...prev, [key]: value }));
    setSubmitError(null);
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
            描述
            <textarea
              className={`form-textarea ${errors.description ? "form-input-error" : ""}`}
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
              placeholder="任务描述，支持 Markdown 格式（至少 10 个字符）"
              rows={5}
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
