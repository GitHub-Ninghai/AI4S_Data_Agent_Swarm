import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { KanbanBoard } from "../KanbanBoard";
import type { Task, Agent } from "../../types";

// ---------------------------------------------------------------------------
// Mock AppContext
// ---------------------------------------------------------------------------

const mockAgents = new Map<string, Agent>();
let mockTasks = new Map<string, Task>();
let mockActiveProjectId: string | null = null;

vi.mock("../../store/AppContext", () => ({
  useAppState: () => ({
    tasks: mockTasks,
    agents: mockAgents,
    activeProjectId: mockActiveProjectId,
    loading: false,
    wsConnected: true,
  }),
  useAppDispatch: () => (_action: unknown) => {},
}));

vi.mock("../../api/client", () => ({
  startTask: vi.fn().mockResolvedValue({ task: { status: "Running" } }),
  stopTask: vi.fn().mockResolvedValue({ ok: true }),
  doneTask: vi.fn().mockResolvedValue({ ok: true }),
  deleteTask: vi.fn().mockResolvedValue({ ok: true }),
  retryTask: vi.fn().mockResolvedValue({ task: { id: "new" } }),
  getAgents: vi.fn(),
  getTasks: vi.fn(),
  getProjects: vi.fn(),
}));

vi.mock("../ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Math.random().toString(36).slice(2, 8)}`,
    title: `Task ${overrides.id ?? "x"}`,
    description: "Test task description text",
    status: "Todo",
    agentId: "agent-1",
    projectId: "proj-1",
    priority: 1,
    tags: [],
    eventCount: 0,
    turnCount: 0,
    budgetUsed: 0,
    maxTurns: 200,
    maxBudgetUsd: 5.0,
    createdAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("KanbanBoard", () => {
  beforeEach(() => {
    mockTasks = new Map();
    mockActiveProjectId = null;
    mockAgents.clear();
    mockAgents.set("agent-1", {
      id: "agent-1",
      name: "Test Agent",
      avatar: "🤖",
      role: "Tester",
      prompt: "Test prompt for unit testing purposes",
      isEnabled: true,
      status: "idle",
      taskCount: 0,
      stats: { totalTasksCompleted: 0, totalTasksCancelled: 0, totalCostUsd: 0, avgDurationMs: 0 },
      lastEventAt: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  it("renders tasks in correct status columns", () => {
    const t1 = makeTask({ id: "t1", status: "Todo", title: "Todo Task 1" });
    const t2 = makeTask({ id: "t2", status: "Todo", title: "Todo Task 2" });
    const t3 = makeTask({ id: "t3", status: "Running", title: "Running Task" });
    const t4 = makeTask({ id: "t4", status: "Done", title: "Done Task" });

    mockTasks.set("t1", t1);
    mockTasks.set("t2", t2);
    mockTasks.set("t3", t3);
    mockTasks.set("t4", t4);

    render(<KanbanBoard />);

    expect(screen.getByText("Todo Task 1")).toBeInTheDocument();
    expect(screen.getByText("Todo Task 2")).toBeInTheDocument();
    expect(screen.getByText("Running Task")).toBeInTheDocument();
    expect(screen.getByText("Done Task")).toBeInTheDocument();
  });

  it("filters tasks by activeProjectId", () => {
    const t1 = makeTask({ id: "t1", projectId: "p1", title: "Project 1 Task" });
    const t2 = makeTask({ id: "t2", projectId: "p2", title: "Project 2 Task" });

    mockTasks.set("t1", t1);
    mockTasks.set("t2", t2);
    mockActiveProjectId = "p1";

    render(<KanbanBoard />);

    expect(screen.getByText("Project 1 Task")).toBeInTheDocument();
    expect(screen.queryByText("Project 2 Task")).not.toBeInTheDocument();
  });

  it("shows empty state for columns with no tasks", () => {
    render(<KanbanBoard />);

    expect(screen.getAllByText("暂无任务").length).toBeGreaterThan(0);
  });

  it("groups Cancelled tasks into Done column", () => {
    const t1 = makeTask({ id: "t1", status: "Cancelled", title: "Cancelled Task" });
    mockTasks.set("t1", t1);

    render(<KanbanBoard />);

    expect(screen.getByText("Cancelled Task")).toBeInTheDocument();
    // Done column should show count 1
    const doneCounts = screen.getAllByText("1");
    expect(doneCounts.length).toBeGreaterThan(0);
  });

  it("sorts tasks by priority descending", () => {
    const t1 = makeTask({ id: "t1", status: "Todo", priority: 0, title: "Low Priority" });
    const t2 = makeTask({ id: "t2", status: "Todo", priority: 2, title: "High Priority" });

    mockTasks.set("t1", t1);
    mockTasks.set("t2", t2);

    const { container } = render(<KanbanBoard />);

    const cards = container.querySelectorAll(".task-card");
    expect(cards.length).toBe(2);
    // High priority should appear first
    expect(cards[0].textContent).toContain("High Priority");
    expect(cards[1].textContent).toContain("Low Priority");
  });
});
