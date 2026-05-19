import { useState, useCallback } from "react";
import {
  Plus,
  Workflow,
  Play,
  Square,
  Check,
  RotateCw,
  Pencil,
  Trash2,
  ClipboardList,
  Loader,
  AlertTriangle,
  CheckCircle2,
  GripVertical,
  Clock,
  RotateCcw,
} from "lucide-react";
import type { Task, Agent } from "../types";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "../types";
import { TaskApi } from "../api";
import { showToast } from "./NotificationContainer";

interface Props {
  tasks: Task[];
  agents: Agent[];
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
  onCreateTask: (agentId?: string) => void;
  onEditTask: (task: Task) => void;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  onRefreshAgents: () => void;
  onOpenAutodata?: () => void;
}

const COLUMNS = [
  {
    key: "todo",
    label: "待办",
    icon: ClipboardList,
    color: "var(--accent-warn)",
    statuses: ["Todo"],
  },
  {
    key: "running",
    label: "执行中",
    icon: Loader,
    color: "var(--accent-blue)",
    statuses: ["Running"],
  },
  {
    key: "stuck",
    label: "卡住",
    icon: AlertTriangle,
    color: "var(--gold)",
    statuses: ["Stuck"],
  },
  {
    key: "done",
    label: "完成",
    icon: CheckCircle2,
    color: "var(--accent-green)",
    statuses: ["Done", "Cancelled"],
  },
];

