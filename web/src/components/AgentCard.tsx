import type { Agent, AgentStatus } from "../types";

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: "#9CA3AF",
  working: "#3B82F6",
  stuck: "#F59E0B",
  offline: "#6B7280",
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: "Idle",
  working: "Working",
  stuck: "Stuck",
  offline: "Offline",
};

const STATUS_ICONS: Record<AgentStatus, string> = {
  idle: "\u{1F7E2}",
  working: "\u{1F535}",
  stuck: "\u{1F7E1}",
  offline: "\u26AB",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AgentCardProps {
  agent: Agent;
  isSelected: boolean;
  onSelect: (agentId: string) => void;
  onEdit: (agent: Agent) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentCard({ agent, isSelected, onSelect, onEdit }: AgentCardProps) {
  const color = STATUS_COLORS[agent.status];

  return (
    <div
      className={`agent-card ${isSelected ? "agent-card-selected" : ""}`}
      onClick={() => onSelect(agent.id)}
      style={{ "--agent-status-color": color } as React.CSSProperties}
    >
      <div
        className={`agent-status-bar agent-status-${agent.status}`}
        style={{ backgroundColor: color }}
      />

      <div className="agent-card-body">
        <div className="agent-card-top">
          <span className="agent-avatar">{agent.avatar}</span>
          <div className="agent-info">
            <span className="agent-name">{agent.name}</span>
            <span className={`agent-status-label agent-status-label-${agent.status}`}>
              {STATUS_ICONS[agent.status]} {STATUS_LABELS[agent.status]}
            </span>
          </div>
          <button
            className="agent-edit-btn"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(agent);
            }}
            title="编辑"
          >
            ✎
          </button>
        </div>

        <div className="agent-card-meta">
          <span className="agent-task-count">
            {agent.taskCount > 0
              ? `${agent.taskCount} 个任务`
              : "无待处理任务"}
          </span>
        </div>

        {agent.lastEventAt > 0 && (
          <div className="agent-last-event">
            {formatRelativeTime(agent.lastEventAt)}
          </div>
        )}
      </div>
    </div>
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
