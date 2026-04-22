import { useRef, useEffect, useCallback, useState } from "react";
import type { WSMessage } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WSHandlers {
  onTaskUpdate?: (data: unknown) => void;
  onAgentUpdate?: (data: unknown) => void;
  onEventNew?: (data: unknown) => void;
  onToolApproval?: (data: unknown) => void;
  onTaskBudget?: (data: unknown) => void;
  onNotification?: (data: unknown) => void;
  onError?: (data: unknown) => void;
}

export interface UseWebSocketReturn {
  connected: boolean;
  reconnectCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WS_URL =
  typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.hostname}:3456/ws`
    : "ws://localhost:3456/ws";

const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWebSocket(handlers: WSHandlers): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(handlers);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayRef = useRef(INITIAL_DELAY_MS);
  const mountedRef = useRef(true);

  // Keep handlers ref current without triggering reconnect
  handlersRef.current = handlers;

  const routeMessage = useCallback((raw: string) => {
    let msg: WSMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const { type, data } = msg;
    const h = handlersRef.current;

    switch (type) {
      case "task:update":
        h.onTaskUpdate?.(data);
        break;
      case "agent:update":
        h.onAgentUpdate?.(data);
        break;
      case "event:new":
        h.onEventNew?.(data);
        break;
      case "tool:approval":
        h.onToolApproval?.(data);
        break;
      case "task:budget":
        h.onTaskBudget?.(data);
        break;
      case "notification":
        h.onNotification?.(data);
        break;
      case "error":
        h.onError?.(data);
        break;
    }
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Clear any pending reconnect timer
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) {
        ws.close();
        return;
      }
      setConnected(true);
      setReconnectCount(0);
      delayRef.current = INITIAL_DELAY_MS;
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        routeMessage(event.data);
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after onerror, so reconnect logic is in onclose
    };
  }, [routeMessage]);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    if (reconnectTimerRef.current !== null) return;

    const delay = delayRef.current;
    delayRef.current = Math.min(delay * 2, MAX_DELAY_MS);

    setReconnectCount((c) => c + 1);

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        const ws = wsRef.current;
        ws.onclose = null; // prevent reconnect on unmount
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.onopen = () => ws.close();
        } else {
          ws.close();
        }
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { connected, reconnectCount };
}