function TaskCard({
  task,
  agent,
  isSelected,
  onSelect,
  onEdit,
  setTasks,
  onRefreshAgents,
}: {
  task: Task;
  agent?: Agent;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  onRefreshAgents: () => void;
}) {
  const budgetPct = task.maxBudgetUsd
    ? (task.budgetUsed / task.maxBudgetUsd) * 100
    : 0;
  const budgetColor =
    budgetPct > 90
      ? "var(--accent-red)"
      : budgetPct > 70
        ? "var(--gold)"
        : "var(--accent-green)";

  const handleAction = async (
    action: "start" | "stop" | "done" | "retry" | "delete"
  ) => {
    try {
      if (action === "delete") {
        await TaskApi.remove(task.id);
        setTasks(prev => prev.filter(t => t.id !== task.id));
        onRefreshAgents();
        return;
      }
      const apiFn =
        action === "start"
          ? TaskApi.start
          : action === "stop"
            ? TaskApi.stop
            : action === "done"
              ? TaskApi.complete
              : TaskApi.retry;
      const res = await apiFn(task.id);
      if (res) {
        setTasks(prev => prev.map(t => (t.id === task.id ? res : t)));
      }
    } catch (err) {
      showToast("error", `操作失败: ${err}`);
      // Refresh from API on error
      try {
        const all = await TaskApi.list();
        if (all) setTasks(all);
      } catch {}
    }
  };

  const actionButtons = () => {
    if (task.status === "Todo")
      return (
        <button
          onClick={e => {
            e.stopPropagation();
            handleAction("start");
          }}
          className="p-1 rounded-md hover:bg-white/[0.03] transition-colors"
          title="开始"
        >
          <Play size={10} style={{ color: "var(--accent-green)" }} />
        </button>
      );
    if (task.status === "Running")
      return (
        <>
          <button
            onClick={e => {
              e.stopPropagation();
              handleAction("stop");
            }}
            className="p-1 rounded-md hover:bg-white/[0.03] transition-colors"
            title="停止"
          >
            <Square size={10} style={{ color: "var(--gold)" }} />
          </button>
          <button
            onClick={e => {
              e.stopPropagation();
              handleAction("done");
            }}
            className="p-1 rounded-md hover:bg-white/[0.03] transition-colors"
            title="完成"
          >
            <Check size={10} style={{ color: "var(--accent-green)" }} />
          </button>
        </>
      );
    if (task.status === "Stuck")
      return (
        <>
          <button
            onClick={e => {
              e.stopPropagation();
              handleAction("stop");
            }}
            className="p-1 rounded-md hover:bg-white/[0.03] transition-colors"
            title="停止"
          >
            <Square size={10} style={{ color: "var(--gold)" }} />
          </button>
          <button
            onClick={e => {
              e.stopPropagation();
              handleAction("retry");
            }}
            className="p-1 rounded-md hover:bg-white/[0.03] transition-colors"
            title="重试"
          >
            <RotateCw size={10} style={{ color: "var(--accent-blue)" }} />
          </button>
        </>
      );
    return null;
  };

  return (
    <div
      onClick={onSelect}
      className="rounded-xl p-3 cursor-pointer group relative animate-slide-up transition-all duration-300"
      style={{
        background: isSelected
          ? "linear-gradient(175deg, rgba(200,149,108,0.06) 0%, rgba(200,149,108,0.02) 100%)"
          : "linear-gradient(175deg, rgba(200,149,108,0.018) 0%, rgba(200,149,108,0.006) 100%)",
        borderTop: `2px solid ${PRIORITY_COLORS[task.priority]}`,
        borderLeft: "1px solid rgba(200,149,108,0.04)",
        borderRight: "1px solid rgba(200,149,108,0.04)",
        borderBottom: "1px solid rgba(200,149,108,0.04)",
        boxShadow: isSelected ? "0 4px 20px rgba(200,149,108,0.08)" : "none",
      }}
    >
      {/* Hover halo overlay */}
      <div
        className="absolute inset-0 rounded-xl pointer-events-none transition-opacity duration-300 opacity-0 group-hover:opacity-100"
        style={{
          border: "1px solid rgba(255,162,122,0.1)",
          boxShadow: "0 0 16px rgba(255,162,122,0.04)",
        }}
      />

      <div className="relative">
        {/* Priority + Status badges */}
        <div className="flex items-center gap-2 mb-2.5">
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
            style={{
              background: `${PRIORITY_COLORS[task.priority]}18`,
              color: PRIORITY_COLORS[task.priority],
            }}
          >
            {PRIORITY_LABELS[task.priority]}
          </span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              background:
                task.status === "Cancelled"
                  ? "rgba(239,68,68,0.08)"
                  : "rgba(200,149,108,0.05)",
              color:
                task.status === "Cancelled"
                  ? "var(--accent-red)"
                  : "var(--text-muted)",
            }}
          >
            {task.status === "Cancelled"
              ? "已取消"
              : task.status === "Todo"
                ? "待办"
                : task.status === "Running"
                  ? "执行中"
                  : task.status === "Stuck"
                    ? "卡住"
                    : "完成"}
          </span>
        </div>

        {/* Title */}
        <h4
          className="text-xs font-medium mb-2.5 leading-relaxed"
          style={{ color: "var(--text-primary)" }}
        >
          {task.title}
        </h4>

        {/* Agent */}
        <div className="flex items-center gap-2 mb-2.5">
          {agent && (
            <div className="flex items-center gap-1.5">
              <div
                className="w-4 h-4 rounded-full flex items-center justify-center text-[9px]"
                style={{
                  background: "rgba(255,162,122,0.1)",
                  color: "#ffa27a",
                  border: "1px solid rgba(255,162,122,0.15)",
                }}
              >
                {agent.name.charAt(0)}
              </div>
              <span
                className="text-[10px]"
                style={{ color: "var(--text-muted)" }}
              >
                {agent.name}
              </span>
            </div>
          )}
          {!agent && (
            <span
              className="text-[10px] italic"
              style={{ color: "var(--text-tertiary)" }}
            >
              未分配
            </span>
          )}
        </div>

        {/* Budget bar */}
        {task.maxBudgetUsd && (
          <div className="mb-2.5">
            <div
              className="h-[3px] rounded-full overflow-hidden"
              style={{ background: "rgba(200,149,108,0.05)" }}
            >
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{
                  width: `${Math.min(budgetPct, 100)}%`,
                  background: budgetColor,
                  boxShadow:
                    budgetPct > 90 ? "0 0 6px var(--accent-red)" : "none",
                }}
              />
            </div>
            <div className="text-[9px] mt-1 flex items-center justify-between">
              <span style={{ color: "var(--text-tertiary)" }}>
                ${task.budgetUsed.toFixed(2)} / ${task.maxBudgetUsd.toFixed(2)}
              </span>
              {budgetPct > 90 && (
                <span
                  className="text-[9px]"
                  style={{ color: "var(--accent-red)" }}
                >
                  预算告警
                </span>
              )}
            </div>
          </div>
        )}

        {/* Tags */}
        {task.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {task.tags.map(tag => (
              <span
                key={tag}
                className="text-[9px] px-1.5 py-0.5 rounded"
                style={{
                  background: "rgba(255,162,122,0.06)",
                  color: "rgba(255,162,122,0.7)",
                  border: "1px solid rgba(255,162,122,0.08)",
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pt-1">
          {actionButtons()}
          <button
            onClick={e => {
              e.stopPropagation();
              onEdit();
            }}
            className="p-1 rounded-md hover:bg-white/[0.03] transition-colors ml-auto"
            title="编辑"
          >
            <Pencil size={10} style={{ color: "var(--text-muted)" }} />
          </button>
          <button
            onClick={e => {
              e.stopPropagation();
              handleAction("delete");
            }}
            className="p-1 rounded-md hover:bg-white/[0.03] transition-colors"
            title="删除"
          >
            <Trash2 size={10} style={{ color: "var(--text-muted)" }} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function KanbanBoard({
  tasks,
  agents,
  selectedTaskId,
  onSelectTask,
  onCreateTask,
  onEditTask,
  setTasks,
  onRefreshAgents,
  onOpenAutodata,
}: Props) {
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent, colKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOverCol(colKey);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, _colKey: string) => {
      e.preventDefault();
      const agentId = e.dataTransfer.getData("agentId");
      if (agentId) onCreateTask(agentId);
      setDragOverCol(null);
    },
    [onCreateTask]
  );

  const getColTasks = (statuses: string[]) => {
    return tasks
      .filter(t => statuses.includes(t.status))
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return b.createdAt - a.createdAt;
      });
  };

  return (
    <div
      className="flex-1 flex flex-col min-w-0"
      style={{ background: "var(--bg-void)" }}
    >
      {/* Header */}
      <div
        className="h-[48px] flex items-center px-5 gap-3 border-b shrink-0"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <GripVertical size={14} style={{ color: "var(--text-tertiary)" }} />
        <span
          className="text-xs font-medium tracking-wider"
          style={{ color: "var(--text-secondary)" }}
        >
          任务看板
        </span>
        <button
          onClick={() => onCreateTask()}
          className="flex items-center gap-1.5 text-xs py-1 px-2.5 rounded-lg transition-all"
          style={{
            border: "1px solid var(--border-medium)",
            color: "var(--text-secondary)",
          }}
        >
          <Plus size={12} style={{ color: "#ffa27a" }} />
          <span>任务</span>
        </button>
        <button
          onClick={() => showToast("info", "流水线功能即将上线，敬请期待")}
          className="flex items-center gap-1.5 text-xs py-1 px-2.5 rounded-lg transition-all ml-1"
          style={{
            border: "1px solid var(--border-medium)",
            color: "var(--text-secondary)",
          }}
        >
          <Workflow size={12} style={{ color: "#ffa27a" }} />
          <span>流水线</span>
        </button>
        {onOpenAutodata && (
          <button
            onClick={onOpenAutodata}
            className="flex items-center gap-1.5 text-xs py-1 px-2.5 rounded-lg transition-all ml-1"
            style={{
              border: "1px solid var(--border-medium)",
              color: "var(--text-secondary)",
            }}
          >
            <RotateCcw size={12} style={{ color: "#ffa27a" }} />
            <span>Autodata</span>
          </button>
        )}

        <div className="flex-1" />

        {/* Stats pills */}
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-1.5 text-[10px]"
            style={{ color: "var(--text-muted)" }}
          >
            <Clock size={10} />
            <span>
              {tasks.filter(t => t.status === "Running").length} 执行中
            </span>
          </div>
          <div
            className="flex items-center gap-1.5 text-[10px]"
            style={{ color: "var(--text-muted)" }}
          >
            <CheckCircle2 size={10} />
            <span>{tasks.filter(t => t.status === "Done").length} 完成</span>
          </div>
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 flex gap-3 p-4 overflow-x-auto">
        {COLUMNS.map(col => {
          const colTasks = getColTasks(col.statuses);
          const isDragOver = dragOverCol === col.key;
          const Icon = col.icon;

          return (
            <div
              key={col.key}
              className="flex-1 min-w-[220px] flex flex-col rounded-xl transition-all duration-300"
              style={{
                background: isDragOver
                  ? "rgba(200,149,108,0.03)"
                  : "transparent",
                border: `1px solid ${isDragOver ? "rgba(200,149,108,0.12)" : "var(--border-subtle)"}`,
                boxShadow: isDragOver
                  ? "inset 0 0 16px rgba(200,149,108,0.04)"
                  : "none",
              }}
              onDragOver={e => handleDragOver(e, col.key)}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={e => handleDrop(e, col.key)}
            >
              {/* Column Header */}
              <div
                className="h-9 flex items-center px-3 gap-2 shrink-0 border-b"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                <Icon size={13} style={{ color: col.color }} />
                <span
                  className="text-xs font-medium"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {col.label}
                </span>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full ml-auto font-mono"
                  style={{
                    background: "rgba(200,149,108,0.05)",
                    color: "var(--text-muted)",
                  }}
                >
                  {colTasks.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
                {colTasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    agent={agents.find(a => a.id === task.agentId)}
                    isSelected={selectedTaskId === task.id}
                    onSelect={() => onSelectTask(task.id)}
                    onEdit={() => onEditTask(task)}
                    setTasks={setTasks}
                    onRefreshAgents={onRefreshAgents}
                  />
                ))}
                {colTasks.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <Icon
                      size={20}
                      style={{ color: "var(--text-tertiary)", opacity: 0.3 }}
                    />
                    <p
                      className="text-[10px] mt-2"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      暂无任务
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
