import { useEffect, useState, useCallback } from "react";
import { useAppState } from "../store/AppContext";
import { ActivityTimeline } from "./ActivityTimeline";
import { BudgetBar } from "./BudgetBar";
import { ToolApproval } from "./ToolApproval";
import * as api from "../api/client";
import type { Event, Agent, AgentStats } from "../types";

// ---------------------------------------------------------------------------
// DetailPanel
// ---------------------------------------------------------------------------

export function DetailPanel() {
  const { selectedTaskId, selectedAgentId, tasks, agents } = useAppState();

  // Task detail state
  const [events, setEvents] = useState<Event[]>([]);
  const [agentStats, setAgentStats] = useState<AgentStats | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);

  const selectedTask = selectedTaskId ? tasks.get(selectedTaskId) : undefined;
  const selectedAgent = selectedAgentId
    ? agents.get(selectedAgentId)
    : selectedTask
      ? agents.get(selectedTask.agentId)
      : undefined;

  // Load task events
  useEffect(() => {
    if (!selectedTaskId) {
      setEvents([]);
      setEventsLoading(false);
      return;
    }

    let cancelled = false;
    setEventsLoading(true);
    api
      .getTaskEvents(selectedTaskId, { limit: 50 })
      .then((res) => {
        if (cancelled) return;
        setEvents(res.events ?? res.items ?? []);
        setEventsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setEvents([]);
        setEventsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTaskId]);

  // Load agent stats
  useEffect(() => {
    if (!selectedAgentId) {
      setAgentStats(null);
      setStatsLoading(false);
      return;
    }

    let cancelled = false;
    setStatsLoading(true);
    api
      .getAgentStats(selectedAgentId)
      .then((res) => {
        if (cancelled) return;
        setAgentStats(res.stats);
        setStatsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setAgentStats(null);
        setStatsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAgentId]);

  // Listen for new events via WebSocket (append to events list)
  const handleEventNew = useCallback(
    (data: unknown) => {
      const evt = data as Event;
      if (evt?.taskId === selectedTaskId) {
        setEvents((prev) => [...prev, evt]);
      }
    },
    [selectedTaskId],
  );

  // Register event listener via dispatch (simplified approach)
  useEffect(() => {
    // This is handled by the global WebSocket handler in AppContext
  }, [handleEventNew]);

  // Empty state
  if (!selectedTask && !selectedAgent) {
    return (
      <div className="detail-empty">
        <span className="detail-empty-icon">{"\u{1F446}"}</span>
        <p>点击任务卡片或 Agent 卡片查看详情</p>
      </div>
    );
  }

  // Agent detail view
  if (selectedAgent && !selectedTask) {
    return <AgentDetail agent={selectedAgent} stats={agentStats} statsLoading={statsLoading} />;
  }

  // Task detail view
  if (selectedTask) {
    return (
      <TaskDetail
        task={selectedTask}
        agent={selectedAgent}
        events={events}
        eventsLoading={eventsLoading}
      />
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// TaskDetail
// ---------------------------------------------------------------------------

function TaskDetail({
  task,
  agent,
  events,
  eventsLoading,
}: {
  task: import("../types").Task;
  agent?: Agent;
  events: Event[];
  eventsLoading: boolean;
}) {
  return (
    <div className="detail-content">
      <div className="detail-title-row">
        <h2 className="detail-title">{task.title}</h2>
        {eventsLoading && <span className="spinner spinner-sm" />}
      </div>

      {task.status === "Stuck" && (
        <ToolApproval
          taskId={task.id}
          toolName="Unknown"
          stuckReason={task.stuckReason}
        />
      )}

      {task.status === "Stuck" && task.stuckReason && (
        <div className="detail-stuck-reason">
          <div className="detail-stuck-reason-label">Stuck 原因</div>
          <div className="detail-stuck-reason-text">{task.stuckReason}</div>
        </div>
      )}

      {task.status === "Done" && task.completedReason && task.completedReason !== "sdk_result" && task.completedReason !== "user_done" && (
        <div className="detail-completion-reason">
          <div className="detail-completion-reason-text">
            {COMPLETION_REASON_LABELS[task.completedReason] ?? task.completedReason}
          </div>
        </div>
      )}

      <div className="detail-section">
        <div className="detail-meta">
          <span className={`detail-status detail-status-${task.status.toLowerCase()}`}>
            {task.status}
          </span>
          {agent && (
            <span className="detail-agent">
              {agent.avatar} {agent.name}
            </span>
          )}
        </div>

        <div className="detail-times">
          <span>创建: {formatTime(task.createdAt)}</span>
          {task.startedAt && <span>启动: {formatTime(task.startedAt)}</span>}
          {task.completedAt && (
            <span>完成: {formatTime(task.completedAt)}</span>
          )}
        </div>
      </div>

      {task.description && (
        <div className="detail-section">
          <div className="detail-desc">{task.description}</div>
        </div>
      )}

      {task.output && (
        <div className="detail-section">
          <h3 className="detail-section-title">输出</h3>
          <pre className="detail-output">{task.output}</pre>
        </div>
      )}

      <div className="detail-section">
        <h3 className="detail-section-title">资源消耗</h3>
        <BudgetBar
          budgetUsed={task.budgetUsed}
          maxBudgetUsd={task.maxBudgetUsd}
          turnCount={task.turnCount}
          maxTurns={task.maxTurns}
        />
      </div>

      <div className="detail-section">
        <h3 className="detail-section-title">活动时间线</h3>
        <ActivityTimeline events={events} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentDetail
// ---------------------------------------------------------------------------

function AgentDetail({ agent, stats, statsLoading }: { agent: Agent; stats: AgentStats | null; statsLoading: boolean }) {
  const [showPrompt, setShowPrompt] = useState(false);

  return (
    <div className="detail-content">
      <div className="detail-spinner">
        {statsLoading && <span className="spinner spinner-sm" />}
      </div>
      <div className="detail-agent-header">
        <span className="detail-agent-avatar">{agent.avatar}</span>
        <div>
          <h2 className="detail-title">{agent.name}</h2>
          <p className="detail-agent-role">{agent.role}</p>
        </div>
      </div>

      <div className="detail-section">
        <div className="detail-meta">
          <span className={`detail-status detail-status-${agent.status}`}>
            {agent.status}
          </span>
          <span className="detail-enabled">
            {agent.isEnabled ? "已启用" : "已禁用"}
          </span>
        </div>
      </div>

      <div className="detail-section">
        <h3 className="detail-section-title">Prompt</h3>
        <div className="detail-prompt">
          {showPrompt ? agent.prompt : truncate(agent.prompt, 150)}
          {agent.prompt.length > 150 && (
            <button
              className="detail-expand-btn"
              onClick={() => setShowPrompt(!showPrompt)}
            >
              {showPrompt ? "收起" : "展开"}
            </button>
          )}
        </div>
      </div>

      <div className="detail-section">
        <h3 className="detail-section-title">配置</h3>
        <div className="detail-config">
          <span>最大轮次: {agent.maxTurns ?? 200}</span>
          <span>预算上限: ${(agent.maxBudgetUsd ?? 5).toFixed(2)}</span>
          <span>任务数: {agent.taskCount}</span>
        </div>
      </div>

      {stats && (
        <div className="detail-section">
          <h3 className="detail-section-title">统计</h3>
          <div className="detail-stats">
            <div className="detail-stat">
              <span className="detail-stat-value">
                {stats.totalTasksCompleted}
              </span>
              <span className="detail-stat-label">已完成</span>
            </div>
            <div className="detail-stat">
              <span className="detail-stat-value">
                {stats.totalTasksCancelled}
              </span>
              <span className="detail-stat-label">已取消</span>
            </div>
            <div className="detail-stat">
              <span className="detail-stat-value">
                ${stats.totalCostUsd.toFixed(2)}
              </span>
              <span className="detail-stat-label">总费用</span>
            </div>
            <div className="detail-stat">
              <span className="detail-stat-value">
                {stats.avgDurationMs > 0
                  ? `${(stats.avgDurationMs / 1000 / 60).toFixed(1)}min`
                  : "-"}
              </span>
              <span className="detail-stat-label">平均时长</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...";
}

// Completion reason display labels
const COMPLETION_REASON_LABELS: Record<string, string> = {
  max_budget: "已达到预算上限，任务自动停止",
  max_turns: "已达到轮次上限，任务自动停止",
  error: "执行过程中发生错误",
};
