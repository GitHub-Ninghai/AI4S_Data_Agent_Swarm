import { useState } from "react";
import TopBar from "./TopBar";
import AgentPanel from "./AgentPanel";
import KanbanBoard from "./KanbanBoard";
import DetailPanel from "./DetailPanel";
import StatusBar from "./StatusBar";
import AgentFormModal from "./modals/AgentFormModal";
import TaskFormModal from "./modals/TaskFormModal";
import NotificationContainer from "./NotificationContainer";
import ScreenGuard from "./ScreenGuard";
import UserProfileModal from "./modals/UserProfileModal";
import AutodataCreateModal from "./autodata/AutodataCreateModal";
import PixelWorldView from "./PixelWorldView";
import WorldOverlay from "./WorldOverlay";
import type { Agent, Task, Project } from "../types";
import type { UserProfile } from "../App";

interface Props {
  agents: Agent[];
  tasks: Task[];
  filteredAgents: Agent[];
  filteredTasks: Task[];
  selectedAgentId: string | null;
  selectedTaskId: string | null;
  selectedAgent: Agent | null;
  selectedTask: Task | null;
  activeProject: string;
  agentCollapsed: boolean;
  detailCollapsed: boolean;
  showAgentModal: boolean;
  showTaskModal: boolean;
  editingAgent: Agent | null;
  editingTask: Task | null;
  preselectAgentId: string | null;
  runningCount: number;
  user: UserProfile;
  showUserModal: boolean;
  projects: Project[];
  wsConnected: boolean;
  onProjectChange: (id: string) => void;
  onNewProject: () => void;
  onToggleAgentCollapse: () => void;
  onToggleDetailCollapse: () => void;
  onSelectAgent: (id: string) => void;
  onSelectTask: (id: string) => void;
  onCreateAgent: () => void;
  onEditAgent: (agent: Agent) => void;
  onCreateTask: (agentId?: string) => void;
  onEditTask: (task: Task) => void;
  onSaveAgent: (agent: Agent, apiKey?: string) => void;
  onSaveTask: (task: Task) => void;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
  setShowAgentModal: (v: boolean) => void;
  setShowTaskModal: (v: boolean) => void;
  setEditingAgent: (v: Agent | null) => void;
  setEditingTask: (v: Task | null) => void;
  setPreselectAgentId: (v: string | null) => void;
  setUser: (u: UserProfile) => void;
  setShowUserModal: (v: boolean) => void;
  onLogout: () => void;
  showAutodataModal: boolean;
  onOpenAutodata: () => void;
  onCloseAutodata: () => void;
  onAutodataCreated: () => void;
}

