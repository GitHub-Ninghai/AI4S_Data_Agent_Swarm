import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { rotateIfNeeded, FileLogger } from "./logRotator.js";

describe("logRotator", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "log-rotate-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── rotateIfNeeded ─────────────────────────────────────────────────────

  describe("rotateIfNeeded", () => {
    it("returns false when file does not exist", () => {
      const filePath = path.join(tmpDir, "nonexistent.log");
      expect(rotateIfNeeded(filePath)).toBe(false);
    });

    it("returns false when file is under size limit", () => {
      const filePath = path.join(tmpDir, "small.log");
      fs.writeFileSync(filePath, "small content");
      expect(rotateIfNeeded(filePath, { maxBytes: 1024 })).toBe(false);
      // File should be unchanged
      expect(fs.readFileSync(filePath, "utf-8")).toBe("small content");
    });

    it("rotates file when over size limit", () => {
      const filePath = path.join(tmpDir, "big.log");
      const content = "X".repeat(200);
      fs.writeFileSync(filePath, content);

      const result = rotateIfNeeded(filePath, { maxBytes: 100 });
      expect(result).toBe(true);

      // Original file should be gone (renamed)
      expect(fs.existsSync(filePath)).toBe(false);
      // Rotated file should exist
      expect(fs.existsSync(`${filePath}.1`)).toBe(true);
      expect(fs.readFileSync(`${filePath}.1`, "utf-8")).toBe(content);
    });

    it("shifts existing rotated files", () => {
      const filePath = path.join(tmpDir, "app.log");

      // Create rotated files .1 and .2
      fs.writeFileSync(`${filePath}.1`, "rotated-1");
      fs.writeFileSync(`${filePath}.2`, "rotated-2");

      // Create current file over limit
      fs.writeFileSync(filePath, "X".repeat(200));

      rotateIfNeeded(filePath, { maxBytes: 100, maxFiles: 5 });

      // .2 → .3, .1 → .2, current → .1
      expect(fs.readFileSync(`${filePath}.1`, "utf-8")).toBe("X".repeat(200));
      expect(fs.readFileSync(`${filePath}.2`, "utf-8")).toBe("rotated-1");
      expect(fs.readFileSync(`${filePath}.3`, "utf-8")).toBe("rotated-2");
    });

    it("deletes files beyond maxFiles", () => {
      const filePath = path.join(tmpDir, "app.log");

      // Create 5 rotated files
      for (let i = 1; i <= 5; i++) {
        fs.writeFileSync(`${filePath}.${i}`, `rotated-${i}`);
      }

      // Current file over limit
      fs.writeFileSync(filePath, "X".repeat(200));

      rotateIfNeeded(filePath, { maxBytes: 100, maxFiles: 3 });

      // .5 should be deleted (maxFiles=3, only keep .1 .2 .3)
      expect(fs.existsSync(`${filePath}.5`)).toBe(false);
      expect(fs.existsSync(`${filePath}.4`)).toBe(false);
      // .3 (was .2) should still exist
      expect(fs.existsSync(`${filePath}.3`)).toBe(true);
    });

    it("handles maxFiles=1 correctly", () => {
      const filePath = path.join(tmpDir, "app.log");
      fs.writeFileSync(`${filePath}.1`, "old-rotated");
      fs.writeFileSync(filePath, "X".repeat(200));

      rotateIfNeeded(filePath, { maxBytes: 100, maxFiles: 1 });

      // Only .1 should exist, no .2
      expect(fs.existsSync(`${filePath}.1`)).toBe(true);
      expect(fs.existsSync(`${filePath}.2`)).toBe(false);
    });
  });

  // ── FileLogger ─────────────────────────────────────────────────────────

  describe("FileLogger", () => {
    it("creates log directory if not exists", () => {
      const logDir = path.join(tmpDir, "sub", "dir");
      const filePath = path.join(logDir, "test.log");
      const logger = new FileLogger(filePath);

      logger.info("test message");

      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("[INFO] test message");
    });

    it("appends multiple log lines", () => {
      const filePath = path.join(tmpDir, "test.log");
      const logger = new FileLogger(filePath);

      logger.info("first");
      logger.warn("second");
      logger.error("third");

      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain("[INFO] first");
      expect(lines[1]).toContain("[WARN] second");
      expect(lines[2]).toContain("[ERROR] third");
    });

    it("rotates on write when file exceeds limit", () => {
      const filePath = path.join(tmpDir, "test.log");
      // Small limit for testing
      const logger = new FileLogger(filePath, { maxBytes: 100, maxFiles: 3 });

      // Write enough to exceed limit
      for (let i = 0; i < 20; i++) {
        logger.info(`Line ${i}: ${"A".repeat(20)}`);
      }

      // Should have rotated
      expect(fs.existsSync(`${filePath}.1`)).toBe(true);
      // Current file should exist and be smaller than limit
      expect(fs.existsSync(filePath)).toBe(true);
      const currentSize = fs.statSync(filePath).size;
      expect(currentSize).toBeLessThan(200); // Some new lines, but not all
    });

    it("rotates existing files on construction", () => {
      const filePath = path.join(tmpDir, "test.log");
      // Create a large existing file
      fs.writeFileSync(filePath, "X".repeat(200));

      // Constructor should rotate
      new FileLogger(filePath, { maxBytes: 100 });

      expect(fs.existsSync(`${filePath}.1`)).toBe(true);
      expect(fs.existsSync(filePath)).toBe(false); // renamed away
    });
  });
});
