import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentCard } from "../AgentCard";
import type { Agent } from "../../types";

// ---------------------------------------------------------------------------
// Mock AppContext
// ---------------------------------------------------------------------------

vi.mock("../../store/AppContext", () => ({
  useAppState: () => ({
    agents: new Map(),
    tasks: new Map(),
    selectedAgentId: null,
  }),
  useAppDispatch: () => vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "Test Agent",
    avatar: "🤖",
    role: "Code Reviewer",
    prompt: "Test prompt for unit testing purposes",
    isEnabled: true,
    status: "idle",
    taskCount: 0,
    stats: { totalTasksCompleted: 0, totalTasksCancelled: 0, totalCostUsd: 0, avgDurationMs: 0 },
    lastEventAt: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentCard", () => {
  it("renders agent name and avatar", () => {
    const agent = makeAgent();
    render(<AgentCard agent={agent} onSelect={vi.fn()} onEdit={vi.fn()} isSelected={false} />);

    expect(screen.getByText("Test Agent")).toBeInTheDocument();
    expect(screen.getByText("🤖")).toBeInTheDocument();
  });

  it("displays idle status", () => {
    const agent = makeAgent({ status: "idle" });
    render(<AgentCard agent={agent} onSelect={vi.fn()} onEdit={vi.fn()} isSelected={false} />);

    expect(screen.getByText(/Idle/)).toBeInTheDocument();
  });

  it("displays working status", () => {
    const agent = makeAgent({ status: "working", taskCount: 1 });
    render(<AgentCard agent={agent} onSelect={vi.fn()} onEdit={vi.fn()} isSelected={false} />);

    expect(screen.getByText(/Working/)).toBeInTheDocument();
  });

  it("displays stuck status", () => {
    const agent = makeAgent({ status: "stuck", taskCount: 1 });
    render(<AgentCard agent={agent} onSelect={vi.fn()} onEdit={vi.fn()} isSelected={false} />);

    expect(screen.getByText(/Stuck/)).toBeInTheDocument();
  });

  it("displays offline status", () => {
    const agent = makeAgent({ status: "offline", isEnabled: false });
    render(<AgentCard agent={agent} onSelect={vi.fn()} onEdit={vi.fn()} isSelected={false} />);

    expect(screen.getByText(/Offline/)).toBeInTheDocument();
  });

  it("calls onSelect when clicked", async () => {
    const onSelect = vi.fn();
    const agent = makeAgent();
    render(<AgentCard agent={agent} onSelect={onSelect} onEdit={vi.fn()} isSelected={false} />);

    await userEvent.click(screen.getByText("Test Agent"));
    expect(onSelect).toHaveBeenCalledWith("agent-1");
  });

  it("displays task count", () => {
    const agent = makeAgent({ taskCount: 5 });
    render(<AgentCard agent={agent} onSelect={vi.fn()} onEdit={vi.fn()} isSelected={false} />);

    // Task count displayed as part of the card info
    expect(screen.getByText(/5/)).toBeInTheDocument();
  });
});
