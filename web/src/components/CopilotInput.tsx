// ---------------------------------------------------------------------------
// CopilotInput — 输入框 + 发送按钮
// ---------------------------------------------------------------------------

import { useState, useCallback, type KeyboardEvent } from "react";

interface CopilotInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function CopilotInput({ onSend, disabled }: CopilotInputProps) {
  const [value, setValue] = useState("");

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="copilot-input-container">
      <textarea
        className="copilot-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="描述你想做的事情..."
        rows={1}
        disabled={disabled}
      />
      <button
        className="copilot-send-btn"
        onClick={handleSend}
        disabled={disabled || !value.trim()}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M1 8L15 1L8 15L7 9L1 8Z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
