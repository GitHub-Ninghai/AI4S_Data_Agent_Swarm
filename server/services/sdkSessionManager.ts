import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Task, Agent, Event } from "../store/types.js";
import * as taskStore from "../store/taskStore.js";
import * as agentStore from "../store/agentStore.js";
import * as sessionStore from "../store/sessionStore.js";
import { broadcast } from "../services/wsBroadcaster.js";
import { eventProcessor } from "./eventProcessor.js";
import {
  startQuery,
  resumeQuery,
  cleanupQuery,
} from "../sdk/queryWrapper.js";
import {
  parseMessage,
  extractSessionId,
  extractCostInfo,
} from "../sdk/messageParser.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActiveQuery {
  stream: Query;
  abortController: AbortController;
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// SDKSessionManager
// ---------------------------------------------------------------------------

class SDKSessionManager {
  private activeQueries = new Map<string, ActiveQuery>();
  private sessionReverseMap = new Map<string, string>();

  // -----------------------------------------------------------------------
  // startTask — launch a new SDK query for a task
  // -----------------------------------------------------------------------

  async startTask(task: Task, agent: Agent, projectDir: string): Promise<void> {
    const { stream, abortController } = await startQuery(task, agent, projectDir);

    const entry: ActiveQuery = { stream, abortController };
    this.activeQueries.set(task.id, entry);

    // Store AbortController in sessionStore for runtime access
    const existingSession = sessionStore.getSessionByTaskId(task.id);
    if (existingSession) {
      sessionStore.setAbortController(existingSession.id, abortController);
    }

    // Start consuming the stream in the background (do not await)
    this.consumeStream(task.id, stream).catch((err) => {
      console.error(`[SDKSessionManager] Stream error for task ${task.id}:`, err);
      this.handleStreamError(task.id, err);
    });
  }

  // -----------------------------------------------------------------------
  // resumeTask — resume a session with a user message
  // -----------------------------------------------------------------------

  async resumeTask(
    sessionId: string,
    message: string,
    task: Task,
    agent: Agent,
    projectDir: string,
  ): Promise<void> {
    const { stream, abortController } = await resumeQuery(
      sessionId,
      message,
      task,
      agent,
      projectDir,
    );

    const entry: ActiveQuery = { stream, abortController, sessionId };
    this.activeQueries.set(task.id, entry);

    // Start consuming
    this.consumeStream(task.id, stream).catch((err) => {
      console.error(`[SDKSessionManager] Resume stream error for task ${task.id}:`, err);
      this.handleStreamError(task.id, err);
    });
  }

  // -----------------------------------------------------------------------
  // stopTask — abort a running task
  // -----------------------------------------------------------------------

  stopTask(taskId: string): void {
    const entry = this.activeQueries.get(taskId);
    if (entry) {
      entry.abortController.abort();
      this.activeQueries.delete(taskId);

      if (entry.sessionId) {
        this.sessionReverseMap.delete(entry.sessionId);
      }
    }

    cleanupQuery(taskId);
  }

  // -----------------------------------------------------------------------
  // bindSession — bind SDK session_id to a task
  // -----------------------------------------------------------------------

  bindSession(taskId: string, sessionId: string): void {
    // Update the active query entry
    const entry = this.activeQueries.get(taskId);
    if (entry) {
      entry.sessionId = sessionId;
    }

    // Update task's sessionId
    taskStore.updateTask(taskId, { sessionId });

    // Update session store
    const session = sessionStore.getSessionByTaskId(taskId);
    if (session) {
      sessionStore.updateSession(session.id, { status: "active" });
    }

    // Build reverse mapping
    this.sessionReverseMap.set(sessionId, taskId);

    // Broadcast
    broadcast("task:update", {
      id: taskId,
      sessionId,
      status: "Running",
    });
  }

  // -----------------------------------------------------------------------
  // consumeStream — process the SDK message stream
  // -----------------------------------------------------------------------

