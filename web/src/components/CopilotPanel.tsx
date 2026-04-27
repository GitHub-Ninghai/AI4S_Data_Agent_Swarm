// ---------------------------------------------------------------------------
// CopilotPanel — Copilot 主面板
// ---------------------------------------------------------------------------

import { useCallback, useRef, useEffect } from "react";
import { useCopilot } from "../hooks/useCopilot";
import { CopilotChat, setSuggestionHandler } from "./CopilotChat";
import { CopilotInput } from "./CopilotInput";

export function CopilotPanel() {
  const {
    messages,
    isLoading,
    error,
    sendMessage,
    confirmAction,
    clearSession,
  } = useCopilot();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Wire up suggestion handler
  useEffect(() => {
    setSuggestionHandler(sendMessage);
    return () => setSuggestionHandler(() => {});
  }, [sendMessage]);

  const handleSend = useCallback(
    (message: string) => {
      void sendMessage(message);
    },
    [sendMessage],
  );

  const handleConfirm = useCallback(
    (messageId: string, actionIndex: number, confirmed: boolean) => {
      void confirmAction(messageId, actionIndex, confirmed);
    },
    [confirmAction],
  );

  return (
    <div className="copilot-panel">
      <div className="copilot-header">
        <span className="copilot-header-title">Copilot</span>
        {messages.length > 0 && (
          <button
            className="copilot-clear-btn"
            onClick={clearSession}
            title="清空对话"
          >
            清空
          </button>
        )}
      </div>

      {error && (
        <div className="copilot-error">{error}</div>
      )}

      <div className="copilot-body">
        <CopilotChat
          messages={messages}
          isLoading={isLoading}
          onConfirm={handleConfirm}
        />
        <div ref={messagesEndRef} />
      </div>

      <CopilotInput onSend={handleSend} disabled={isLoading} />
    </div>
  );
}
