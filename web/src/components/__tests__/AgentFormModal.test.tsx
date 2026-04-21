import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentFormModal } from "../modals/AgentFormModal";
import type { Agent } from "../../types";

// ---------------------------------------------------------------------------
// Mock AppContext
// ---------------------------------------------------------------------------

vi.mock("../../store/AppContext", () => ({
  useAppState: () => ({
    agents: new Map(),
    tasks: new Map(),
    projects: [
      { id: "proj-1", name: "Test Project", path: "/tmp", createdAt: Date.now(), updatedAt: Date.now() },
    ],
  }),
  useAppDispatch: () => vi.fn(),
}));

vi.mock("../../api/client", () => ({
  createAgent: vi.fn().mockResolvedValue({
    agent: {
      id: "new-agent",
      name: "Test",
      status: "idle",
    },
  }),
  updateAgent: vi.fn().mockResolvedValue({
    agent: { id: "agent-1", name: "Updated" },
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentFormModal", () => {
  it("disables submit when name is empty", () => {
    render(<AgentFormModal onClose={vi.fn()} />);

    // Name is empty by default, submit should be disabled
    expect(screen.getByRole("button", { name: /创建/ })).toBeDisabled();
  });

  it("shows error when prompt is too short", async () => {
    render(<AgentFormModal onClose={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText(/Agent 名称/), "Test Agent");
    await userEvent.type(screen.getByPlaceholderText(/数据合成/), "Tester");
    await userEvent.type(screen.getByPlaceholderText(/行为规范/), "short"); // < 10 chars

    expect(screen.getByText(/至少 10 个字符/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /创建/ })).toBeDisabled();
  });

  it("enables submit with valid data", async () => {
    render(<AgentFormModal onClose={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText(/Agent 名称/), "Valid Agent");
    await userEvent.type(screen.getByPlaceholderText(/数据合成/), "Tester Role");
    await userEvent.type(screen.getByPlaceholderText(/行为规范/), "This is a valid prompt for testing");

    expect(screen.getByRole("button", { name: /创建/ })).not.toBeDisabled();
  });

  it("pre-fills fields in edit mode", () => {
    const agent: Agent = {
      id: "agent-1",
      name: "Existing Agent",
      avatar: "🤖",
      role: "Coder",
      prompt: "An existing agent prompt for testing purposes",
      isEnabled: true,
      status: "idle",
      taskCount: 3,
      stats: { totalTasksCompleted: 2, totalTasksCancelled: 0, totalCostUsd: 0, avgDurationMs: 0 },
      lastEventAt: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    render(<AgentFormModal agent={agent} onClose={vi.fn()} />);

    const nameInput = screen.getByPlaceholderText(/Agent 名称/) as HTMLInputElement;
    expect(nameInput.value).toBe("Existing Agent");
  });
});
