import { useEffect, useState, useCallback } from "react";
import { useAppState, useAppDispatch } from "../store/AppContext";
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
  const dispatch = useAppDispatch();

  // Task detail state
  const [events, setEvents] = useState<Event[]>([]);
  const [agentStats, setAgentStats] = useState<AgentStats | null>(null);

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
      return;
    }

    let cancelled = false;
    api
      .getTaskEvents(selectedTaskId, { limit: 50 })
      .then((res) => {
        if (cancelled) return;
        setEvents(res.events ?? res.items ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setEvents([]);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTaskId]);

  // Load agent stats
  useEffect(() => {
    if (!selectedAgentId) {
      setAgentStats(null);
      return;
    }

    let cancelled = false;
    api
      .getAgentStats(selectedAgentId)
      .then((res) => {
        if (cancelled) return;
        setAgentStats(res.stats);
      })
      .catch(() => {
        if (cancelled) return;
        setAgentStats(null);
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
    return <AgentDetail agent={selectedAgent} stats={agentStats} />;
  }

  // Task detail view
  if (selectedTask) {
    return (
      <TaskDetail
        task={selectedTask}
        agent={selectedAgent}
        events={events}
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
}: {
  task: import("../types").Task;
  agent?: Agent;
  events: Event[];
}) {
  return (
    <div className="detail-content">
      <h2 className="detail-title">{task.title}</h2>

      {task.status === "Stuck" && (
        <ToolApproval
          taskId={task.id}
          toolName="Unknown"
          stuckReason={task.stuckReason}
        />
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

function AgentDetail({ agent, stats }: { agent: Agent; stats: AgentStats | null }) {
  const [showPrompt, setShowPrompt] = useState(false);

  return (
    <div className="detail-content">
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
