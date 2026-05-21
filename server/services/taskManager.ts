import * as taskStore from "../store/taskStore.js";
import * as agentStore from "../store/agentStore.js";
import * as projectStore from "../store/projectStore.js";
import { sdkSessionManager } from "./sdkSessionManager.js";
import { broadcast } from "./wsBroadcaster.js";
import type { Task } from "../store/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_TASKS = parseInt(
  process.env.MAX_CONCURRENT_TASKS || "10",
  10,
);

// ---------------------------------------------------------------------------
// Path validation helpers
// ---------------------------------------------------------------------------

/**
 * Check if a path looks like a Windows path (e.g., C:\, D:\, E:\)
 */
function isWindowsPath(p: string): boolean {
  // Windows absolute paths: C:\, D:\, etc. or UNC paths: \server\share
  return /^[A-Za-z]:[/\\]/.test(p) || /^\\\\/.test(p);
}

/**
 * Check if a path exists on the current filesystem
 */
function pathExists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate project path for the current platform.
 * Returns a valid path or throws an error.
 */
function validateProjectPath(projectPath: string): string {
  // Check if path exists directly
  if (pathExists(projectPath)) {
    return projectPath;
  }

  // Check if it's a Windows path on Mac/Linux
  if (isWindowsPath(projectPath)) {
    throw new TaskManagerError(
      400,
      "INVALID_PATH_PLATFORM",
      `项目路径「${projectPath}」是 Windows 路径格式，在当前系统（${process.platform}）上不存在。请更新 Project 设置使用有效的本地路径。`,
    );
  }

  // Path doesn't exist and isn't a Windows path - general error
  throw new TaskManagerError(
    400,
    "INVALID_PATH",
    `项目路径「${projectPath}」不存在。请检查 Project 设置或创建该目录。`,
  );
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------

export class TaskManagerError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "TaskManagerError";
  }
}

// ---------------------------------------------------------------------------
// TaskManager — orchestrates task lifecycle state transitions
// ---------------------------------------------------------------------------

class TaskManager {
  // -----------------------------------------------------------------------
  // startTask — transition Todo → Running
  // -----------------------------------------------------------------------

