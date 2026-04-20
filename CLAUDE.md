# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Agent Swarm** — 本地 Web 应用，管理和协调多个 AI Agent 完成专业化任务。执行后端是 Claude Code，通过 `@anthropic-ai/claude-agent-sdk` 的 `query()` API 进行程序化调用。平台定位是 Claude Code 的编排层和可视化层。

- **用户场景**：AI4S 数据合成（爬论文 → 解析 PDF → 合成 Q&A → 质检）、代码审查流水线、文档批量生成
- **远程仓库**：https://github.com/GitHub-Ninghai/AI4S_Data_Agent_Swarm.git

## Current Status

项目处于**规划阶段**，尚未编写实现代码。`requirement.md` 是完整的架构设计文档（1800+ 行），`task.json` 包含 67+ 项开发任务（全部 `passes: false`）。开发应从 Task #1（项目初始化）和 Task #2（SDK 探针验证）开始。

## Architecture

```
Frontend (React/Vite)
    ↓ WebSocket + REST (localhost:3456)
Local Server (Node.js/Express + ws)
    ↓ query()
Claude Agent SDK (@anthropic-ai/claude-agent-sdk)
    ↓ AsyncGenerator<SDKMessage>
Claude Code Sessions (多个并发)
```

### Core Data Model Relationships

- **Agent : Task = 1:N**（一个 Agent 可负责多个 Task，但同时只执行一个）
- **Task : Session = 1:1**（通过 `session_id` 直接映射）
- **Agent = systemPrompt.append + 资源配置**（平台不实现推理逻辑）

### Task State Machine

```
Todo → Running → Done / Stuck / Cancelled
                Stuck → Running (SDK resume)
```

### Event Collection (Dual Channel)

1. **SDK Message Stream**（主通道）：`SDKInit` / `SDKAssistant` / `SDKResult` → 转换为 Event
2. **Claude Hooks**（补充通道）：`POST /event` → 去重 + 兜底

### Planned Directory Structure

```
server/           # Node.js/Express 后端
  index.ts        # 入口
  routes/         # agents.ts, tasks.ts, events.ts, projects.ts
  services/       # eventProcessor, taskManager, sdkSessionManager, stuckDetector, wsBroadcaster
  sdk/            # queryWrapper, messageParser, sessionStore
  store/          # JSON 持久化 (agents.json, tasks.json, sessions.json, projects.json)
web/              # React + Vite 前端
  src/components/ # AgentPanel, KanbanBoard, DetailPanel, AgentCard, TaskCard, ActivityTimeline, ToolApproval, BudgetBar
  src/hooks/      # useWebSocket
  src/api/        # client.ts (REST API 客户端)
data/             # JSON 数据存储 + events/*.jsonl + logs/
hooks/            # eventHook.sh (补充通道)
scripts/          # register-hooks.js, sdk-probe.ts
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend Runtime | Node.js >= 18 |
| Backend Framework | Express + ws |
| Core SDK | `@anthropic-ai/claude-agent-sdk` |
| Frontend | React + Vite + TypeScript |
| Storage | JSON files (no database) |
| Dev TS Runtime | tsx (dev), tsc (production) |
| Concurrency Control | proper-lockfile + p-queue |
| Testing | Vitest (unit/integration), Playwright (E2E optional) |

## Development Commands

Development has not started yet. Once initialized:

```bash
# Start both server and frontend (dev mode)
node start.js

# Server only (dev mode, auto-restart on changes)
cd server && npx tsx watch index.ts

# Frontend only (dev mode, hot reload on port 5173)
cd web && npm run dev

# Install dependencies
cd server && npm install
cd web && npm install

# SDK probe validation (MUST run before any development)
tsx scripts/sdk-probe.ts

# Production build
tsc --project server/tsconfig.json    # → server/dist/
npm run build --prefix web            # → web/dist/

# Tests
cd server && npx vitest               # Unit + integration tests
cd server && npx vitest run path/to/test.ts  # Single test file
```

## Key API Design

- Server port: **3456** (REST + WebSocket on same port)
- WebSocket: `ws://localhost:3456/ws`
- API prefix: `/api/`
- WS message types: `task:update`, `agent:update`, `event:new`, `tool:approval`, `task:budget`, `notification`, `error`
- Frontend proxies `/api/*` to localhost:3456 via vite.config.ts

## Key Design Decisions

- **No database**: JSON file storage with `_schema_version` for migrations
- **No tmux**: SDK manages sessions directly via `query()` and `session_id`
- **Permission control**: `canUseTool` callback in SDK with auto-approve rules (Read/Glob/Grep auto-allowed; dangerous Bash commands require approval)
- **Stuck detection**: Dual channel — SDK `canUseTool` (primary) + Hook `Notification` keywords (fallback)
- **File safety**: `safeWrite` pattern (write `.tmp` → `rename`) + `proper-lockfile` + `p-queue` for serialization
- **Single user**: Local-only, REST API binds to `127.0.0.1`, no authentication
- **Agent concurrency**: One Agent runs at most one Task at a time; max 10 concurrent Tasks system-wide

## Context Management & Task Decomposition

### Why This Matters

Agent Swarm 调用的底层模型（如 GLM-5.1）在上下文占用超过 70% 时会出现输出质量退化（中英混杂、生僻字、延迟增高）。因此**上下文管理是系统级约束，不是可选优化**。

### Context Isolation Architecture

- 每个 Task 启动时调用 `query()` 创建全新会话，上下文从零开始
- Task 之间**零上下文共享**，Agent 无法通过对话历史"记住"之前做了什么
- 跨任务信息传递**只能通过文件系统**（progress.md）
- 平台在 `systemPrompt.append` 最前面自动注入上下文管理指令和工作流规范（见 requirement.md §5.1.1）

### Task Decomposition Rules (For Orchestrator)

编排任务时遵循以下规则：

1. **单 Task 粒度**：一个 Task 应该是一个可独立验证的工作单元，例如"实现 Agent CRUD API 并通过单元测试"，而不是"完成整个后端"
2. **maxTurns 建议**：不超过 100 轮（而非默认 200），为模型留出上下文余量
3. **Progress 文件是关键**：每个 Task 的 prompt 中应包含"先读 progress.md，完成后更新 progress.md"的指令
4. **验证闭环**：代码类 Task 应包含 编码→编译→测试→提交 的完整闭环；功能类 Task 应包含 启动→验证→截图确认 的完整闭环

### Default Agent Prompt Injection

平台在每个 Agent 的 prompt 前自动注入以下指令（详见 requirement.md §5.1.1）：

```
1. 读取 progress.md → 了解当前状态
2. 执行任务 → 编码/验证
3. 验证结果 → 编译通过/功能正常
4. 提交代码 → git commit
5. 更新 progress.md → 让其他 Agent 了解进展
```

## Environment Variables

See planned `.env.example`:

| Variable | Default | Purpose |
|----------|---------|---------|
| PORT | 3456 | Server port |
| MAX_CONCURRENT_TASKS | 10 | System-wide concurrent task limit |
| MAX_WS_CLIENTS | 10 | WebSocket connection limit |
| TOOL_APPROVAL_TIMEOUT_MS | 300000 | Auto-deny after 5 min |
| USER_MESSAGE_TIMEOUT_MS | 1800000 | User message wait (30 min) |

## Reference Documents

- `requirement.md` — 完整架构设计（数据模型、API 规格、UI 设计、安全约束、验收标准）
- `task.json` — 开发任务列表（67+ 项，按顺序执行）
