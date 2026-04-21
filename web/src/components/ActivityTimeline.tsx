import { useEffect, useRef } from "react";
import type { Event, EventType } from "../types";

// ---------------------------------------------------------------------------
// Event type icons
// ---------------------------------------------------------------------------

const EVENT_ICONS: Record<EventType, string> = {
  SDKInit: "\u{1F680}",
  SDKAssistant: "\u{1F916}",
  SDKResult: "\u2705",
  SessionStart: "\u{1F50C}",
  SessionEnd: "\u{1F50C}",
  PreToolUse: "\u{1F527}",
  PostToolUse: "\u{1F527}",
  Stop: "\u{1F6D1}",
  UserPromptSubmit: "\u2328\uFE0F",
  Notification: "\u{1F514}",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ActivityTimelineProps {
  events: Event[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActivityTimeline({ events }: ActivityTimelineProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  if (events.length === 0) {
    return <div className="timeline-empty">暂无事件</div>;
  }

  return (
    <div className="timeline">
      {events.map((event) => {
        const icon = EVENT_ICONS[event.eventType] ?? "\u{1F4E6}";
        const isActive = !event.duration && event.eventType === "PreToolUse";

        return (
          <div
            key={event.id}
            className={`timeline-item ${isActive ? "timeline-item-active" : ""} ${event.eventType === "SDKResult" ? "timeline-item-result" : ""}`}
          >
            <div className="timeline-dot">{icon}</div>
            <div className="timeline-content">
              <div className="timeline-header">
                <span className="timeline-type">{event.eventType}</span>
                {event.toolName && (
                  <span className="timeline-tool">{event.toolName}</span>
                )}
                {event.duration != null && (
                  <span className="timeline-duration">
                    {(event.duration / 1000).toFixed(1)}s
                  </span>
                )}
                <span className="timeline-time">
                  {formatTime(event.timestamp)}
                </span>
              </div>
              {(event.toolInput || event.toolOutput) && (
                <div className="timeline-detail">
                  {event.toolInput && (
                    <pre className="timeline-pre">
                      {truncate(event.toolInput, 200)}
                    </pre>
                  )}
                  {event.toolOutput && (
                    <pre className="timeline-pre timeline-output">
                      {truncate(event.toolOutput, 200)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...";
}
