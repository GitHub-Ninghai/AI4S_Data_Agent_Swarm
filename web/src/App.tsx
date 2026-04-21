import { useState, useEffect } from "react";
import { AppProvider, useAppState, useAppDispatch } from "./store/AppContext";
import { AgentPanel } from "./components/AgentPanel";
import { KanbanBoard } from "./components/KanbanBoard";
import { DetailPanel } from "./components/DetailPanel";

const MIN_WIDTH = 1280;

// ---------------------------------------------------------------------------
// StatusBar — bottom bar
// ---------------------------------------------------------------------------

function StatusBar() {
  const { agents, tasks, wsConnected } = useAppState();

  const agentCount = agents.size;
  const runningCount = [...tasks.values()].filter(
    (t) => t.status === "Running",
  ).length;

  return (
    <footer className="status-bar">
      <span className="status-item">
        {agentCount} Agents
      </span>
      <span className="status-divider">|</span>
      <span className="status-item">
        {runningCount} Running
      </span>
      <span className="status-divider">|</span>
      <span className="status-item">
        Server{" "}
        <span
          className={`status-dot ${wsConnected ? "status-dot-ok" : "status-dot-err"}`}
        />
        {!wsConnected && (
          <span className="status-disconnected">连接中断</span>
        )}
      </span>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// TopBar — header with project filter
// ---------------------------------------------------------------------------

function TopBar() {
  const { projects, activeProjectId } = useAppState();
  const dispatch = useAppDispatch();

  return (
    <header className="top-bar">
      <h1 className="top-bar-title">Agent Swarm</h1>
      <select
        className="project-select"
        value={activeProjectId ?? ""}
        onChange={(e) =>
          dispatch({
            type: "SET_ACTIVE_PROJECT",
            projectId: e.target.value || null,
          })
        }
      >
        <option value="">全部项目</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </header>
  );
}

// ---------------------------------------------------------------------------
// MainLayout — three-column layout
// ---------------------------------------------------------------------------

function MainLayout() {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  return (
    <div className="main-layout">
      <div
        className={`panel panel-left ${leftCollapsed ? "panel-collapsed" : ""}`}
      >
        <div className="panel-header">
          <span>Agents</span>
          <button
            className="collapse-btn"
            onClick={() => setLeftCollapsed(!leftCollapsed)}
            title={leftCollapsed ? "展开" : "折叠"}
          >
            {leftCollapsed ? "▶" : "◀"}
          </button>
        </div>
        {!leftCollapsed && (
          <div className="panel-body">
            <AgentPanel />
          </div>
        )}
      </div>

      <div className="panel panel-center">
        <div className="panel-header">
          <span>Tasks</span>
        </div>
        <div className="panel-body">
          <KanbanBoard />
        </div>
      </div>

      <div
        className={`panel panel-right ${rightCollapsed ? "panel-collapsed" : ""}`}
      >
        <div className="panel-header">
          <button
            className="collapse-btn"
            onClick={() => setRightCollapsed(!rightCollapsed)}
            title={rightCollapsed ? "展开" : "折叠"}
          >
            {rightCollapsed ? "◀" : "▶"}
          </button>
          <span>Detail</span>
        </div>
        {!rightCollapsed && (
          <div className="panel-body">
            <DetailPanel />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AppInner — root layout
// ---------------------------------------------------------------------------

function AppInner() {
  const [tooSmall, setTooSmall] = useState(window.innerWidth < MIN_WIDTH);

  useEffect(() => {
    const handleResize = () => setTooSmall(window.innerWidth < MIN_WIDTH);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (tooSmall) {
    return (
      <div className="screen-warning">
        <h2>请使用更大屏幕</h2>
        <p>Agent Swarm 需要 {MIN_WIDTH}px 以上的屏幕宽度。</p>
        <p className="screen-warning-hint">
          当前宽度：{window.innerWidth}px
        </p>
      </div>
    );
  }

  return (
    <div className="app-root">
      <TopBar />
      <MainLayout />
      <StatusBar />
    </div>
  );
}

// ---------------------------------------------------------------------------
// App — with AppProvider
// ---------------------------------------------------------------------------

export function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  );
}
