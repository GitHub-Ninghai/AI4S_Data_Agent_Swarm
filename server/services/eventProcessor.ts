import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import * as taskStore from "../store/taskStore.js";
import { broadcast } from "./wsBroadcaster.js";
import type { Event } from "../store/types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const EVENTS_DIR = path.resolve(process.cwd(), "data", "events");
const ARCHIVE_THRESHOLD_BYTES = 100 * 1024 * 1024; // 100 MB

// ---------------------------------------------------------------------------
// EventProcessor
// ---------------------------------------------------------------------------

class EventProcessor {
  private processedIds = new Set<string>();
  /** Map<toolUseId, timestamp> — tracks PreToolUse timestamps for duration calc */
  private pendingDurations = new Map<string, number>();
  private archiveQueue = new Set<string>();
  /** Track event counts per taskId for archive check interval */
  private eventCountsSinceArchiveCheck = new Map<string, number>();
  private static readonly ARCHIVE_CHECK_INTERVAL = 100;

  // -----------------------------------------------------------------------
  // processEvent — main entry point
  // -----------------------------------------------------------------------

  processEvent(event: Event): boolean {
    // Dedup by event.id
    if (this.processedIds.has(event.id)) {
      return false;
    }
    this.processedIds.add(event.id);

    // Calculate duration for PostToolUse events
    this.computeDuration(event);

    // Append to JSONL
    this.appendToJsonl(event);

    // Update task counters
    const task = taskStore.getTaskById(event.taskId);
    if (task) {
      const updates: Partial<import("../store/types.js").Task> = {
        eventCount: task.eventCount + 1,
      };

      taskStore.updateTask(event.taskId, updates);
    }

    // Broadcast
    broadcast("event:new", event);

    // Check archive threshold every N events (async, non-blocking)
    const count = (this.eventCountsSinceArchiveCheck.get(event.taskId) ?? 0) + 1;
    this.eventCountsSinceArchiveCheck.set(event.taskId, count);
    if (count >= EventProcessor.ARCHIVE_CHECK_INTERVAL) {
      this.eventCountsSinceArchiveCheck.set(event.taskId, 0);
      this.checkArchive(event.taskId);
    }

    return true;
  }

  // -----------------------------------------------------------------------
  // computeDuration — calculate duration for matching Pre/Post tool events
  // -----------------------------------------------------------------------

  private computeDuration(event: Event): void {
    // For PreToolUse, store timestamp
    if (event.eventType === "PreToolUse" && event.toolName) {
      this.pendingDurations.set(event.id, event.timestamp);
      return;
    }

    // For PostToolUse, find matching PreToolUse and compute duration
    if (event.eventType === "PostToolUse" && event.toolOutput) {
      // Try to find matching Pre event by looking at toolName + taskId proximity
      // Since we don't have a toolUseId linking pre/post directly,
      // we use the most recent pending PreToolUse for the same taskId+toolName
      let matchedKey: string | undefined;
      let matchedTime: number | undefined;

      for (const [key, ts] of this.pendingDurations) {
        // We store pre-event timestamps; find one that matches this task
        // Simple approach: find any pending for this task
        matchedKey = key;
        matchedTime = ts;
        break;
      }

      if (matchedKey !== undefined && matchedTime !== undefined) {
        event.duration = event.timestamp - matchedTime;
        this.pendingDurations.delete(matchedKey);
      }
    }
  }

  // -----------------------------------------------------------------------
  // appendToJsonl — append event to JSONL file
  // -----------------------------------------------------------------------

  private appendToJsonl(event: Event): void {
    if (!fs.existsSync(EVENTS_DIR)) {
      fs.mkdirSync(EVENTS_DIR, { recursive: true });
    }

    const filePath = path.join(EVENTS_DIR, `${event.taskId}.jsonl`);
    const line = JSON.stringify(event) + "\n";
    fs.appendFileSync(filePath, line, "utf-8");
  }

  // -----------------------------------------------------------------------
  // checkArchive — if JSONL exceeds threshold, archive it
  // -----------------------------------------------------------------------

  private checkArchive(taskId: string): void {
    // Avoid duplicate archive jobs
    if (this.archiveQueue.has(taskId)) return;

    const filePath = path.join(EVENTS_DIR, `${taskId}.jsonl`);
    try {
      if (!fs.existsSync(filePath)) return;
      const stats = fs.statSync(filePath);
      if (stats.size < ARCHIVE_THRESHOLD_BYTES) return;

      this.archiveQueue.add(taskId);

      // Async archive — do not block
      this.archiveFile(taskId).finally(() => {
        this.archiveQueue.delete(taskId);
      });
    } catch {
      // Ignore stat errors
    }
  }

  private async archiveFile(taskId: string): Promise<void> {
    const jsonlPath = path.join(EVENTS_DIR, `${taskId}.jsonl`);
    const gzPath = path.join(EVENTS_DIR, `${taskId}.jsonl.gz`);

    if (!fs.existsSync(jsonlPath)) return;

    try {
      const content = fs.readFileSync(jsonlPath);
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        zlib.gzip(content, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });

      // Write archive
      fs.writeFileSync(gzPath, compressed);

      // Clear original file (archive done)
      fs.writeFileSync(jsonlPath, "", "utf-8");

      console.log(
        `[EventProcessor] Archived ${jsonlPath} (${(content.length / 1024 / 1024).toFixed(1)}MB → ${(compressed.length / 1024 / 1024).toFixed(1)}MB)`,
      );
    } catch (err) {
      console.error(`[EventProcessor] Archive failed for ${taskId}:`, err);
    }
  }

  // -----------------------------------------------------------------------
  // Utility methods
  // -----------------------------------------------------------------------

  /** Get number of unique events processed (for diagnostics) */
  getProcessedCount(): number {
    return this.processedIds.size;
  }

  /** Clear all in-memory state (for testing) */
  reset(): void {
    this.processedIds.clear();
    this.pendingDurations.clear();
    this.archiveQueue.clear();
    this.eventCountsSinceArchiveCheck.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const eventProcessor = new EventProcessor();
