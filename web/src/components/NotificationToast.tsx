import { useEffect, useCallback } from "react";
import { useAppState, useAppDispatch } from "../store/AppContext";

// ---------------------------------------------------------------------------
// Auto-dismiss durations (ms)
// ---------------------------------------------------------------------------

const DISMISS_MS: Record<string, number | null> = {
  success: 3000,
  info: 3000,
  warning: 5000,
  error: 5000,
  stuck: null, // never auto-dismiss
};

// ---------------------------------------------------------------------------
// Style config
// ---------------------------------------------------------------------------

const TYPE_STYLES: Record<string, { bg: string; border: string; icon: string }> = {
  success: { bg: "#f0fdf4", border: "#34c759", icon: "\u2705" },
  info: { bg: "#eff6ff", border: "#3b82f6", icon: "\u2139\uFE0F" },
  warning: { bg: "#fffbeb", border: "#f59e0b", icon: "\u26A0\uFE0F" },
  error: { bg: "#fef2f2", border: "#ff3b30", icon: "\u274C" },
  stuck: { bg: "#fffbeb", border: "#f59e0b", icon: "\u{1F6A7}" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NotificationToast() {
  const { notifications } = useAppState();
  const dispatch = useAppDispatch();

  const dismiss = useCallback(
    (id: string) => {
      dispatch({ type: "DISMISS_NOTIFICATION", id });
    },
    [dispatch],
  );

  if (notifications.length === 0) return null;

  return (
    <div className="toast-container">
      {notifications.map((n) => (
        <ToastItem key={n.id} notification={n} onDismiss={dismiss} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single toast
// ---------------------------------------------------------------------------

interface ToastItemProps {
  notification: {
    id: string;
    type: string;
    message: string;
    taskId?: string;
  };
  onDismiss: (id: string) => void;
}

function ToastItem({ notification, onDismiss }: ToastItemProps) {
  const dispatch = useAppDispatch();
  const style = TYPE_STYLES[notification.type] ?? TYPE_STYLES.info;
  const autoMs = DISMISS_MS[notification.type];

  useEffect(() => {
    if (autoMs === null) return; // stuck: never dismiss
    const timer = setTimeout(() => onDismiss(notification.id), autoMs);
    return () => clearTimeout(timer);
  }, [notification.id, autoMs, onDismiss]);

  function handleViewTask() {
    if (notification.taskId) {
      dispatch({ type: "SET_SELECTED_TASK", taskId: notification.taskId });
    }
    onDismiss(notification.id);
  }

  return (
    <div
      className="toast"
      style={{
        background: style.bg,
        borderColor: style.border,
      }}
    >
      <span className="toast-icon">{style.icon}</span>
      <span className="toast-message">{notification.message}</span>
      {notification.type === "stuck" && notification.taskId && (
        <button className="toast-action" onClick={handleViewTask}>
          查看
        </button>
      )}
      <button className="toast-close" onClick={() => onDismiss(notification.id)}>
        {"\u00D7"}
      </button>
    </div>
  );
}