export default function Dashboard(props: Props) {
  const [viewMode, setViewMode] = useState<"kanban" | "world">("world");

  return (
    <ScreenGuard>
      <div
        className="h-screen flex flex-col"
        style={{ background: "var(--bg-void)" }}
      >
        <TopBar
          activeProject={props.activeProject}
          onProjectChange={props.onProjectChange}
          onNewProject={props.onNewProject}
          projects={props.projects}
          user={props.user}
          onOpenProfile={() => props.setShowUserModal(true)}
          onLogout={props.onLogout}
        />

        <div className="flex-1 flex overflow-hidden">
          <AgentPanel
            agents={props.filteredAgents}
            selectedAgentId={props.selectedAgentId}
            collapsed={props.agentCollapsed}
            onToggleCollapse={props.onToggleAgentCollapse}
            onSelectAgent={props.onSelectAgent}
            onCreateAgent={props.onCreateAgent}
            onEditAgent={props.onEditAgent}
          />

          {/* Middle area: Kanban or Pixel World — supports agent drag-drop */}
          <div
            className="flex-1 flex flex-col min-w-0 relative"
            onDragOver={e => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDrop={e => {
              e.preventDefault();
              const agentId = e.dataTransfer.getData("agentId");
              if (agentId) props.onCreateTask(agentId);
            }}
          >
            {viewMode === "kanban" ? (
              <KanbanBoard
                tasks={props.filteredTasks}
                agents={props.agents}
                selectedTaskId={props.selectedTaskId}
                onSelectTask={props.onSelectTask}
                onCreateTask={props.onCreateTask}
                onEditTask={props.onEditTask}
                setTasks={props.setTasks}
                onRefreshAgents={async () => {
                  const { AgentApi } = await import("../api");
                  const res = await AgentApi.list();
                  if (res) props.setAgents(res);
                }}
                onOpenAutodata={props.onOpenAutodata}
              />
            ) : (
              <>
                <PixelWorldView
                  agents={props.agents}
                  tasks={props.tasks}
                  selectedAgentId={props.selectedAgentId}
                  selectedTaskId={props.selectedTaskId}
                  onSelectAgent={props.onSelectAgent}
                  onSelectTask={props.onSelectTask}
                />
                <WorldOverlay
                  agentCount={props.agents.length}
                  runningCount={props.runningCount}
                  selectedAgent={props.selectedAgent}
                  onSwitchToKanban={() => setViewMode("kanban")}
                />
              </>
            )}

            {/* View switch button */}
            <button
              onClick={() =>
                setViewMode(viewMode === "kanban" ? "world" : "kanban")
              }
              className="absolute top-2 right-2 z-10 flex items-center gap-1.5 text-xs py-1.5 px-3 rounded-lg transition-all hover:opacity-80"
              style={{
                border: "1px solid var(--border-medium)",
                color: "var(--text-secondary)",
                background: "rgba(26,26,46,0.8)",
                backdropFilter: "blur(4px)",
              }}
            >
              {viewMode === "kanban" ? (
                <>
                  <span style={{ color: "#ffa27a" }}>🗺</span>
                  <span>世界</span>
                </>
              ) : (
                <>
                  <span style={{ color: "#ffa27a" }}>📋</span>
                  <span>看板</span>
                </>
              )}
            </button>
          </div>

          <DetailPanel
            task={props.selectedTask}
            agent={props.selectedAgent}
            tasks={props.tasks}
            collapsed={props.detailCollapsed}
            onToggleCollapse={props.onToggleDetailCollapse}
            onSelectTask={props.onSelectTask}
            onSelectAgent={props.onSelectAgent}
            onEditTask={props.onEditTask}
            onEditAgent={props.onEditAgent}
            setTasks={props.setTasks}
            onRefreshAgents={async () => {
              const { AgentApi } = await import("../api");
              const res = await AgentApi.list();
              if (res) props.setAgents(res);
            }}
          />
        </div>

        <StatusBar
          agentCount={props.agents.length}
          runningCount={props.runningCount}
          connected={props.wsConnected}
        />

        {props.showAgentModal && (
          <AgentFormModal
            agent={props.editingAgent}
            projects={props.projects}
            existingAgents={props.agents}
            onClose={() => {
              props.setShowAgentModal(false);
              props.setEditingAgent(null);
            }}
            onSave={props.onSaveAgent}
          />
        )}

        {props.showTaskModal && (
          <TaskFormModal
            task={props.editingTask}
            preselectAgentId={props.preselectAgentId}
            agents={props.agents}
            projects={props.projects}
            onClose={() => {
              props.setShowTaskModal(false);
              props.setEditingTask(null);
              props.setPreselectAgentId(null);
            }}
            onSave={props.onSaveTask}
          />
        )}

        {props.showUserModal && (
          <UserProfileModal
            user={props.user}
            onClose={() => props.setShowUserModal(false)}
            onSave={u => {
              props.setUser(u);
              props.setShowUserModal(false);
            }}
          />
        )}

        {props.showAutodataModal && (
          <AutodataCreateModal
            agents={props.agents}
            projects={props.projects}
            onClose={props.onCloseAutodata}
            onCreated={props.onAutodataCreated}
          />
        )}

        <NotificationContainer />
      </div>
    </ScreenGuard>
  );
}
