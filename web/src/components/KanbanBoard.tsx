import { useState, useEffect, useRef } from "react";
import { useAppState, useAppDispatch } from "../store/AppContext";
import { TaskCard } from "./TaskCard";
import { TaskFormModal } from "./modals/TaskFormModal";
import type { Task, TaskStatus } from "../types";

// ---------------------------------------------------------------------------
// Column config
// ---------------------------------------------------------------------------

interface Column {
  status: TaskStatus;
  label: string;
  icon: string;
}

const COLUMNS: Column[] = [
  { status: "Todo", label: "Todo", icon: "\u{1F4CB}" },
  { status: "Running", label: "Running", icon: "\u{1F504}" },
  { status: "Stuck", label: "Stuck", icon: "\u{1F7E1}" },
  { status: "Done", label: "Done", icon: "\u2705" },
];

// ---------------------------------------------------------------------------
// Skeleton for Task cards
// ---------------------------------------------------------------------------

function TaskSkeleton() {
  return (
    <div className="skeleton-task">
      <div className="skeleton skeleton-line skeleton-line-short" style={{ height: 14 }} />
      <div className="skeleton skeleton-line skeleton-line-long" />
      <div className="skeleton skeleton-line skeleton-line-medium" />
    </div>
  );
}

function KanbanColumnSkeleton() {
  return (
    <div className="kanban-column">
      <div className="kanban-column-header">
        <span>
          <span className="skeleton skeleton-line" style={{ width: 60, height: 12, display: "inline-block" }} />
        </span>
        <span className="kanban-column-count">0</span>
      </div>
      <div className="kanban-column-body">
        <TaskSkeleton />
        <TaskSkeleton />
        <TaskSkeleton />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KanbanBoard
// ---------------------------------------------------------------------------

export function KanbanBoard() {
  const { tasks, activeProjectId, loading, wsConnected } = useAppState();
  const dispatch = useAppDispatch();
  const [modalTask, setModalTask] = useState<Task | "create" | null>(null);
  const [dragOverAgentId, setDragOverAgentId] = useState<string | null>(null);

  // Track WS reconnect for column spinners
  const prevConnectedRef = useRef(wsConnected);
  const [columnsRefreshing, setColumnsRefreshing] = useState(false);

  useEffect(() => {
    // Detect reconnection — show spinner briefly
    if (wsConnected && !prevConnectedRef.current) {
      setColumnsRefreshing(true);
      const timer = setTimeout(() => setColumnsRefreshing(false), 1500);
      prevConnectedRef.current = wsConnected;
      return () => clearTimeout(timer);
    }
    prevConnectedRef.current = wsConnected;
  }, [wsConnected]);

  // First-load skeleton
  if (loading) {
    return (
      <div className="kanban">
        <div className="kanban-header">
          <span className="kanban-title">Tasks</span>
        </div>
        <div className="kanban-columns">
          <KanbanColumnSkeleton />
          <KanbanColumnSkeleton />
          <KanbanColumnSkeleton />
          <KanbanColumnSkeleton />
        </div>
      </div>
    );
  }

  // Filter tasks by active project
  const filteredTasks = activeProjectId
    ? [...tasks.values()].filter((t) => t.projectId === activeProjectId)
    : [...tasks.values()];

  // Group by status (Cancelled grouped with Done)
  const columnTasks = (status: TaskStatus): Task[] => {
    if (status === "Done") {
      return filteredTasks
        .filter((t) => t.status === "Done" || t.status === "Cancelled")
        .sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt);
    }
    return filteredTasks
      .filter((t) => t.status === status)
      .sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt);
  };

  const handleDragOver = (e: React.DragEvent) => {
    const agentId = e.dataTransfer.types.includes("application/agent-id");
    if (agentId) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    const agentId = e.dataTransfer.types.includes("application/agent-id");
    if (agentId) {
      e.preventDefault();
      // Read agentId from dataTransfer — not available on dragEnter in some browsers,
      // so we just set a flag to indicate an agent is being dragged over
      setDragOverAgentId("dragging");
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if leaving the kanban root
    const rect = e.currentTarget.getBoundingClientRect();
    const { clientX, clientY } = e;
    if (clientX <= rect.left || clientX >= rect.right || clientY <= rect.top || clientY >= rect.bottom) {
      setDragOverAgentId(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const agentId = e.dataTransfer.getData("application/agent-id");
    setDragOverAgentId(null);
    if (agentId) {
      // Open create task modal — pass agentId via a special object
      setModalTask(agentId as unknown as "create");
    }
  };

  // Determine if modalTask is an agent-id-based creation
  const modalAgentId = modalTask !== null && modalTask !== "create" && typeof modalTask === "string"
    ? (modalTask as unknown as string)
    : undefined;
  // The actual value to pass to TaskFormModal
  const effectiveModalTask = modalAgentId ? undefined : (modalTask === "create" ? undefined : modalTask);
  const showModal = modalTask !== null;

  return (
    <div
      className={`kanban ${dragOverAgentId ? "kanban-drag-over" : ""}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="kanban-header">
        <span className="kanban-title">Tasks</span>
        <button className="btn btn-small" onClick={() => setModalTask("create")}>
          + Task
        </button>
      </div>

      <div className="kanban-columns">
        {COLUMNS.map((col) => {
          const items = columnTasks(col.status);
          return (
            <div key={col.status} className="kanban-column">
              <div className="kanban-column-header">
                <span>
                  {col.icon} {col.label}
                </span>
                <span className="kanban-column-count">{items.length}</span>
              </div>
              {columnsRefreshing && (
                <div className="column-spinner">
                  <span className="spinner spinner-sm" />
                </div>
              )}
              <div className="kanban-column-body">
                {items.length === 0 ? (
                  <div className="kanban-empty">
                    <span>{col.status === "Todo" ? "\u{1F4CB}" : "\u2705"}</span>
                    <p>
                      {col.status === "Todo"
                        ? "没有待处理的任务"
                        : "暂无任务"}
                    </p>
                  </div>
                ) : (
                  items.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onSelect={(id) =>
                        dispatch({
                          type: "SET_SELECTED_TASK",
                          taskId: id,
                        })
                      }
                      onEdit={(t) => setModalTask(t)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showModal && (
        <TaskFormModal
          task={effectiveModalTask as Task | undefined}
          defaultAgentId={modalAgentId}
          onClose={() => setModalTask(null)}
        />
      )}
    </div>
  );
}
