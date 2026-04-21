import type { Agent, AgentStatus } from "./types.js";
import { agentsStore } from "./index.js";

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

const agents = new Map<string, Agent>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function persist(): void {
  agentsStore.save({
    _schema_version: 1,
    agents: Array.from(agents.values()),
  });
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function getAllAgents(): Agent[] {
  return Array.from(agents.values());
}

export function getAgentById(id: string): Agent | undefined {
  return agents.get(id);
}

export function createAgent(agent: Agent): Agent {
  agents.set(agent.id, agent);
  persist();
  return agent;
}

export function updateAgent(
  id: string,
  patch: Partial<Omit<Agent, "id" | "createdAt">>,
): Agent | undefined {
  const existing = agents.get(id);
  if (!existing) return undefined;

  const updated: Agent = {
    ...existing,
    ...patch,
    updatedAt: Date.now(),
  };
  agents.set(id, updated);
  persist();
  return updated;
}

export function deleteAgent(id: string): boolean {
  const deleted = agents.delete(id);
  if (deleted) persist();
  return deleted;
}

// ---------------------------------------------------------------------------
// Specialized queries
// ---------------------------------------------------------------------------

/** Find agents by their status */
export function getAgentsByStatus(status: AgentStatus): Agent[] {
  return getAllAgents().filter((a) => a.status === status);
}

/** Get agents associated with a specific project */
export function getAgentsByProject(projectId: string): Agent[] {
  return getAllAgents().filter((a) => a.projectId === projectId);
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/** Load agents from disk into memory. Call once at startup. */
export function loadAgents(): void {
  const data = agentsStore.getData();
  const list = (data.agents as Agent[]) ?? [];
  agents.clear();
  for (const agent of list) {
    agents.set(agent.id, agent);
  }
}
