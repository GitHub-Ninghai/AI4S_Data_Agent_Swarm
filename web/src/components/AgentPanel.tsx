import { useState } from "react";
import { useAppState, useAppDispatch } from "../store/AppContext";
import { AgentCard } from "./AgentCard";
import * as api from "../api/client";
import type { Agent, AgentStatus } from "../types";

// ---------------------------------------------------------------------------
// Sort order: stuck > working > idle > offline
// ---------------------------------------------------------------------------

const STATUS_PRIORITY: Record<AgentStatus, number> = {
  stuck: 0,
  working: 1,
  idle: 2,
  offline: 3,
};

function sortAgents(agents: Agent[]): Agent[] {
  return [...agents].sort(
    (a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status],
  );
}

// ---------------------------------------------------------------------------
// AgentPanel
// ---------------------------------------------------------------------------

export function AgentPanel() {
  const { agents, selectedAgentId } = useAppState();
  const dispatch = useAppDispatch();
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    avatar: "\u{1F916}",
    role: "",
    prompt: "",
  });

  const agentList = sortAgents([...agents.values()]);

  async function handleCreate() {
    if (!form.name.trim() || !form.prompt.trim()) return;
    setCreating(true);
    try {
      const res = await api.createAgent({
        name: form.name.trim(),
        avatar: form.avatar,
        role: form.role.trim() || form.name.trim(),
        prompt: form.prompt.trim(),
      });
      dispatch({ type: "UPDATE_AGENT", agent: res.agent });
      setShowCreate(false);
      setForm({ name: "", avatar: "\u{1F916}", role: "", prompt: "" });
    } catch (err) {
      console.error("Failed to create agent:", err);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="agent-panel">
      {agentList.length === 0 && !showCreate ? (
        <div className="agent-empty">
          <span className="agent-empty-icon">{"\u{1F916}"}</span>
          <p className="agent-empty-title">还没有 Agent</p>
          <p className="agent-empty-desc">
            创建你的第一个 AI 数字员工来开始工作
          </p>
          <button
            className="btn btn-primary"
            onClick={() => setShowCreate(true)}
          >
            创建 Agent
          </button>
        </div>
      ) : (
        <>
          <div className="agent-panel-header">
            <span className="agent-panel-count">{agentList.length} 个 Agent</span>
            <button
              className="btn btn-small"
              onClick={() => setShowCreate(!showCreate)}
            >
              + Agent
            </button>
          </div>

          {showCreate && (
            <div className="agent-create-form">
              <label className="form-label">
                名称
                <input
                  className="form-input"
                  value={form.name}
                  onChange={(e) =>
                    setForm({ ...form, name: e.target.value })
                  }
                  placeholder="Agent 名称"
                />
              </label>
              <label className="form-label">
                角色
                <input
                  className="form-input"
                  value={form.role}
                  onChange={(e) =>
                    setForm({ ...form, role: e.target.value })
                  }
                  placeholder="角色描述"
                />
              </label>
              <label className="form-label">
                Prompt
                <textarea
                  className="form-textarea"
                  value={form.prompt}
                  onChange={(e) =>
                    setForm({ ...form, prompt: e.target.value })
                  }
                  placeholder="系统提示词（至少 10 字）"
                  rows={4}
                />
              </label>
              <div className="form-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowCreate(false)}
                >
                  取消
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleCreate}
                  disabled={
                    creating ||
                    !form.name.trim() ||
                    form.prompt.trim().length < 10
                  }
                >
                  {creating ? "创建中..." : "创建"}
                </button>
              </div>
            </div>
          )}

          <div className="agent-list">
            {agentList.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                isSelected={agent.id === selectedAgentId}
                onSelect={(id) =>
                  dispatch({ type: "SET_SELECTED_AGENT", agentId: id })
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