  async startTask(taskId: string): Promise<void> {
    const task = taskStore.getTaskById(taskId);
    if (!task) {
      throw new TaskManagerError(404, "TASK_NOT_FOUND", `Task ${taskId} not found`);
    }

    if (task.status !== "Todo") {
      throw new TaskManagerError(
        409,
        "TASK_NOT_TODO",
        `Task status is ${task.status}, expected Todo`,
      );
    }

    // Validate Agent
    const agent = agentStore.getAgentById(task.agentId);
    if (!agent) {
      throw new TaskManagerError(
        404,
        "AGENT_NOT_FOUND",
        `Agent ${task.agentId} not found`,
      );
    }

    if (!agent.isEnabled) {
      throw new TaskManagerError(
        409,
        "AGENT_DISABLED",
        `Agent ${agent.name} is disabled`,
      );
    }

    if (agent.status !== "idle") {
      throw new TaskManagerError(
        409,
        "AGENT_BUSY",
        `Agent ${agent.name} is ${agent.status}, expected idle`,
      );
    }

    // Agent single-task constraint
    const activeTask = taskStore.getActiveTaskForAgent(agent.id);
    if (activeTask) {
      throw new TaskManagerError(
        409,
        "AGENT_BUSY",
        `Agent ${agent.name} 当前正在执行任务「${activeTask.title}」`,
      );
    }

    // System-wide concurrent limit
    const activeCount = sdkSessionManager.getActiveTaskCount();
    if (activeCount >= MAX_CONCURRENT_TASKS) {
      throw new TaskManagerError(
        409,
        "RESOURCE_HAS_DEPENDENTS",
        `已达到并发上限（${activeCount}/${MAX_CONCURRENT_TASKS}）`,
      );
    }

    // Validate Project
    const project = projectStore.getProjectById(task.projectId);
    if (!project) {
      throw new TaskManagerError(
        404,
        "PROJECT_NOT_FOUND",
        `Project ${task.projectId} not found`,
      );
    }

    // Validate project path exists and is accessible on current platform
    const validatedPath = validateProjectPath(project.path);

    // --- All checks passed: perform state transitions ---

    taskStore.updateTask(taskId, {
      status: "Running",
      startedAt: Date.now(),
    });

    agentStore.updateAgent(agent.id, {
      status: "working",
      currentTaskId: taskId,
    });

    broadcast("task:update", {
      id: taskId,
      status: "Running",
      startedAt: Date.now(),
    });

    broadcast("agent:update", {
      id: agent.id,
      status: "working",
      currentTaskId: taskId,
    });

    // Start SDK session (consumes stream in background)
    try {
      await sdkSessionManager.startTask(task, agent, validatedPath);
    } catch (err) {
      // Rollback on failure
      taskStore.updateTask(taskId, {
        status: "Todo",
        startedAt: undefined,
      });
      agentStore.updateAgent(agent.id, {
        status: "idle",
        currentTaskId: undefined,
      });
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // completeTask — transition Running/Stuck → Done (SDK or external call)
  // -----------------------------------------------------------------------

  completeTask(
    taskId: string,
    reason: Task["completedReason"],
    output?: string,
  ): void {
    const task = taskStore.getTaskById(taskId);
    if (!task) return;
    if (task.status !== "Running" && task.status !== "Stuck") return;

    const now = Date.now();

    taskStore.updateTask(taskId, {
      status: "Done",
      completedReason: reason,
      output: output ? output.slice(0, 10000) : undefined,
      completedAt: now,
    });

    this.updateAgentAfterCompletion(task, now);

    sdkSessionManager.stopTask(taskId);

    broadcast("task:update", {
      id: taskId,
      status: "Done",
      completedReason: reason,
      output: output ? output.slice(0, 10000) : undefined,
      completedAt: now,
    });
  }

  // -----------------------------------------------------------------------
  // cancelTask — user cancels a running/stuck task
  // -----------------------------------------------------------------------

  cancelTask(taskId: string): void {
    const task = taskStore.getTaskById(taskId);
    if (!task) {
      throw new TaskManagerError(404, "TASK_NOT_FOUND", `Task ${taskId} not found`);
    }

    if (task.status !== "Running" && task.status !== "Stuck") {
      throw new TaskManagerError(
        409,
        "TASK_NOT_ACTIVE",
        `Task status is ${task.status}, can only cancel Running/Stuck tasks`,
      );
    }

    const now = Date.now();

    // Stop SDK session first
    sdkSessionManager.stopTask(taskId);

    // Update task state
    taskStore.updateTask(taskId, {
      status: "Cancelled",
      completedReason: "user_cancelled",
      completedAt: now,
    });

    // Update agent stats + status
    if (task.agentId) {
      const agent = agentStore.getAgentById(task.agentId);
      if (agent) {
        agentStore.updateAgent(task.agentId, {
          stats: {
            ...agent.stats,
            totalTasksCancelled: agent.stats.totalTasksCancelled + 1,
          },
        });
      }
      this.updateAgentStatus(task.agentId);
    }

    broadcast("task:update", {
      id: taskId,
      status: "Cancelled",
      completedReason: "user_cancelled",
      completedAt: now,
    });
  }

  // -----------------------------------------------------------------------
  // stuckTask — mark a Running task as Stuck (needs user intervention)
  // -----------------------------------------------------------------------

  stuckTask(taskId: string, reason?: string): void {
    const task = taskStore.getTaskById(taskId);
    if (!task) return;
    if (task.status !== "Running") return;

    taskStore.updateTask(taskId, {
      status: "Stuck",
      stuckReason: reason,
    });

    // Update agent status
    if (task.agentId) {
      agentStore.updateAgent(task.agentId, { status: "stuck" });

      broadcast("agent:update", {
        id: task.agentId,
        status: "stuck",
      });
    }

    broadcast("task:update", {
      id: taskId,
      status: "Stuck",
      stuckReason: reason,
    });
  }

  // -----------------------------------------------------------------------
  // doneTask — user manually marks task as done
  // -----------------------------------------------------------------------

  doneTask(taskId: string): void {
    const task = taskStore.getTaskById(taskId);
    if (!task) {
      throw new TaskManagerError(404, "TASK_NOT_FOUND", `Task ${taskId} not found`);
    }

    if (task.status !== "Running" && task.status !== "Stuck") {
      throw new TaskManagerError(
        409,
        "TASK_NOT_ACTIVE",
        `Task status is ${task.status}, can only mark Running/Stuck tasks as done`,
      );
    }

    const now = Date.now();

    // Stop SDK session
    sdkSessionManager.stopTask(taskId);

    // Update task state
    taskStore.updateTask(taskId, {
      status: "Done",
      completedReason: "user_done",
      completedAt: now,
    });

    // Update agent stats + status
    this.updateAgentAfterCompletion(task, now);

    broadcast("task:update", {
      id: taskId,
      status: "Done",
      completedReason: "user_done",
      completedAt: now,
    });
  }

  // -----------------------------------------------------------------------
  // Private: updateAgentAfterCompletion
  // -----------------------------------------------------------------------

  private updateAgentAfterCompletion(task: Task, now: number): void {
    if (!task.agentId) return;

    const agent = agentStore.getAgentById(task.agentId);
    if (!agent) return;

    const duration = task.startedAt ? now - task.startedAt : 0;
    const newCompleted = agent.stats.totalTasksCompleted + 1;
    const newTotalCost = agent.stats.totalCostUsd + (task.budgetUsed || 0);
    const totalDurations =
      agent.stats.avgDurationMs * agent.stats.totalTasksCompleted + duration;
    const newAvgDuration = newCompleted > 0 ? totalDurations / newCompleted : 0;

    // Check if agent has other running/stuck tasks
    const hasRunningTasks = taskStore
      .getAllTasks()
      .some(
        (t) =>
          t.agentId === task.agentId &&
          t.id !== task.id &&
          (t.status === "Running" || t.status === "Stuck"),
      );

    agentStore.updateAgent(task.agentId, {
      status: hasRunningTasks ? agent.status : "idle",
      currentTaskId: undefined,
      stats: {
        totalTasksCompleted: newCompleted,
        totalTasksCancelled: agent.stats.totalTasksCancelled,
        totalCostUsd: newTotalCost,
        avgDurationMs: newAvgDuration,
      },
    });

    broadcast("agent:update", {
      id: task.agentId,
      status: hasRunningTasks ? agent.status : "idle",
      currentTaskId: undefined,
    });
  }

  // -----------------------------------------------------------------------
  // Private: updateAgentStatus — set idle if no more active tasks
  // -----------------------------------------------------------------------

  private updateAgentStatus(agentId: string): void {
    const agent = agentStore.getAgentById(agentId);
    if (!agent) return;

    const hasRunningTasks = taskStore
      .getAllTasks()
      .some(
        (t) =>
          t.agentId === agentId &&
          (t.status === "Running" || t.status === "Stuck"),
      );

    if (!hasRunningTasks) {
      agentStore.updateAgent(agentId, {
        status: "idle",
        currentTaskId: undefined,
      });

      broadcast("agent:update", {
        id: agentId,
        status: "idle",
        currentTaskId: undefined,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const taskManager = new TaskManager();
