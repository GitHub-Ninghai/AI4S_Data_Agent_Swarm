import { useState } from "react";
import { useAppState, useAppDispatch } from "../store/AppContext";
import { TaskCard } from "./TaskCard";
import * as api from "../api/client";
import type { Task, TaskStatus } from "../types";

// ---------------------------------------------------------------------------
// Column config
// ---------------------------------------------------------------------------

interface Column {
  status: TaskStatus;
  label: string;
  icon: string;
}

const COLUMNS: Column[] = [
  { status: "Todo", label: "Todo", icon: "\u{1F4CB}" },
  { status: "Running", label: "Running", icon: "\u{1F504}" },
  { status: "Stuck", label: "Stuck", icon: "\u{1F7E1}" },
  { status: "Done", label: "Done", icon: "\u2705" },
];

// ---------------------------------------------------------------------------
// KanbanBoard
// ---------------------------------------------------------------------------

export function KanbanBoard() {
  const { tasks, agents, activeProjectId, projects } = useAppState();
  const dispatch = useAppDispatch();
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    agentId: "",
    projectId: "",
    priority: 1 as 0 | 1 | 2,
  });

  // Filter tasks by active project
  const filteredTasks = activeProjectId
    ? [...tasks.values()].filter((t) => t.projectId === activeProjectId)
    : [...tasks.values()];

  // Group by status (Cancelled grouped with Done)
  const columnTasks = (status: TaskStatus): Task[] => {
    if (status === "Done") {
      return filteredTasks
        .filter((t) => t.status === "Done" || t.status === "Cancelled")
        .sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt);
    }
    return filteredTasks
      .filter((t) => t.status === status)
      .sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt);
  };

  const enabledAgents = [...agents.values()].filter((a) => a.isEnabled);
  const availableProjects = projects;

  async function handleCreate() {
    if (!form.title.trim() || !form.agentId || !form.projectId) return;
    setCreating(true);
    try {
      await api.createTask({
        title: form.title.trim(),
        description: form.description.trim(),
        agentId: form.agentId,
        projectId: form.projectId,
        priority: form.priority,
      });
      setShowCreate(false);
      setForm({
        title: "",
        description: "",
        agentId: "",
        projectId: "",
        priority: 1,
      });
    } catch (err) {
      console.error("Failed to create task:", err);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="kanban">
      <div className="kanban-header">
        <span className="kanban-title">Tasks</span>
        <button className="btn btn-small" onClick={() => setShowCreate(!showCreate)}>
          + Task
        </button>
      </div>

      {showCreate && (
        <div className="kanban-create-form">
          <label className="form-label">
            标题
            <input
              className="form-input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Task 标题"
            />
          </label>
          <label className="form-label">
            描述
            <textarea
              className="form-textarea"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="任务描述（至少 10 字）"
              rows={3}
            />
          </label>
          <div className="kanban-create-row">
            <label className="form-label">
              Agent
              <select
                className="form-input"
                value={form.agentId}
                onChange={(e) =>
                  setForm({ ...form, agentId: e.target.value })
                }
              >
                <option value="">选择 Agent</option>
                {enabledAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.avatar} {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Project
              <select
                className="form-input"
                value={form.projectId}
                onChange={(e) =>
                  setForm({ ...form, projectId: e.target.value })
                }
              >
                <option value="">选择 Project</option>
                {availableProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button
              className="btn btn-secondary"
              onClick={() => setShowCreate(false)}
            >
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={handleCreate}
              disabled={
                creating ||
                !form.title.trim() ||
                !form.agentId ||
                !form.projectId ||
                form.description.trim().length < 10
              }
            >
              {creating ? "创建中..." : "创建"}
            </button>
          </div>
        </div>
      )}

      <div className="kanban-columns">
        {COLUMNS.map((col) => {
          const items = columnTasks(col.status);
          return (
            <div key={col.status} className="kanban-column">
              <div className="kanban-column-header">
                <span>
                  {col.icon} {col.label}
                </span>
                <span className="kanban-column-count">{items.length}</span>
              </div>
              <div className="kanban-column-body">
                {items.length === 0 ? (
                  <div className="kanban-empty">
                    <span>{col.status === "Todo" ? "\u{1F4CB}" : "\u2705"}</span>
                    <p>
                      {col.status === "Todo"
                        ? "没有待处理的任务"
                        : "暂无任务"}
                    </p>
                  </div>
                ) : (
                  items.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onSelect={(id) =>
                        dispatch({
                          type: "SET_SELECTED_TASK",
                          taskId: id,
                        })
                      }
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
