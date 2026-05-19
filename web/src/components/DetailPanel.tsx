import { useState } from "react";
import {
  PanelRightOpen,
  PanelRightClose,
  Pencil,
  Trash2,
  Play,
  Square,
  Check,
  RotateCw,
  MessageCircle,
  Bot,
  Cpu,
  Coins,
  Hash,
  CalendarDays,
} from "lucide-react";
import type { Task, Agent } from "../types";
import { PRIORITY_COLORS, AGENT_STATUS_COLORS } from "../types";
import { TaskApi } from "../api";
import { showToast } from "./NotificationContainer";
import BudgetBar from "./shared/BudgetBar";
import ActivityTimeline from "./shared/ActivityTimeline";
import ToolApproval from "./shared/ToolApproval";
import CopilotPanel from "./CopilotPanel";

interface Props {
  task: Task | null;
  agent: Agent | null;
  tasks: Task[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectTask: (id: string) => void;
  onSelectAgent: (id: string) => void;
  onEditTask: (task: Task) => void;
  onEditAgent: (agent: Agent) => void;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  onRefreshAgents: () => void;
}

export default function DetailPanel({
  task,
  agent,
  tasks,
  collapsed,
  onToggleCollapse,
  onSelectTask,
  onSelectAgent,
  onEditTask,
  onEditAgent,
  setTasks,
  onRefreshAgents,
}: Props) {
  const [showCopilot, setShowCopilot] = useState(false);

  if (collapsed) {
    return (
      <div
        className="w-[52px] shrink-0 flex flex-col items-center py-4 gap-3 border-l"
        style={{
          background: "var(--bg-secondary)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg hover:bg-white/[0.03] transition-colors"
        >
          <PanelRightOpen size={14} style={{ color: "var(--text-muted)" }} />
        </button>
        <button
          onClick={() => setShowCopilot(!showCopilot)}
          className={`p-1.5 rounded-lg transition-colors ${showCopilot ? "bg-white/10" : "hover:bg-white/[0.03]"}`}
        >
          <MessageCircle
            size={14}
            style={{ color: showCopilot ? "#ffa27a" : "var(--text-muted)" }}
          />
        </button>
      </div>
    );
  }

  return (
    <div
      className="w-[320px] shrink-0 flex flex-col border-l transition-all duration-300"
      style={{
        background: "var(--bg-secondary)",
        borderColor: "var(--border-subtle)",
      }}
    >
      {/* Header */}
      <div
        className="h-[48px] flex items-center px-4 gap-2 border-b shrink-0"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <span
          className="text-xs font-medium tracking-wider"
          style={{ color: "var(--text-secondary)" }}
        >
          {showCopilot ? "AI 助手" : "详情"}
        </span>
        <button
          onClick={() => setShowCopilot(!showCopilot)}
          className={`ml-auto p-1.5 rounded-lg transition-colors ${showCopilot ? "bg-white/10" : "hover:bg-white/[0.03]"}`}
          title="AI 助手"
        >
          <MessageCircle
            size={14}
            style={{ color: showCopilot ? "#ffa27a" : "var(--text-muted)" }}
          />
        </button>
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg hover:bg-white/[0.03] transition-colors"
        >
          <PanelRightClose size={14} style={{ color: "var(--text-muted)" }} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {showCopilot ? (
          <CopilotPanel />
        ) : !task && !agent ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <Bot
              size={32}
              style={{ color: "var(--text-muted)", opacity: 0.3 }}
            />
            <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>
              选择一个任务或智能体查看详情
            </p>
          </div>
        ) : task ? (
          <TaskDetail
            task={task}
            agent={agent}
            onSelectAgent={onSelectAgent}
            onEditTask={onEditTask}
            setTasks={setTasks}
          />
        ) : agent ? (
          <AgentDetail
            agent={agent}
            tasks={tasks}
            onSelectTask={onSelectTask}
            onEditAgent={onEditAgent}
          />
        ) : null}
      </div>
    </div>
  );
}

async function handleTaskAction(
  taskId: string,
  action: "start" | "stop" | "done" | "retry" | "delete",
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>,
  onRefreshAgents?: () => void
) {
  try {
    if (action === "delete") {
      await TaskApi.remove(taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
      onRefreshAgents?.();
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
    const res = await apiFn(taskId);
    if (res) {
      setTasks(prev => prev.map(t => (t.id === taskId ? res : t)));
    }
  } catch (err) {
    showToast("error", `操作失败: ${err}`);
  }
}

function TaskDetail({
  task,
  agent,
  onSelectAgent,
  onEditTask,
  setTasks,
}: {
  task: Task;
  agent: Agent | null;
  onSelectAgent: (id: string) => void;
  onEditTask: (t: Task) => void;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
}) {
  return (
    <div className="p-4 space-y-5 animate-fade-in">
      {/* Title section */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
            style={{
              background: `${PRIORITY_COLORS[task.priority]}15`,
              color: PRIORITY_COLORS[task.priority],
            }}
          >
            {["P0", "P1", "P2", "P3"][task.priority]}
          </span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              background:
                task.status === "Running"
                  ? "rgba(91,141,239,0.1)"
                  : task.status === "Stuck"
                    ? "rgba(255,162,122,0.1)"
                    : task.status === "Done"
                      ? "rgba(61,220,132,0.1)"
                      : "rgba(200,149,108,0.05)",
              color:
                task.status === "Running"
                  ? "var(--accent-blue)"
                  : task.status === "Stuck"
                    ? "#ffa27a"
                    : task.status === "Done"
                      ? "var(--accent-green)"
                      : "var(--text-muted)",
            }}
          >
            {task.status === "Todo"
              ? "待办"
              : task.status === "Running"
                ? "执行中"
                : task.status === "Stuck"
                  ? "卡住"
                  : task.status === "Done"
                    ? "完成"
                    : "已取消"}
          </span>
        </div>
        <h3
          className="text-sm font-medium leading-relaxed"
          style={{ color: "var(--text-primary)" }}
        >
          {task.title}
        </h3>
        <p
          className="text-xs mt-1.5 leading-relaxed"
          style={{ color: "var(--text-muted)" }}
        >
          {task.description}
        </p>
      </div>

      {/* Meta info grid */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-xs">
          <div
            className="flex items-center gap-1.5"
            style={{ color: "var(--text-muted)" }}
          >
            <Cpu size={11} />
            <span>智能体</span>
          </div>
          <button
            onClick={() => agent && onSelectAgent(agent.id)}
            className="flex items-center gap-1.5 transition-colors hover:opacity-80"
            style={{ color: "#ffa27a" }}
          >
            <div
              className="w-4 h-4 rounded flex items-center justify-center text-[9px]"
              style={{
                background: "rgba(255,162,122,0.1)",
                color: "#ffa27a",
              }}
            >
              {agent?.name.charAt(0) || "?"}
            </div>
            <span>{agent?.name || "未分配"}</span>
          </button>
        </div>
        <div className="flex items-center justify-between text-xs">
          <div
            className="flex items-center gap-1.5"
            style={{ color: "var(--text-muted)" }}
          >
            <Hash size={11} />
            <span>项目</span>
          </div>
          <span style={{ color: "var(--text-secondary)" }}>
            {task.projectId}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <div
            className="flex items-center gap-1.5"
            style={{ color: "var(--text-muted)" }}
          >
            <CalendarDays size={11} />
            <span>创建时间</span>
          </div>
          <span
            className="text-[11px] font-mono"
            style={{ color: "var(--text-secondary)" }}
          >
            {new Date(task.createdAt).toLocaleString("zh-CN")}
          </span>
        </div>
      </div>

      {/* Tags */}
      {task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {task.tags.map(tag => (
            <span
              key={tag}
              className="text-[10px] px-2 py-1 rounded-lg"
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

      {/* Budget */}
      {task.maxBudgetUsd && (
        <div
          className="rounded-xl p-3"
          style={{
            background:
              "linear-gradient(175deg, rgba(200,149,108,0.02) 0%, rgba(200,149,108,0.005) 100%)",
            border: "1px solid rgba(200,149,108,0.04)",
          }}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <Coins size={11} style={{ color: "var(--text-muted)" }} />
            <h4
              className="text-[10px] font-medium tracking-wider uppercase"
              style={{ color: "var(--text-muted)" }}
            >
              预算与轮次
            </h4>
          </div>
          <BudgetBar
            used={task.budgetUsed}
            limit={task.maxBudgetUsd}
            turns={task.turnCount}
            maxTurns={task.maxTurns || 0}
          />
        </div>
      )}

      {/* Tool Approval */}
      {task.status === "Stuck" && <ToolApproval taskId={task.id} />}

      {/* Timeline */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <CalendarDays size={11} style={{ color: "var(--text-muted)" }} />
          <h4
            className="text-[10px] font-medium tracking-wider uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            活动时间线
          </h4>
        </div>
        <ActivityTimeline taskId={task.id} />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pt-2">
        {task.status === "Todo" && (
          <button
            onClick={() =>
              handleTaskAction(task.id, "start", setTasks, onRefreshAgents)
            }
            className="btn-gold text-xs flex items-center gap-1.5 py-1.5 px-3"
          >
            <Play size={12} /> 开始
          </button>
        )}
        {task.status === "Running" && (
          <>
            <button
              onClick={() =>
                handleTaskAction(task.id, "stop", setTasks, onRefreshAgents)
              }
              className="btn-ghost text-xs flex items-center gap-1.5 py-1.5 px-3"
            >
              <Square size={12} /> 停止
            </button>
            <button
              onClick={() =>
                handleTaskAction(task.id, "done", setTasks, onRefreshAgents)
              }
              className="btn-gold text-xs flex items-center gap-1.5 py-1.5 px-3"
            >
              <Check size={12} /> 完成
            </button>
          </>
        )}
        {task.status === "Stuck" && (
          <button
            onClick={() =>
              handleTaskAction(task.id, "retry", setTasks, onRefreshAgents)
            }
            className="btn-gold text-xs flex items-center gap-1.5 py-1.5 px-3"
          >
            <RotateCw size={12} /> 重试
          </button>
        )}
        <button
          onClick={() => onEditTask(task)}
          className="btn-ghost text-xs flex items-center gap-1.5 py-1.5 px-3 ml-auto"
        >
          <Pencil size={12} /> 编辑
        </button>
        <button
          onClick={() =>
            handleTaskAction(task.id, "delete", setTasks, onRefreshAgents)
          }
          className="btn-ghost text-xs flex items-center gap-1.5 py-1.5 px-3"
          style={{
            color: "var(--accent-red)",
            borderColor: "rgba(239,68,68,0.2)",
          }}
        >
          <Trash2 size={12} /> 删除
        </button>
      </div>
    </div>
  );
}

function AgentDetail({
  agent,
  tasks,
  onSelectTask,
  onEditAgent,
}: {
  agent: Agent;
  tasks: Task[];
  onSelectTask: (id: string) => void;
  onEditAgent: (a: Agent) => void;
}) {
  const agentTasks = tasks
    .filter((t: Task) => t.agentId === agent.id)
    .slice(0, 5);
  const totalTasks = tasks.filter((t: Task) => t.agentId === agent.id);
  const doneCount = totalTasks.filter((t: Task) => t.status === "Done").length;

  return (
    <div className="p-4 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-semibold"
          style={{
            background: "rgba(255,162,122,0.08)",
            color: "#ffa27a",
            border: "1px solid rgba(255,162,122,0.12)",
            boxShadow: "0 0 12px rgba(255,162,122,0.06)",
          }}
        >
          {agent.name.charAt(0)}
        </div>
        <div>
          <h3
            className="text-sm font-medium"
            style={{ color: "var(--text-primary)" }}
          >
            {agent.name}
          </h3>
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className="w-2 h-2 rounded-full"
              style={{
                background: AGENT_STATUS_COLORS[agent.status],
                boxShadow:
                  agent.status === "working"
                    ? `0 0 6px ${AGENT_STATUS_COLORS[agent.status]}`
                    : "none",
              }}
            />
            <span
              className="text-[10px]"
              style={{ color: AGENT_STATUS_COLORS[agent.status] }}
            >
              {agent.status === "idle"
                ? "空闲"
                : agent.status === "working"
                  ? "工作中"
                  : agent.status === "stuck"
                    ? "卡住"
                    : "离线"}
            </span>
          </div>
        </div>
      </div>

      {/* Config */}
      <div
        className="rounded-xl p-3 space-y-2.5"
        style={{
          background:
            "linear-gradient(175deg, rgba(200,149,108,0.025) 0%, rgba(200,149,108,0.01) 100%)",
          border: "1px solid rgba(200,149,108,0.04)",
        }}
      >
        <h4
          className="text-[10px] font-medium tracking-wider uppercase mb-1"
          style={{ color: "var(--text-muted)" }}
        >
          配置
        </h4>
        <div className="flex justify-between text-xs">
          <span style={{ color: "var(--text-muted)" }}>模型</span>
          <span
            className="font-mono"
            style={{ color: "var(--text-secondary)" }}
          >
            {agent.model || "默认"}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span style={{ color: "var(--text-muted)" }}>API Key</span>
          <span
            style={{
              color: agent.hasApiKey
                ? "var(--accent-green)"
                : "var(--text-muted)",
            }}
          >
            {agent.hasApiKey ? "已配置" : "未配置"}
          </span>
        </div>
        {agent.apiBaseUrl && (
          <div className="flex justify-between text-xs">
            <span style={{ color: "var(--text-muted)" }}>Base URL</span>
            <span
              className="font-mono text-[10px] max-w-[140px] truncate"
              style={{ color: "var(--text-secondary)" }}
            >
              {agent.apiBaseUrl}
            </span>
          </div>
        )}
        <div className="flex justify-between text-xs">
          <span style={{ color: "var(--text-muted)" }}>最大轮次</span>
          <span
            className="font-mono"
            style={{ color: "var(--text-secondary)" }}
          >
            {agent.maxTurns}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span style={{ color: "var(--text-muted)" }}>预算上限</span>
          <span
            className="font-mono"
            style={{ color: "var(--text-secondary)" }}
          >
            ${agent.maxBudgetUsd}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span style={{ color: "var(--text-muted)" }}>允许工具</span>
          <span style={{ color: "var(--text-secondary)" }}>
            {agent.allowedTools.join(", ")}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div
        className="rounded-xl p-3 grid grid-cols-3 gap-3 text-center"
        style={{
          background:
            "linear-gradient(175deg, rgba(200,149,108,0.025) 0%, rgba(200,149,108,0.01) 100%)",
          border: "1px solid rgba(200,149,108,0.04)",
        }}
      >
        <div>
          <div
            className="text-lg font-medium font-mono"
            style={{ color: "#ffa27a" }}
          >
            {totalTasks.length}
          </div>
          <div
            className="text-[9px] mt-1"
            style={{ color: "var(--text-muted)" }}
          >
            总任务
          </div>
        </div>
        <div>
          <div
            className="text-lg font-medium font-mono"
            style={{ color: "var(--accent-green)" }}
          >
            {doneCount}
          </div>
          <div
            className="text-[9px] mt-1"
            style={{ color: "var(--text-muted)" }}
          >
            已完成
          </div>
        </div>
        <div>
          <div
            className="text-lg font-medium font-mono"
            style={{ color: "var(--accent-blue)" }}
          >
            {totalTasks.length > 0
              ? Math.round((doneCount / totalTasks.length) * 100)
              : 0}
            %
          </div>
          <div
            className="text-[9px] mt-1"
            style={{ color: "var(--text-muted)" }}
          >
            成功率
          </div>
        </div>
      </div>

      {/* Recent Tasks */}
      {agentTasks.length > 0 && (
        <div>
          <h4
            className="text-[10px] font-medium mb-2 tracking-wider uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            最近任务
          </h4>
          <div className="space-y-1.5">
            {agentTasks.map(t => (
              <button
                key={t.id}
                onClick={() => onSelectTask(t.id)}
                className="w-full text-left rounded-lg px-3 py-2 text-xs transition-all duration-300"
                style={{
                  background:
                    "linear-gradient(175deg, rgba(200,149,108,0.02) 0%, rgba(200,149,108,0.008) 100%)",
                  border: "1px solid rgba(200,149,108,0.03)",
                  color: "var(--text-secondary)",
                }}
              >
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => onEditAgent(agent)}
          className="btn-gold text-xs flex-1 flex items-center justify-center gap-1.5 py-2"
        >
          <Pencil size={12} /> 编辑智能体
        </button>
      </div>
    </div>
  );
}
