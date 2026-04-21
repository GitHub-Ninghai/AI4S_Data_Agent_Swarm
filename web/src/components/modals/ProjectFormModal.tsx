import { useState, useEffect, useCallback } from "react";
import type { Project } from "../../types";
import { useAppDispatch } from "../../store/AppContext";
import * as api from "../../api/client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

const DEFAULT_FORM: FormState = {
  name: "",
  path: "",
  description: "",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormState {
  name: string;
  path: string;
  description: string;
}

interface FormErrors {
  name?: string;
  path?: string;
}

interface ProjectFormModalProps {
  project?: Project;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  const name = form.name.trim();
  const p = form.path.trim();

  if (!name) {
    errors.name = "项目名称不能为空";
  } else if (!NAME_PATTERN.test(name)) {
    errors.name = "只允许英文字母、数字、下划线和连字符";
  }

  if (!p) {
    errors.path = "路径不能为空";
  } else if (!isAbsolutePath(p)) {
    errors.path = "请输入绝对路径（如 C:\\Users\\project 或 /home/user/project）";
  }

  return errors;
}

function isAbsolutePath(p: string): boolean {
  // Windows: C:\... or \\...
  // Unix: /...
  return /^[A-Za-z]:\\/.test(p) || /^\\\\/.test(p) || p.startsWith("/");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProjectFormModal({ project, onClose }: ProjectFormModalProps) {
  const dispatch = useAppDispatch();
  const isEdit = !!project;

  const [form, setForm] = useState<FormState>(() =>
    project
      ? { name: project.name, path: project.path, description: project.description ?? "" }
      : { ...DEFAULT_FORM },
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validateForm = useCallback(() => {
    const next = validate(form);
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [form]);

  useEffect(() => {
    if (isEdit || form.name || form.path) {
      validateForm();
    }
  }, [form, isEdit, validateForm]);

  const hasErrors = Object.values(errors).some(Boolean);

  function handleSubmit() {
    if (!validateForm()) return;

    setSubmitting(true);
    setSubmitError(null);

    const data = {
      name: form.name.trim(),
      path: form.path.trim(),
      description: form.description.trim() || undefined,
    };

    const promise = isEdit && project
      ? api.updateProject(project.id, data)
      : api.createProject(data);

    promise
      .then((_res) => {
        // Reload projects list
        api.getProjects().then((pr) => {
          dispatch({ type: "SET_PROJECTS", projects: pr.projects });
        });
        onClose();
      })
      .catch((err) => {
        const msg = err instanceof api.ApiError ? err.message : "操作失败";
        setSubmitError(msg);
      })
      .finally(() => setSubmitting(false));
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            {isEdit ? "编辑项目" : "新建项目"}
          </span>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="modal-body">
          <label className="form-label">
            项目名称
            <input
              className={`form-input ${errors.name ? "form-input-error" : ""}`}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="my-project"
              autoFocus
            />
            {errors.name && <span className="form-error">{errors.name}</span>}
            <span className="form-hint">只允许 [a-zA-Z0-9_-]</span>
          </label>

          <label className="form-label">
            工作目录（绝对路径）
            <input
              className={`form-input ${errors.path ? "form-input-error" : ""}`}
              value={form.path}
              onChange={(e) => setForm({ ...form, path: e.target.value })}
              placeholder="C:\Users\my-project 或 /home/user/project"
              disabled={isEdit}
            />
            {errors.path && <span className="form-error">{errors.path}</span>}
            {isEdit && (
              <span className="form-hint">项目路径创建后不可修改</span>
            )}
          </label>

          <label className="form-label">
            描述（可选）
            <textarea
              className="form-textarea"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="项目描述..."
              rows={3}
            />
          </label>
        </div>

        <div className="modal-footer">
          {submitError && <span className="modal-error">{submitError}</span>}
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
