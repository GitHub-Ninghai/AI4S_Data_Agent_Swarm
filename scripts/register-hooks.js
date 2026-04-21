#!/usr/bin/env node

/**
 * register-hooks.js — 注册 Claude Code Hooks 到 settings.json
 *
 * 功能：
 *   1. 读取 Claude Code 的 settings.json
 *   2. 注册 Stop/SessionStart/SessionEnd/Notification 事件 Hook
 *   3. 幂等：已注册则跳过
 *   4. 跨平台兼容（Windows/macOS/Linux）
 *
 * 用法：node scripts/register-hooks.js [--unregister]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

// ─── 配置 ────────────────────────────────────────────────────────────────────

const HOOK_EVENTS = ["Stop", "SessionStart", "SessionEnd", "Notification"];
const HOOK_COMMAND = "bash ./hooks/eventHook.sh";

// ─── 获取 Claude Code 配置目录 ──────────────────────────────────────────────

function getClaudeConfigDir() {
  // 优先尝试 claude --config-dir（需要 claude CLI 已安装）
  try {
    const dir = execSync("claude --config-dir 2>/dev/null", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    if (dir) return dir;
  } catch {
    // claude CLI 不可用，使用默认路径
  }

  // 默认路径
  const platform = process.platform;
  if (platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "claude");
  }
  // macOS / Linux
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfig, "claude");
}

// ─── 读取 settings.json ─────────────────────────────────────────────────────

function loadSettings(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    console.warn(`[WARN] ${filePath} 格式错误，将覆盖。`);
    return {};
  }
}

// ─── 注册 Hooks ──────────────────────────────────────────────────────────────

function registerHooks(settings) {
  if (!settings.hooks || typeof settings.hooks !== "object") {
    settings.hooks = {};
  }

  let registered = 0;
  let skipped = 0;

  for (const eventName of HOOK_EVENTS) {
    if (!Array.isArray(settings.hooks[eventName])) {
      settings.hooks[eventName] = [];
    }

    const alreadyRegistered = settings.hooks[eventName].some(
      (hook) => hook.command === HOOK_COMMAND
    );

    if (alreadyRegistered) {
      skipped++;
    } else {
      settings.hooks[eventName].push({ command: HOOK_COMMAND });
      registered++;
    }
  }

  return { registered, skipped };
}

// ─── 注销 Hooks ──────────────────────────────────────────────────────────────

function unregisterHooks(settings) {
  if (!settings.hooks || typeof settings.hooks !== "object") {
    return { removed: 0 };
  }

  let removed = 0;

  for (const eventName of HOOK_EVENTS) {
    if (!Array.isArray(settings.hooks[eventName])) continue;
    const before = settings.hooks[eventName].length;
    settings.hooks[eventName] = settings.hooks[eventName].filter(
      (hook) => hook.command !== HOOK_COMMAND
    );
    removed += before - settings.hooks[eventName].length;
    // 清理空数组
    if (settings.hooks[eventName].length === 0) {
      delete settings.hooks[eventName];
    }
  }

  // 清理空的 hooks 对象
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  return { removed };
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

function main() {
  const isUnregister = process.argv.includes("--unregister");
  const configDir = getClaudeConfigDir();
  const settingsPath = join(configDir, "settings.json");

  console.log(`Claude Code 配置目录: ${configDir}`);
  console.log(`Settings 文件路径: ${settingsPath}`);

  // 确保目录存在
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
    console.log(`[INFO] 已创建配置目录: ${configDir}`);
  }

  const settings = loadSettings(settingsPath);

  if (isUnregister) {
    const { removed } = unregisterHooks(settings);
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
    console.log(`[OK] 已注销 ${removed} 个 Hook。`);
  } else {
    const { registered, skipped } = registerHooks(settings);
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");

    if (registered > 0) {
      console.log(`[OK] 已注册 ${registered} 个 Hook (${skipped} 个已存在跳过)。`);
    } else {
      console.log(`[OK] 所有 ${skipped} 个 Hook 均已注册，无需操作。`);
    }
  }

  console.log("\n已注册的 Hook 事件:");
  const finalSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  if (finalSettings.hooks) {
    for (const [event, hooks] of Object.entries(finalSettings.hooks)) {
      const commands = hooks.map((h) => `  → ${h.command}`).join("\n");
      console.log(`  ${event}:\n${commands}`);
    }
  }
}

main();