  private async consumeStream(taskId: string, stream: Query): Promise<void> {
    try {
      for await (const message of stream) {
        this.processMessage(taskId, message);
      }
    } catch (err: unknown) {
      // AbortError is expected when stopTask() is called
      if (err && typeof err === "object" && "name" in err && (err as Error).name === "AbortError") {
        return;
      }
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // processMessage — handle a single SDK message
  // -----------------------------------------------------------------------

  private processMessage(taskId: string, message: SDKMessage): void {
    const entry = this.activeQueries.get(taskId);
    const sessionId = entry?.sessionId || "unknown";

    // Check for SDKInit — bind session
    const initSessionId = extractSessionId(message);
    if (initSessionId) {
      this.bindSession(taskId, initSessionId);
    }

    // Parse into events
    const events = parseMessage(taskId, sessionId, message);
    if (events.length === 0) return;

    // Update task counters
    const task = taskStore.getTaskById(taskId);
    if (!task) return;

    const turnCount = task.turnCount + events.filter(
      (e: Event) => e.eventType === "SDKAssistant" && e.toolName,
    ).length;

    // Check for cost info from result messages
    const costInfo = extractCostInfo(message);
    const budgetUsed = costInfo
      ? costInfo.totalCostUsd
      : task.budgetUsed;

    taskStore.updateTask(taskId, {
      turnCount,
      budgetUsed,
      lastEventAt: Date.now(),
    });

    // Persist and broadcast each event through the shared event pipeline.
    for (const event of events) {
      eventProcessor.processEvent(event);
    }

    // Handle result message — task completion
    if (costInfo) {
      this.handleTaskCompletion(taskId, message, costInfo);
    }
  }

  // -----------------------------------------------------------------------
  // handleTaskCompletion — process SDK result message
  // -----------------------------------------------------------------------

  private handleTaskCompletion(
    taskId: string,
    message: SDKMessage,
    costInfo: ReturnType<typeof extractCostInfo>,
  ): void {
    if (!costInfo) return;

    const task = taskStore.getTaskById(taskId);
    if (!task || (task.status !== "Running" && task.status !== "Stuck")) return;

    let completedReason: Task["completedReason"];
    let output: string | undefined;

    switch (costInfo.subtype) {
      case "success":
        completedReason = "sdk_result";
        const resultMsg = message as any;
        output = resultMsg.result || "";
        break;
      case "error_max_turns":
        completedReason = "max_turns";
        break;
      case "error_max_budget_usd":
        completedReason = "max_budget";
        break;
      default:
        completedReason = "error";
        const errorMsg = message as any;
        output = errorMsg.errors?.join("; ") || "Unknown error";
        break;
    }

    // Update task
    taskStore.updateTask(taskId, {
      status: "Done",
      completedReason,
      output: output ? output.slice(0, 10000) : undefined,
      completedAt: Date.now(),
      budgetUsed: costInfo.totalCostUsd,
    });

    // Update agent stats and status
    if (task.agentId) {
      const agent = agentStore.getAgentById(task.agentId);
      if (agent) {
        const newCompleted = agent.stats.totalTasksCompleted + 1;
        const newTotalCost = agent.stats.totalCostUsd + costInfo.totalCostUsd;
        const duration = task.startedAt ? Date.now() - task.startedAt : 0;
        const totalDurations = agent.stats.avgDurationMs * agent.stats.totalTasksCompleted + duration;
        const newAvgDuration = newCompleted > 0 ? totalDurations / newCompleted : 0;

        // Check if agent has other running tasks
        const hasRunningTasks = taskStore
          .getAllTasks()
          .some(
            (t) =>
              t.agentId === task.agentId &&
              t.id !== taskId &&
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
      }
    }

    // Clean up active query
    this.activeQueries.delete(taskId);
    if (costInfo) {
      // sessionReverseMap cleanup handled by the sessionId from entry
    }

    cleanupQuery(taskId);

    // Broadcast
    broadcast("task:update", {
      id: taskId,
      status: "Done",
      completedReason,
      budgetUsed: costInfo.totalCostUsd,
    });
  }

  // -----------------------------------------------------------------------
  // handleStreamError — handle stream consumption errors
  // -----------------------------------------------------------------------

  private handleStreamError(taskId: string, error: unknown): void {
    const task = taskStore.getTaskById(taskId);
    if (!task || (task.status !== "Running" && task.status !== "Stuck")) return;

    const errorMsg = error instanceof Error ? error.message : String(error);

    taskStore.updateTask(taskId, {
      status: "Done",
      completedReason: "error",
      output: `Stream error: ${errorMsg}`,
      completedAt: Date.now(),
    });

    if (task.agentId) {
      agentStore.updateAgent(task.agentId, { status: "idle", currentTaskId: undefined });
    }

    this.activeQueries.delete(taskId);
    cleanupQuery(taskId);

    broadcast("task:update", {
      id: taskId,
      status: "Done",
      completedReason: "error",
      output: errorMsg,
    });
  }

  // -----------------------------------------------------------------------
  // Query methods
  // -----------------------------------------------------------------------

  getByTaskId(taskId: string): ActiveQuery | undefined {
    return this.activeQueries.get(taskId);
  }

  getTaskIdBySession(sessionId: string): string | undefined {
    return this.sessionReverseMap.get(sessionId);
  }

  getActiveTaskCount(): number {
    return this.activeQueries.size;
  }

  hasActiveTask(taskId: string): boolean {
    return this.activeQueries.has(taskId);
  }

  // -----------------------------------------------------------------------
  // Cleanup all
  // -----------------------------------------------------------------------

  stopAll(): void {
    for (const [taskId, entry] of this.activeQueries) {
      entry.abortController.abort();
      cleanupQuery(taskId);
    }
    this.activeQueries.clear();
    this.sessionReverseMap.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const sdkSessionManager = new SDKSessionManager();
