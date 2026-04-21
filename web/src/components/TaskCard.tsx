import { useState, useCallback } from "react";
import type { Task, TaskStatus } from "../types";
import { useAppState } from "../store/AppContext";
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
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskCard({ task, onSelect }: TaskCardProps) {
  const { agents } = useAppState();
  const [loading, setLoading] = useState<string | null>(null);

  const agent = agents.get(task.agentId);
  const statusColor = STATUS_COLORS[task.status];
  const statusBg = STATUS_BG[task.status];

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

      <div className="task-card-actions" onClick={(e) => e.stopPropagation()}>
        {task.status === "Todo" && (
          <>
            <ActionButton
              label="▶ 启动"
              loading={loading === "start"}
              onClick={() =>
                handleAction("start", async () => {
                  const res = await api.startTask(task.id);
                  // State will be updated via WebSocket broadcast
                  console.log("Task started:", res.task.status);
                })
              }
            />
            <ActionButton
              label="🗑"
              loading={loading === "delete"}
              onClick={() =>
                handleAction("delete", () => api.deleteTask(task.id))
              }
            />
          </>
        )}

        {task.status === "Running" && (
          <>
            <ActionButton
              label="⏹ 停止"
              loading={loading === "stop"}
              onClick={() =>
                handleAction("stop", async () => {
                  await api.stopTask(task.id);
                })
              }
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
            onClick={() =>
              handleAction("stop", async () => {
                await api.stopTask(task.id);
              })
            }
          />
        )}

        {(task.status === "Done" || task.status === "Cancelled") && (
          <>
            <ActionButton
              label="🔄 重试"
              loading={loading === "retry"}
              onClick={() =>
                handleAction("retry", async () => {
                  await api.retryTask(task.id);
                })
              }
            />
            <ActionButton
              label="🗑"
              loading={loading === "delete"}
              onClick={() =>
                handleAction("delete", () => api.deleteTask(task.id))
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActionButton
// ---------------------------------------------------------------------------

function ActionButton({
  label,
  loading,
  onClick,
}: {
  label: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="task-action-btn"
      onClick={onClick}
      disabled={loading}
    >
      {loading ? "..." : label}
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
