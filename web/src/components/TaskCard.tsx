import { useState, useCallback, useMemo } from "react";
import type { Task, TaskStatus } from "../types";
import { useAppState, useAppDispatch } from "../store/AppContext";
import { ConfirmDialog } from "./ConfirmDialog";
import * as api from "../api/client";

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<TaskStatus, string> = {
  Todo: "#9CA3AF",
  Running: "#3B82F6",
  Done: "#34C759",
  Stuck: "#F59E0B",
  Cancelled: "#FF3B30",
};

const STATUS_BG: Record<TaskStatus, string> = {
  Todo: "#f3f4f6",
  Running: "#eff6ff",
  Done: "#f0fdf4",
  Stuck: "#fffbeb",
  Cancelled: "#fef2f2",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TaskCardProps {
  task: Task;
  onSelect: (taskId: string) => void;
  onEdit: (task: Task) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskCard({ task, onSelect, onEdit }: TaskCardProps) {
  const { agents } = useAppState();
  const dispatch = useAppDispatch();
  const [loading, setLoading] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"delete" | "stop" | null>(null);

  const agent = agents.get(task.agentId);
  const statusColor = STATUS_COLORS[task.status];
  const statusBg = STATUS_BG[task.status];

  // Agent busy detection for start button
  const agentBusyInfo = useMemo(() => {
    if (!agent || task.status !== "Todo") return null;
    if (agent.status === "working" || agent.status === "stuck") {
      return `Agent 当前${agent.status === "working" ? "忙碌" : "阻塞"}中`;
    }
    return null;
  }, [agent?.status, task.status]);

  const startDisabled = !!agentBusyInfo;

  const handleAction = useCallback(
    async (action: string, fn: () => Promise<unknown>) => {
      setLoading(action);
      try {
        await fn();
      } catch (err) {
        console.error(`Task action ${action} failed:`, err);
      } finally {
        setLoading(null);
      }
    },
    [],
  );

  return (
    <div
      className="task-card"
      style={{
        borderLeftColor: statusColor,
        backgroundColor: statusBg,
      }}
      onClick={() => onSelect(task.id)}
    >
      <div className="task-card-header">
        <span
          className="task-status-badge"
          style={{ backgroundColor: statusColor }}
        >
          {task.status}
        </span>
        <span className="task-card-time">
          {formatRelativeTime(task.createdAt)}
        </span>
      </div>

      <div className="task-card-title">{task.title}</div>

      <div className="task-card-agent">
        {agent ? (
          <>
            <span className="task-agent-avatar">{agent.avatar}</span>
            <span className="task-agent-name">{agent.name}</span>
          </>
        ) : (
          <span className="task-agent-name">Unknown Agent</span>
        )}
      </div>

      {task.status === "Stuck" && task.stuckReason && (
        <div className="task-card-warning">
          {truncateReason(task.stuckReason, 80)}
        </div>
      )}

      <div className="task-card-actions" onClick={(e) => e.stopPropagation()}>
        <ActionButton
          label="✎ 编辑"
          loading={loading === "edit"}
          onClick={() => onEdit(task)}
        />
        {task.status === "Todo" && (
          <>
            <ActionButton
              label="▶ 启动"
              loading={loading === "start"}
              disabled={startDisabled}
              title={agentBusyInfo ?? undefined}
              onClick={() =>
                handleAction("start", async () => {
                  const res = await api.startTask(task.id);
                  console.log("Task started:", res.task.status);
                })
              }
            />
            <ActionButton
              label="🗑"
              loading={loading === "delete"}
              onClick={() => setConfirmAction("delete")}
            />
          </>
        )}

        {task.status === "Running" && (
          <>
            <ActionButton
              label="⏹ 停止"
              loading={loading === "stop"}
              onClick={() => setConfirmAction("stop")}
            />
            <ActionButton
              label="✅ 完成"
              loading={loading === "done"}
              onClick={() =>
                handleAction("done", async () => {
                  await api.doneTask(task.id);
                })
              }
            />
          </>
        )}

        {task.status === "Stuck" && (
          <ActionButton
            label="⏹ 停止"
            loading={loading === "stop"}
            onClick={() => setConfirmAction("stop")}
          />
        )}

        {(task.status === "Done" || task.status === "Cancelled") && (
          <>
            <ActionButton
              label="🔄 重试"
              loading={loading === "retry"}
              onClick={() =>
                handleAction("retry", async () => {
                  const res = await api.retryTask(task.id);
                  dispatch({ type: "UPDATE_TASK", task: res.task });
                  dispatch({ type: "SET_SELECTED_TASK", taskId: res.task.id });
                })
              }
            />
            <ActionButton
              label="🗑"
              loading={loading === "delete"}
              onClick={() => setConfirmAction("delete")}
            />
          </>
        )}
      </div>

      {confirmAction === "delete" && (
        <ConfirmDialog
          title="确认删除"
          message={`确定要删除任务「${task.title}」吗？此操作不可撤销。`}
          confirmText="删除"
          dangerous
          onConfirm={() => handleAction("delete", () => api.deleteTask(task.id)).then(() => setConfirmAction(null))}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {confirmAction === "stop" && (
        <ConfirmDialog
          title="确认停止"
          message={`确定要停止正在运行的任务「${task.title}」吗？Agent 将回到空闲状态。`}
          confirmText="停止"
          dangerous
          onConfirm={async () => { await handleAction("stop", async () => { await api.stopTask(task.id); }); setConfirmAction(null); }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActionButton
// ---------------------------------------------------------------------------

function ActionButton({
  label,
  loading,
  disabled,
  title,
  onClick,
}: {
  label: string;
  loading: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      className="task-action-btn"
      onClick={onClick}
      disabled={loading || disabled}
      title={title}
    >
      {loading ? (
        <span className="btn-loading">
          <span className="spinner spinner-sm" />
          {label}
        </span>
      ) : (
        label
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}

function truncateReason(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...";
}
