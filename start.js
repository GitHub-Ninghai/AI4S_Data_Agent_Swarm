#!/usr/bin/env node

/**
 * start.js — Cross-platform launcher for Agent Swarm
 *
 * Starts both the backend server (port 3456) and the Vite dev server (port 5173)
 * in parallel. Kills both child processes on SIGINT / SIGTERM.
 *
 * Usage:
 *   node start.js          # development mode (tsx watch + vite dev) — default
 *   node start.js --prod   # production (requires tsc + vite build first)
 */

import { execSync, spawn } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectName = basename(__dirname);
const isWin = platform() === 'win32';
const isDev = !process.argv.includes('--prod');

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(tag, msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] [${tag}] ${msg}`);
}

function findPidsOnPort(port) {
  try {
    if (isWin) {
      const output = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
        encoding: 'utf-8',
        windowsHide: true,
      });
      const pids = new Set();
      for (const line of output.trim().split('\n')) {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (pid > 0) pids.add(pid);
      }
      return [...pids];
    }

    const output = execSync(`lsof -i :${port} -t -sTCP:LISTEN 2>/dev/null`, {
      encoding: 'utf-8',
    });
    return output
      .trim()
      .split('\n')
      .map((value) => parseInt(value, 10))
      .filter((value) => value > 0);
  } catch {
    return [];
  }
}

function getProcessInfo(pid, port) {
  try {
    if (isWin) {
      const output = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
        encoding: 'utf-8',
        windowsHide: true,
      }).trim();
      const [command = ''] = output.replace(/^"|"$/g, '').split('","');
      return { pid, command };
    }

    const output = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN`, {
      encoding: 'utf-8',
    })
      .trim()
      .split('\n')
      .slice(1);
    const line = output.find((entry) => {
      const parts = entry.trim().split(/\s+/);
      return parseInt(parts[1] || '', 10) === pid;
    });

    if (!line) return { pid, command: '' };

    const parts = line.trim().split(/\s+/);
    return { pid, command: parts[0] || '' };
  } catch {
    return { pid, command: '' };
  }
}

function isProjectProcess(command) {
  if (!command) return false;

  return (
    command.includes(projectName) ||
    command.includes('node') ||
    command.includes('bun') ||
    command.includes('vite')
  );
}

function terminatePid(pid) {
  try {
    if (isWin) {
      execSync(`taskkill /F /T /PID ${pid}`, {
        stdio: 'ignore',
        windowsHide: true,
      });
      return;
    }

    process.kill(pid, 'SIGTERM');
  } catch {
    // Process may already be dead
  }
}

function ensurePortAvailable(name, port) {
  const pids = findPidsOnPort(port);
  if (pids.length === 0) return true;

  const processes = pids.map((pid) => getProcessInfo(pid, port));
  const projectPids = processes.filter((proc) => isProjectProcess(proc.command));
  const foreignPids = processes.filter((proc) => !isProjectProcess(proc.command));

  if (projectPids.length > 0) {
    for (const proc of projectPids) {
      log(
        'Launcher',
        `Port ${port} occupied by existing ${name} process (PID ${proc.pid}); stopping it before restart.`
      );
      terminatePid(proc.pid);
    }

    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (findPidsOnPort(port).length === 0) return true;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }

  if (foreignPids.length > 0) {
    for (const proc of foreignPids) {
      const detail = proc.command ? `: ${proc.command}` : '';
      log('Launcher', `Port ${port} is occupied by PID ${proc.pid}${detail}`);
    }
    return false;
  }

  return true;
}

/**
 * Spawn a child process. On Windows, uses cmd.exe to support .cmd scripts
 * like npx.cmd. On Unix, spawns directly.
 */
function addProc(tag, command, args, opts = {}) {
  let proc;
  if (isWin) {
    // Use cmd.exe to resolve .cmd scripts (npx, tsx, vite)
    const fullCmd = [command, ...args].join(' ');
    proc = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', fullCmd], {
      stdio: 'pipe',
      cwd: opts.cwd,
      windowsHide: true,
      env: { ...process.env },
    });
  } else {
    proc = spawn(command, args, {
      stdio: 'pipe',
      cwd: opts.cwd,
      env: { ...process.env },
    });
  }

  proc.stdout?.on('data', (d) => {
    const lines = d.toString().trimEnd().split('\n');
    for (const line of lines) {
      if (line) console.log(`[${tag}] ${line}`);
    }
  });

  proc.stderr?.on('data', (d) => {
    const lines = d.toString().trimEnd().split('\n');
    for (const line of lines) {
      if (line) console.error(`[${tag}] ${line}`);
    }
  });

  proc.on('exit', (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    log(tag, `Process exited (${reason})`);

    if (code && code !== 0) {
      killAll();
      process.exit(code);
    }
  });

  proc.on('error', (err) => {
    log(tag, `Spawn error: ${err.message}`);
  });

  children.push(proc);
  return proc;
}

function killAll() {
  if (children.length === 0) return;
  console.log('\n[Agent Swarm] Shutting down...');

  for (const proc of children) {
    try {
      if (isWin) {
        spawn(
          join(process.env.SystemRoot || 'C:\\Windows', 'system32', 'taskkill.exe'),
          ['/pid', String(proc.pid), '/T', '/F'],
          { stdio: 'ignore', windowsHide: true }
        );
      } else {
        proc.kill('SIGTERM');
      }
    } catch {
      // Process may already be dead
    }
  }
  children.length = 0;
}

// ---------------------------------------------------------------------------
// Signal handlers
// ---------------------------------------------------------------------------

process.on('SIGINT', () => {
  killAll();
  process.exit(0);
});

process.on('SIGTERM', () => {
  killAll();
  process.exit(0);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║        Agent Swarm Launcher          ║');
  console.log(`║       mode: ${isDev ? 'development  ' : 'production   '}            ║`);
  console.log('╚══════════════════════════════════════╝');
  console.log();

  const requiredPorts = [{ name: 'server', port: 3456 }];
  if (isDev) {
    requiredPorts.push({ name: 'web', port: 5173 });
  }

  for (const { name, port } of requiredPorts) {
    const available = ensurePortAvailable(name, port);
    if (!available) {
      throw new Error(
        `Port ${port} is already in use by another application. Free the port or change the service port before restarting.`
      );
    }
  }

  // ---- Backend Server ----
  if (isDev) {
    log('Server', 'Starting with tsx...');
    addProc('Server', 'npx', ['tsx', 'server/index.ts'], {
      cwd: __dirname,
    });
  } else {
    log('Server', 'Starting compiled server...');
    addProc('Server', 'node', [join(__dirname, 'server', 'dist', 'index.js')], {
      cwd: __dirname,
    });
  }

  // ---- Frontend Dev Server ----
  if (isDev) {
    log('Web', 'Starting Vite dev server...');
    addProc('Web', 'npx', ['vite', '--host'], {
      cwd: join(__dirname, 'web'),
    });
  }

  log('Agent Swarm', 'All processes started. Press Ctrl+C to stop.');
  console.log();
}

main().catch((err) => {
  console.error('[Agent Swarm] Failed to start:', err);
  killAll();
  process.exit(1);
});
