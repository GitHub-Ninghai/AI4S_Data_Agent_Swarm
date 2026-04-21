# Agent Swarm

本地 Web 应用，管理和协调多个 AI Agent 完成专业化任务。执行后端是 Claude Code，通过 `@anthropic-ai/claude-agent-sdk` 的 `query()` API 进行程序化调用。本平台是 Claude Code 的编排层和可视化层。

## 系统要求

- Node.js >= 18
- Claude Code CLI（已安装并登录）
- Git Bash（Windows 用户需要）

## 快速开始

```bash
# 克隆项目
git clone https://github.com/GitHub-Ninghai/AI4S_Data_Agent_Swarm.git
cd AI4S_Data_Agent_Swarm

# 安装依赖
cd server && npm install && cd ..
cd web && npm install && cd ..

# 配置环境变量
cp .env.example .env
# 编辑 .env，Windows 用户必须设置 CLAUDE_CODE_GIT_BASH_PATH

# 启动开发模式
node start.js
```

启动后访问 http://localhost:5173

## 基本操作

1. **创建 Project** — 右上角 "+ Project"，指定名称和工作目录
2. **创建 Agent** — 左侧面板 "+ Agent"，配置角色、系统提示词、预算
3. **创建 Task** — 中间看板 "+ Task"，选择 Agent 和 Project
4. **启动 Task** — Task 卡片点击 "启动"，Agent 开始执行
5. **监控进度** — 右侧详情面板查看事件时间线、预算消耗
6. **人工介入** — Task 被工具审批拦截时自动 Stuck，点击 "允许" 恢复

## 架构

```
Frontend (React/Vite, port 5173)
    | WebSocket + REST
Local Server (Express + ws, port 3456)
    | query()
Claude Agent SDK
    | AsyncGenerator<SDKMessage>
Claude Code Sessions
```

### 目录结构

```
server/           # Node.js/Express 后端
  routes/         # REST API 路由（agents, tasks, projects, events）
  services/       # 核心服务（taskManager, sdkSessionManager, eventProcessor, stuckDetector）
  sdk/            # SDK 封装（queryWrapper, messageParser）
  store/          # JSON 持久化（fileStore, agentStore, taskStore, sessionStore, projectStore）
web/              # React + Vite 前端
  src/components/ # UI 组件（AgentCard, TaskCard, KanbanBoard, DetailPanel, ToolApproval 等）
  src/store/      # 全局状态管理（AppContext + Reducer）
  src/hooks/      # WebSocket Hook
  src/api/        # REST API 客户端
data/             # JSON 数据存储 + events/*.jsonl
hooks/            # Claude Code Hook 脚本
scripts/          # 工具脚本
```

### 核心数据模型

- **Agent** — AI 代理配置（角色、提示词、资源限制），状态: idle / working / stuck / offline
- **Task** — 工作单元，状态: Todo / Running / Stuck / Done / Cancelled
- **Project** — 项目（工作目录绑定）
- **Event** — 事件流（SDK 消息 + Hook 事件）

### Task 状态机

```
Todo -> Running -> Done
                -> Stuck -> Running (恢复)
                -> Cancelled
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3456 | 服务器端口 |
| `MAX_CONCURRENT_TASKS` | 10 | 系统最大并发任务数 |
| `MAX_WS_CLIENTS` | 10 | WebSocket 最大连接数 |
| `TOOL_APPROVAL_TIMEOUT_MS` | 300000 | 工具审批超时（5 分钟） |
| `USER_MESSAGE_TIMEOUT_MS` | 1800000 | 用户消息等待超时（30 分钟） |
| `CLAUDE_CODE_GIT_BASH_PATH` | - | Windows 必需，Git Bash 的 bash.exe 路径 |

## API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET/POST | `/api/agents` | Agent 列表 / 创建 |
| GET/PUT/DELETE | `/api/agents/:id` | Agent 查询 / 更新 / 删除 |
| GET | `/api/agents/:id/stats` | Agent 统计 |
| GET/POST | `/api/tasks` | Task 列表 / 创建 |
| GET/PUT/DELETE | `/api/tasks/:id` | Task 查询 / 更新 / 删除 |
| POST | `/api/tasks/:id/start` | 启动 Task |
| POST | `/api/tasks/:id/stop` | 取消 Task |
| POST | `/api/tasks/:id/done` | 手动完成 |
| POST | `/api/tasks/:id/message` | 发送消息（Stuck 恢复） |
| POST | `/api/tasks/:id/approve-tool` | 工具审批 |
| POST | `/api/tasks/:id/retry` | 重试 |
| GET | `/api/tasks/:id/events` | 事件查询（分页） |
| GET | `/api/tasks/:id/sdk-status` | SDK 实时状态 |
| GET/POST | `/api/projects` | Project 列表 / 创建 |
| PUT/DELETE | `/api/projects/:id` | Project 更新 / 删除 |
| POST | `/event` | Hook 事件上报 |

WebSocket: `ws://localhost:3456/ws`

## 开发命令

```bash
# 开发模式（Server + Frontend 同时启动）
node start.js

# 停止所有进程
node stop.js

# 仅后端（自动重启）
cd server && npx tsx watch index.ts

# 仅前端（热更新）
cd web && npm run dev

# 运行后端测试
cd server && npx vitest

# 运行单个测试文件
cd server && npx vitest run path/to/test.ts

# 生产构建
tsc --project server/tsconfig.json
npm run build --prefix web

# 生产模式启动
node start.js --prod

# SDK 探针验证
npm run probe
```

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js, Express, ws |
| 核心 SDK | @anthropic-ai/claude-agent-sdk |
| 前端 | React 19, Vite 6, TypeScript 5.7 |
| 存储 | JSON 文件（无数据库） |
| 并发控制 | proper-lockfile + p-queue |
| 测试 | Vitest (249 tests) |

## License

MIT
