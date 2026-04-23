import { useState, useEffect, useCallback } from "react";
import type { Agent, CreateAgentData, UpdateAgentData } from "../../types";
import { useAppState, useAppDispatch } from "../../store/AppContext";
import * as api from "../../api/client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRESET_EMOJIS = [
  "\u{1F916}", "\u{1F4BB}", "\u{1F52C}", "\u{1F4DA}", "\u{1F3AF}",
  "\u{1F6E0}\uFE0F", "\u{1F4CA}", "\u{1F50D}", "\u{1F4DD}", "\u{1F310}",
  "\u{1F9D1}\u200D\u{1F4BC}", "\u{1F468}\u200D\u{1F4BB}", "\u{1F916}", "\u{1F98B}", "\u{1F41C}",
  "\u{1F40B}", "\u{1F41A}", "\u{1F413}", "\u{1F422}", "\u{1F40E}",
];

const ALL_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Glob",
  "WebFetch",
];

const DEFAULT_TOOLS = ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "WebFetch"];

const DEFAULT_FORM: FormState = {
  name: "",
  avatar: PRESET_EMOJIS[0],
  role: "",
  prompt: "",
  projectId: "",
  maxTurns: 200,
  maxBudgetUsd: 5.0,
  allowedTools: [...DEFAULT_TOOLS],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormState {
  name: string;
  avatar: string;
  role: string;
  prompt: string;
  projectId: string;
  maxTurns: number;
  maxBudgetUsd: number;
  allowedTools: string[];
}

interface FormErrors {
  name?: string;
  avatar?: string;
  role?: string;
  prompt?: string;
  maxTurns?: string;
  maxBudgetUsd?: string;
}

interface AgentFormModalProps {
  agent?: Agent;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  const name = form.name.trim();
  const role = form.role.trim();
  const prompt = form.prompt.trim();

  if (!name) {
    errors.name = "名称不能为空";
  } else if (name.length > 50) {
    errors.name = "名称不能超过 50 个字符";
  }

  if (!form.avatar) {
    errors.avatar = "头像不能为空";
  }

  if (!role) {
    errors.role = "角色描述不能为空";
  } else if (role.length > 200) {
    errors.role = "角色描述不能超过 200 个字符";
  }

  if (!prompt) {
    errors.prompt = "提示词不能为空";
  } else if (prompt.length < 10) {
    errors.prompt = "提示词至少 10 个字符";
  } else if (prompt.length > 5000) {
    errors.prompt = "提示词不能超过 5000 个字符";
  }

  if (form.maxTurns < 1 || form.maxTurns > 500) {
    errors.maxTurns = "最大轮次范围: 1-500";
  }

  if (form.maxBudgetUsd < 0.1 || form.maxBudgetUsd > 50) {
    errors.maxBudgetUsd = "预算上限范围: 0.1-50.0";
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentFormModal({ agent, onClose }: AgentFormModalProps) {
  const isEdit = !!agent;
  const { projects } = useAppState();
  const dispatch = useAppDispatch();

  const [form, setForm] = useState<FormState>(() => {
    if (agent) {
      return {
        name: agent.name,
        avatar: agent.avatar,
        role: agent.role,
        prompt: agent.prompt,
        projectId: agent.projectId ?? "",
        maxTurns: agent.maxTurns ?? 200,
        maxBudgetUsd: agent.maxBudgetUsd ?? 5.0,
        allowedTools: agent.allowedTools ?? [...DEFAULT_TOOLS],
      };
    }
    return { ...DEFAULT_FORM, allowedTools: [...DEFAULT_TOOLS] };
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Real-time validation
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

  function toggleTool(tool: string) {
    setForm((prev) => ({
      ...prev,
      allowedTools: prev.allowedTools.includes(tool)
        ? prev.allowedTools.filter((t) => t !== tool)
        : [...prev.allowedTools, tool],
    }));
    setSubmitError(null);
  }

  async function handleSubmit() {
    const validationErrors = validate(form);
    setErrors(validationErrors);
    if (Object.values(validationErrors).some((e) => !!e)) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      if (isEdit && agent) {
        const data: UpdateAgentData = {
          name: form.name.trim(),
          avatar: form.avatar,
          role: form.role.trim(),
          prompt: form.prompt.trim(),
          maxTurns: form.maxTurns,
          maxBudgetUsd: form.maxBudgetUsd,
          allowedTools: form.allowedTools,
        };
        const res = await api.updateAgent(agent.id, data);
        dispatch({ type: "UPDATE_AGENT", agent: res.agent });
      } else {
        const data: CreateAgentData = {
          name: form.name.trim(),
          avatar: form.avatar,
          role: form.role.trim(),
          prompt: form.prompt.trim(),
          projectId: form.projectId || undefined,
          maxTurns: form.maxTurns,
          maxBudgetUsd: form.maxBudgetUsd,
          allowedTools: form.allowedTools,
        };
        const res = await api.createAgent(data);
        dispatch({ type: "UPDATE_AGENT", agent: res.agent });
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
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? "编辑 Agent" : "创建 Agent"}</h2>
          <button className="modal-close" onClick={onClose}>
            {"\u00D7"}
          </button>
        </div>

        <div className="modal-body">
          {/* Avatar + Name row */}
          <div className="modal-row">
            <div className="modal-field modal-field-avatar">
              <label className="form-label">
                头像
                <div className="avatar-picker">
                  <button
                    type="button"
                    className="avatar-preview"
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  >
                    {form.avatar}
                  </button>
                  {showEmojiPicker && (
                    <div className="emoji-grid">
                      {PRESET_EMOJIS.map((emoji, i) => (
                        <button
                          key={i}
                          type="button"
                          className={`emoji-option ${form.avatar === emoji ? "emoji-option-selected" : ""}`}
                          onClick={() => {
                            updateField("avatar", emoji);
                            setShowEmojiPicker(false);
                          }}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {errors.avatar && <span className="form-error">{errors.avatar}</span>}
              </label>
            </div>

            <div className="modal-field modal-field-name">
              <label className="form-label">
                名称
                <input
                  className={`form-input ${errors.name ? "form-input-error" : ""}`}
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder="Agent 名称"
                  maxLength={50}
                />
                <span className="form-count">{form.name.length}/50</span>
                {errors.name && <span className="form-error">{errors.name}</span>}
              </label>
            </div>
          </div>

          {/* Role */}
          <label className="form-label">
            角色描述
            <input
              className={`form-input ${errors.role ? "form-input-error" : ""}`}
              value={form.role}
              onChange={(e) => updateField("role", e.target.value)}
              placeholder="例如：数据合成专家，负责爬取和解析论文"
              maxLength={200}
            />
            <span className="form-count">{form.role.length}/200</span>
            {errors.role && <span className="form-error">{errors.role}</span>}
          </label>

          {/* Prompt */}
          <label className="form-label">
            系统提示词
            <textarea
              className={`form-textarea ${errors.prompt ? "form-input-error" : ""}`}
              value={form.prompt}
              onChange={(e) => updateField("prompt", e.target.value)}
              placeholder="描述 Agent 的行为规范、工作流程和专业领域（至少 10 个字符）"
              rows={5}
              maxLength={5000}
            />
            <span className="form-count">{form.prompt.length}/5000</span>
            {errors.prompt && <span className="form-error">{errors.prompt}</span>}
          </label>

          {/* Project */}
          <label className="form-label">
            默认 Project
            <select
              className="form-select"
              value={form.projectId}
              onChange={(e) => updateField("projectId", e.target.value)}
            >
              <option value="">不指定</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          {/* Config row */}
          <div className="modal-row">
            <div className="modal-field">
              <label className="form-label">
                最大轮次
                <input
                  type="number"
                  className={`form-input ${errors.maxTurns ? "form-input-error" : ""}`}
                  value={form.maxTurns}
                  onChange={(e) => updateField("maxTurns", Number(e.target.value))}
                  min={1}
                  max={500}
                />
                {errors.maxTurns && <span className="form-error">{errors.maxTurns}</span>}
              </label>
            </div>
            <div className="modal-field">
              <label className="form-label">
                预算上限 (USD)
                <input
                  type="number"
                  className={`form-input ${errors.maxBudgetUsd ? "form-input-error" : ""}`}
                  value={form.maxBudgetUsd}
                  onChange={(e) => updateField("maxBudgetUsd", Number(e.target.value))}
                  min={0.1}
                  max={50}
                  step={0.1}
                />
                {errors.maxBudgetUsd && <span className="form-error">{errors.maxBudgetUsd}</span>}
              </label>
            </div>
          </div>

          {/* Allowed tools */}
          <div className="form-label">
            允许工具
            <div className="tool-checkboxes">
              {ALL_TOOLS.map((tool) => (
                <label key={tool} className="tool-checkbox">
                  <input
                    type="checkbox"
                    checked={form.allowedTools.includes(tool)}
                    onChange={() => toggleTool(tool)}
                  />
                  <span>{tool}</span>
                </label>
              ))}
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
