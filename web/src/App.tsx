import { useState, useCallback, useEffect, useRef } from "react";
import { Routes, Route } from "react-router-dom";
import type { Agent, Task, Project } from "./types";
import {
  agents as fallbackAgents,
  tasks as fallbackTasks,
  projects as fallbackProjects,
} from "./data";
import {
  AgentApi,
  TaskApi,
  ProjectApi,
  UserApi,
  createWebSocket,
  type WSMessage,
} from "./api";
import Dashboard from "./components/Dashboard";
import { showToast } from "./components/NotificationContainer";

const AVATAR_DEFAULT = "/images/avatar-default.png";

export interface UserProfile {
  name: string;
  email: string;
  avatar: string;
  role: string;
}

const DEFAULT_USER: UserProfile = {
  name: "指挥员",
  email: "commander@ai4s.swarm",
  avatar: AVATAR_DEFAULT,
  role: "系统管理员",
};

function AppRoutes() {
  // Auth guard: redirect to landing page if no token
  const [authed, setAuthed] = useState(() => !!localStorage.getItem("token"));

  useEffect(() => {
    if (!authed) {
      window.location.href = "/landing.html";
    }
  }, [authed]);

  const [agents, setAgents] = useState<Agent[]>(fallbackAgents);
  const [tasks, setTasks] = useState<Task[]>(fallbackTasks);
  const [projects, setProjects] = useState<Project[]>(fallbackProjects);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<string>("all");
  const [agentCollapsed, setAgentCollapsed] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [preselectAgentId, setPreselectAgentId] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile>(DEFAULT_USER);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showAutodataModal, setShowAutodataModal] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Load initial data from API
  useEffect(() => {
    async function loadData() {
      try {
        const [agentsRes, tasksRes, projectsRes] = await Promise.all([
          AgentApi.list(),
          TaskApi.list(),
          ProjectApi.list(),
        ]);
        if (agentsRes) setAgents(agentsRes);
        if (tasksRes) setTasks(tasksRes);
        if (projectsRes) setProjects(projectsRes);
      } catch (err) {
        console.warn(
          "[App] Failed to load data from API, using fallback:",
          err
        );
      }
    }
    loadData();
  }, []);

  // Load user profile
  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await UserApi.profile();
        if (res) {
          setUser({
            name: res.name,
            email: res.email,
            avatar: res.avatar || AVATAR_DEFAULT,
            role: res.role,
          });
        }
      } catch {
        // Use default user for unauthenticated access
      }
    }
    loadProfile();
  }, []);

  // WebSocket connection
  useEffect(() => {
    function connectWs() {
      const ws = createWebSocket((msg: WSMessage) => {
        // Handle real-time updates
        if (msg.type === "task.status" || msg.type === "event.new") {
          const payload = msg.payload as Record<string, unknown>;
          if (payload && typeof payload === "object") {
            // Refresh task list on any task update
            TaskApi.list()
              .then(ts => {
                if (ts) setTasks(ts);
              })
              .catch(() => {});
          }
        }
        if (msg.type === "agent.status") {
          const payload = msg.payload as Record<string, unknown>;
          if (payload && typeof payload === "object") {
            AgentApi.list()
              .then(as => {
                if (as) setAgents(as);
              })
              .catch(() => {});
          }
        }
        if (msg.type === "approval.new") {
          showToast("warning", "有新的工具审批请求");
        }
      });

      wsRef.current = ws;

      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => {
        setWsConnected(false);
        // Reconnect after 3s
        setTimeout(connectWs, 3000);
      };
    }

    connectWs();
    return () => {
      wsRef.current?.close();
    };
  }, []);

  // Refresh helpers
  const refreshAgents = useCallback(async () => {
    try {
      const res = await AgentApi.list();
      if (res) setAgents(res);
    } catch {}
  }, []);

  const refreshTasks = useCallback(async () => {
    try {
      const res = await TaskApi.list();
      if (res) setTasks(res);
    } catch {}
  }, []);

  const selectedAgent = agents.find(a => a.id === selectedAgentId) || null;
  const selectedTask = tasks.find(t => t.id === selectedTaskId) || null;
  const runningCount = tasks.filter(t => t.status === "Running").length;

  const filteredTasks =
    activeProject === "all"
      ? tasks
      : tasks.filter(t => t.projectId === activeProject);
  const filteredAgents =
    activeProject === "all"
      ? agents
      : agents.filter(a => a.projectId === activeProject);

  const handleSelectAgent = useCallback((id: string) => {
    setSelectedAgentId(id);
    setSelectedTaskId(null);
  }, []);

  const handleSelectTask = useCallback(
    (id: string) => {
      const task = tasks.find(t => t.id === id);
      if (task) {
        setSelectedTaskId(id);
        setSelectedAgentId(task.agentId);
      }
    },
    [tasks]
  );

  const handleCreateAgent = useCallback(() => {
    setEditingAgent(null);
    setShowAgentModal(true);
  }, []);

  const handleEditAgent = useCallback((agent: Agent) => {
    setEditingAgent(agent);
    setShowAgentModal(true);
  }, []);

  const handleCreateTask = useCallback((agentId?: string) => {
    setEditingTask(null);
    setPreselectAgentId(agentId || null);
    setShowTaskModal(true);
  }, []);

  const handleEditTask = useCallback((task: Task) => {
    setEditingTask(task);
    setPreselectAgentId(null);
    setShowTaskModal(true);
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem("token");
    setAuthed(false);
    UserApi.logout().catch(() => {});
  }, []);

  const handleNewProject = useCallback(async () => {
    const name = window.prompt(
      "请输入项目名称（仅支持英文、数字、下划线、横杠）："
    );
    if (!name) return;

    // Default to current directory
    const defaultPath = ".";
    const projectPath = window.prompt(
      `请输入项目路径（相对路径会基于服务器目录解析）\n默认: ${defaultPath}`,
      defaultPath
    );
    if (projectPath === null) return; // User cancelled

    try {
      await ProjectApi.create({
        name,
        path: projectPath || defaultPath,
      });
      const res = await ProjectApi.list();
      if (res) setProjects(res);
      showToast("success", `项目 "${name}" 创建成功`);
    } catch (err) {
      showToast("error", `创建项目失败: ${err}`);
    }
  }, []);

  // Agent CRUD via API
  const handleSaveAgent = useCallback(
    async (agent: Agent, apiKey?: string) => {
      try {
        if (editingAgent) {
          await AgentApi.update(agent.id, agent, apiKey);
        } else {
          await AgentApi.create(agent, apiKey);
        }
        await refreshAgents();
        await refreshTasks();
      } catch (err) {
        showToast("error", `保存智能体失败: ${err}`);
      }
      setShowAgentModal(false);
      setEditingAgent(null);
    },
    [editingAgent, refreshAgents, refreshTasks]
  );

  // Task CRUD via API
  const handleSaveTask = useCallback(
    async (task: Task) => {
      try {
        if (editingTask) {
          await TaskApi.update(task.id, task);
        } else {
          await TaskApi.create(task);
        }
        await refreshTasks();
        await refreshAgents();
      } catch (err) {
        showToast("error", `保存任务失败: ${err}`);
      }
      setShowTaskModal(false);
      setEditingTask(null);
      setPreselectAgentId(null);
    },
    [editingTask, refreshTasks, refreshAgents]
  );

  const dashboardElement = (
    <Dashboard
      agents={agents}
      tasks={tasks}
      filteredAgents={filteredAgents}
      filteredTasks={filteredTasks}
      selectedAgentId={selectedAgentId}
      selectedTaskId={selectedTaskId}
      selectedAgent={selectedAgent}
      selectedTask={selectedTask}
      activeProject={activeProject}
      agentCollapsed={agentCollapsed}
      detailCollapsed={detailCollapsed}
      showAgentModal={showAgentModal}
      showTaskModal={showTaskModal}
      editingAgent={editingAgent}
      editingTask={editingTask}
      preselectAgentId={preselectAgentId}
      runningCount={runningCount}
      user={user}
      showUserModal={showUserModal}
      projects={projects}
      wsConnected={wsConnected}
      onProjectChange={setActiveProject}
      onNewProject={handleNewProject}
      onToggleAgentCollapse={() => setAgentCollapsed(!agentCollapsed)}
      onToggleDetailCollapse={() => setDetailCollapsed(!detailCollapsed)}
      onSelectAgent={handleSelectAgent}
      onSelectTask={handleSelectTask}
      onCreateAgent={handleCreateAgent}
      onEditAgent={handleEditAgent}
      onCreateTask={handleCreateTask}
      onEditTask={handleEditTask}
      onSaveAgent={handleSaveAgent}
      onSaveTask={handleSaveTask}
      setTasks={setTasks}
      setAgents={setAgents}
      setShowAgentModal={setShowAgentModal}
      setShowTaskModal={setShowTaskModal}
      setEditingAgent={setEditingAgent}
      setEditingTask={setEditingTask}
      setPreselectAgentId={setPreselectAgentId}
      setUser={setUser}
      setShowUserModal={setShowUserModal}
      onLogout={handleLogout}
      showAutodataModal={showAutodataModal}
      onOpenAutodata={() => setShowAutodataModal(true)}
      onCloseAutodata={() => setShowAutodataModal(false)}
      onAutodataCreated={async () => {
        await refreshTasks();
        await refreshAgents();
      }}
    />
  );

  return (
    <Routes>
      <Route path="/" element={dashboardElement} />
      <Route path="/dashboard" element={dashboardElement} />
    </Routes>
  );
}

export default function App() {
  return <AppRoutes />;
}
