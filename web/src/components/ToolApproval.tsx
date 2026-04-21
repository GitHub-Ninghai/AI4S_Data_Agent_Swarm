import { useState } from "react";
import * as api from "../api/client";

interface ToolApprovalProps {
  taskId: string;
  toolName: string;
  toolInput?: string;
  stuckReason?: string;
}

export function ToolApproval({
  taskId,
  toolName,
  toolInput,
  stuckReason,
}: ToolApprovalProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState(false);

  async function handleDecision(decision: "allow" | "deny") {
    setLoading(decision);
    try {
      await api.approveTool(taskId, decision);
    } catch (err) {
      console.error("Tool approval failed:", err);
    } finally {
      setLoading(null);
    }
  }

  async function handleSendMessage() {
    if (!message.trim()) return;
    setLoading("message");
    try {
      await api.messageTask(taskId, message.trim());
      setMessage("");
    } catch (err) {
      console.error("Send message failed:", err);
    } finally {
      setLoading(null);
    }
  }

  const displayInput = toolInput ?? "";
  const shouldTruncate = displayInput.length > 500;

  return (
    <div className="tool-approval">
      <div className="tool-approval-header">
        <span className="tool-approval-icon">{"\u26A0\uFE0F"}</span>
        <span>工具审批请求</span>
      </div>

      {stuckReason && (
        <div className="tool-approval-reason">{stuckReason}</div>
      )}

      <div className="tool-approval-info">
        <div className="tool-approval-label">工具: {toolName}</div>
        {displayInput && (
          <pre className="tool-approval-input">
            {shouldTruncate && !expanded
              ? displayInput.slice(0, 500)
              : displayInput}
            {shouldTruncate && (
              <button
                className="tool-approval-expand"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? "收起" : "...展开"}
              </button>
            )}
          </pre>
        )}
      </div>

      <div className="tool-approval-actions">
        <button
          className="btn btn-primary"
          onClick={() => handleDecision("allow")}
          disabled={loading !== null}
        >
          {loading === "allow" ? "处理中..." : "\u2705 允许"}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => handleDecision("deny")}
          disabled={loading !== null}
        >
          {loading === "deny" ? "处理中..." : "\u274C 拒绝"}
        </button>
      </div>

      <div className="tool-approval-message">
        <textarea
          className="form-textarea"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="发送自定义消息..."
          rows={2}
        />
        <button
          className="btn btn-small"
          onClick={handleSendMessage}
          disabled={loading !== null || !message.trim()}
        >
          {loading === "message" ? "发送中..." : "发送"}
        </button>
      </div>
    </div>
  );
}
