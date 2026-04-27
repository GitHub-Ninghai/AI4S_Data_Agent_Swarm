// ---------------------------------------------------------------------------
// CopilotChat — 聊天消息列表
// ---------------------------------------------------------------------------

import type { CopilotMessageView } from "../hooks/useCopilot";
import type { CopilotAction } from "../types";

interface CopilotChatProps {
  messages: CopilotMessageView[];
  isLoading: boolean;
  onConfirm: (messageId: string, actionIndex: number, confirmed: boolean) => void;
}

export function CopilotChat({ messages, isLoading, onConfirm }: CopilotChatProps) {
  return (
    <div className="copilot-messages">
      {messages.length === 0 && (
        <div className="copilot-welcome">
          <div className="copilot-welcome-icon">🤖</div>
          <h3>Copilot 副驾驶</h3>
          <p>用自然语言描述你想做的事，我来帮你创建 Agent、Task 和流水线。</p>
          <div className="copilot-suggestions">
            <button
              className="copilot-suggestion-btn"
              onClick={() =>
                onSuggestionClick("当前有哪些 Agent？")
              }
            >
              当前有哪些 Agent？
            </button>
            <button
              className="copilot-suggestion-btn"
              onClick={() =>
                onSuggestionClick("帮我创建一个论文爬取 Agent")
              }
            >
              创建论文爬取 Agent
            </button>
            <button
              className="copilot-suggestion-btn"
              onClick={() =>
                onSuggestionClick("创建 smart grid 完整流水线")
              }
            >
              创建完整流水线
            </button>
          </div>
        </div>
      )}

      {messages.map((msg) => (
        <div key={msg.id} className={`copilot-message copilot-message-${msg.role}`}>
          {msg.role === "assistant" && (
            <span className="copilot-avatar-sm">🤖</span>
          )}
          <div className="copilot-bubble">
            {msg.isLoading ? (
              <div className="copilot-thinking">
                <span className="copilot-dot" />
                <span className="copilot-dot" />
                <span className="copilot-dot" />
              </div>
            ) : (
              <>
                {msg.content && (
                  <div className="copilot-text">{msg.content}</div>
                )}
                {msg.actions && msg.actions.length > 0 && (
                  <div className="copilot-actions">
                    {msg.actions.map((action, idx) => (
                      <ActionCard
                        key={`${msg.id}-action-${idx}`}
                        action={action}
                        confirmed={msg.actionsConfirmed?.[idx] ?? false}
                        onConfirm={(confirmed) =>
                          onConfirm(msg.id, idx, confirmed)
                        }
                        disabled={isLoading}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suggestion click handler (placeholder — will be wired up by parent)
// ---------------------------------------------------------------------------

let suggestionHandler: ((text: string) => void) | null = null;

export function setSuggestionHandler(handler: (text: string) => void): void {
  suggestionHandler = handler;
}

function onSuggestionClick(text: string): void {
  suggestionHandler?.(text);
}

// ---------------------------------------------------------------------------
// ActionCard — 操作预览卡片
// ---------------------------------------------------------------------------

interface ActionCardProps {
  action: CopilotAction;
  confirmed: boolean;
  onConfirm: (confirmed: boolean) => void;
  disabled?: boolean;
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  create_agent: "创建 Agent",
  create_task: "创建 Task",
  create_pipeline: "创建流水线",
  update_agent: "更新 Agent",
  update_task: "更新 Task",
  query_status: "查询状态",
};

function ActionCard({ action, confirmed, onConfirm, disabled }: ActionCardProps) {
  const paramsList = Object.entries(action.params)
    .filter(([key]) => key !== "steps")
    .slice(0, 6)
    .map(([key, val]) => {
      const displayVal = typeof val === "string"
        ? val.length > 50
          ? val.slice(0, 50) + "..."
          : val
        : JSON.stringify(val);
      return `${key}: ${displayVal}`;
    });

  return (
    <div className="action-card">
      <div className="action-card-header">
        <span className="action-card-type">
          {ACTION_TYPE_LABELS[action.type] ?? action.type}
        </span>
      </div>
      <div className="action-card-summary">{action.summary}</div>
      {paramsList.length > 0 && (
        <div className="action-card-params">
          {paramsList.map((line, i) => (
            <div key={i} className="action-card-param">{line}</div>
          ))}
        </div>
      )}
      {action.confirmationRequired && !confirmed && (
        <div className="action-card-buttons">
          <button
            className="action-btn action-btn-confirm"
            onClick={() => onConfirm(true)}
            disabled={disabled}
          >
            确认
          </button>
          <button
            className="action-btn action-btn-cancel"
            onClick={() => onConfirm(false)}
            disabled={disabled}
          >
            取消
          </button>
        </div>
      )}
      {confirmed && (
        <div className="action-card-confirmed">已确认</div>
      )}
    </div>
  );
}
