/**
 * logRotator.ts — 日志轮转工具
 *
 * 功能：
 *   - 检查日志文件大小，超过阈值时自动轮转
 *   - 保留最多 maxFiles 个轮转文件，删除更早的
 *   - 线程安全：同一文件路径多次调用不会冲突
 */

import fs from "node:fs";
import path from "node:path";

export interface LogRotateOptions {
  /** 单文件最大字节数（默认 50MB） */
  maxBytes?: number;
  /** 最多保留的轮转文件数（默认 5） */
  maxFiles?: number;
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 50MB
const DEFAULT_MAX_FILES = 5;

/**
 * 对指定日志文件执行轮转检查。
 *
 * 轮转策略：
 *   server.log → server.log.1 → server.log.2 → ... → server.log.5
 *   - 超过 maxFiles 的旧文件被删除
 *   - 当前文件超过 maxBytes 时重命名为 .1，后续依次移位
 *   - 当前文件重命名后创建新的空文件（或由下次写入自动创建）
 *
 * @returns true 表示执行了轮转，false 表示无需轮转
 */
export function rotateIfNeeded(
  filePath: string,
  options: LogRotateOptions = {},
): boolean {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;

  // 文件不存在或为空，跳过
  if (!fs.existsSync(filePath)) return false;

  const stat = fs.statSync(filePath);
  if (stat.size < maxBytes) return false;

  // 先清理编号超过 maxFiles 的旧轮转文件
  for (let i = maxFiles + 1; ; i++) {
    const oldPath = `${filePath}.${i}`;
    if (fs.existsSync(oldPath)) {
      fs.unlinkSync(oldPath);
    } else {
      break;
    }
  }

  // 执行轮转：从 maxFiles 位置开始移位
  for (let i = maxFiles; i >= 1; i--) {
    const rotatedPath = `${filePath}.${i}`;
    if (i === maxFiles) {
      // 删除最旧的轮转文件
      if (fs.existsSync(rotatedPath)) {
        fs.unlinkSync(rotatedPath);
      }
    } else {
      // 移位：.N → .N+1
      if (fs.existsSync(rotatedPath)) {
        const nextPath = `${filePath}.${i + 1}`;
        fs.renameSync(rotatedPath, nextPath);
      }
    }
  }

  // 当前文件 → .1
  fs.renameSync(filePath, `${filePath}.1`);

  return true;
}

// ---------------------------------------------------------------------------
// Simple file logger with auto-rotation
// ---------------------------------------------------------------------------

export class FileLogger {
  private readonly filePath: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private writeStream: fs.WriteStream | null = null;

  constructor(filePath: string, options: LogRotateOptions = {}) {
    this.filePath = filePath;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;

    // 确保目录存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 启动时检查轮转
    rotateIfNeeded(this.filePath, {
      maxBytes: this.maxBytes,
      maxFiles: this.maxFiles,
    });
  }

  /**
   * 写入一行日志（同步追加，写入前检查轮转）
   */
  write(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level}] ${message}\n`;

    // 写入前检查轮转
    rotateIfNeeded(this.filePath, {
      maxBytes: this.maxBytes,
      maxFiles: this.maxFiles,
    });

    fs.appendFileSync(this.filePath, line, "utf-8");
  }

  info(message: string): void {
    this.write("INFO", message);
  }

  warn(message: string): void {
    this.write("WARN", message);
  }

  error(message: string): void {
    this.write("ERROR", message);
  }
}

// ---------------------------------------------------------------------------
// Singleton server logger
// ---------------------------------------------------------------------------

const DATA_DIR = path.resolve(process.cwd(), "data", "logs");

let _serverLogger: FileLogger | null = null;

export function getServerLogger(): FileLogger {
  if (!_serverLogger) {
    _serverLogger = new FileLogger(path.join(DATA_DIR, "server.log"));
  }
  return _serverLogger;
}

/**
 * 同时输出到 console 和文件的日志函数
 */
export function log(level: "info" | "warn" | "error", message: string): void {
  const timestamp = new Date().toISOString();
  const formatted = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

  // 输出到 console
  if (level === "error") {
    console.error(formatted);
  } else if (level === "warn") {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }

  // 输出到文件
  try {
    getServerLogger().write(level.toUpperCase(), message);
  } catch {
    // 文件写入失败不影响主流程
  }
}

/**
 * 轮转 hooks.log
 */
export function rotateHooksLog(
  hooksLogPath?: string,
): boolean {
  const filePath = hooksLogPath ?? path.join(DATA_DIR, "hooks.log");
  return rotateIfNeeded(filePath);
}
