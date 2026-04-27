// ---------------------------------------------------------------------------
// useCopilot — Copilot 状态管理 hook
// ---------------------------------------------------------------------------

import { useState, useCallback, useRef } from "react";
import * as api from "../api/client";
import type { CopilotAction } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CopilotMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  actions?: CopilotAction[];
  actionsConfirmed?: boolean[];
  isLoading?: boolean;
}

export interface UseCopilotReturn {
  sessionId: string | null;
  messages: CopilotMessageView[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (message: string) => Promise<void>;
  confirmAction: (messageId: string, actionIndex: number, confirmed: boolean) => Promise<void>;
  clearSession: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

let messageCounter = 0;

export function useCopilot(): UseCopilotReturn {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CopilotMessageView[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);

  const sendMessage = useCallback(async (message: string) => {
    setError(null);
    setIsLoading(true);

    // Add user message
    const userMsg: CopilotMessageView = {
      id: `msg-${++messageCounter}`,
      role: "user",
      content: message,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    // Add loading placeholder
    const loadingId = `msg-${++messageCounter}`;
    setMessages((prev) => [
      ...prev,
      {
        id: loadingId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        isLoading: true,
      },
    ]);

    try {
      const res = await api.sendCopilotMessage({
        sessionId: sessionRef.current ?? undefined,
        message,
      });

      // Update session
      if (!sessionRef.current) {
        sessionRef.current = res.sessionId;
        setSessionId(res.sessionId);
      }

      // Replace loading with actual response
      const assistantMsg: CopilotMessageView = {
        id: loadingId,
        role: "assistant",
        content: res.message,
        timestamp: Date.now(),
        actions: res.actions.length > 0 ? res.actions : undefined,
        actionsConfirmed: res.actions.length > 0
          ? res.actions.map(() => false)
          : undefined,
      };

      setMessages((prev) =>
        prev.map((m) => (m.id === loadingId ? assistantMsg : m)),
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "请求失败";
      setError(errorMsg);

      // Replace loading with error message
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId
            ? { ...m, isLoading: false, content: `请求失败: ${errorMsg}` }
            : m,
        ),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  const confirmAction = useCallback(
    async (messageId: string, actionIndex: number, confirmed: boolean) => {
      if (!sessionRef.current) return;

      try {
        const res = await api.confirmCopilotAction(
          sessionRef.current,
          actionIndex,
          confirmed,
        );

        // Update the action's confirmed state
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== messageId || !m.actionsConfirmed) return m;
            const updated = [...m.actionsConfirmed];
            updated[actionIndex] = true;
            return {
              ...m,
              actionsConfirmed: updated,
              content: res.success
                ? m.content
                : `${m.content}\n\n操作失败: ${res.message}`,
            };
          }),
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "确认操作失败";
        setError(errorMsg);
      }
    },
    [],
  );

  const clearSession = useCallback(() => {
    if (sessionRef.current) {
      api.deleteCopilotSession(sessionRef.current).catch(() => {});
    }
    sessionRef.current = null;
    setSessionId(null);
    setMessages([]);
    setError(null);
  }, []);

  return {
    sessionId,
    messages,
    isLoading,
    error,
    sendMessage,
    confirmAction,
    clearSession,
  };
}
