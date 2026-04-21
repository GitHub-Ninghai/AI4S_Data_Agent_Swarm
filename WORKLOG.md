# Agent Swarm 工作日志

## Task #1: 项目初始化 — 目录结构与基础配置

**日期**: 2026-04-20
**状态**: ✅ 完成

### 完成内容

1. **目录结构创建**
   - `server/` — 后端（routes/, services/, sdk/, store/）
   - `web/` — 前端（src/components/, src/hooks/, src/api/）
   - `data/events/`, `data/logs/` — 数据存储目录
   - `hooks/`, `scripts/` — Hook 和脚本目录

2. **配置文件**
   - 根目录 `package.json` — 项目元信息，启动脚本入口
   - `server/package.json` — 7 个运行依赖 + 6 个开发依赖（express, ws, claude-agent-sdk, tsx 等）
   - `server/tsconfig.json` — ES2022, NodeNext, strict
   - `web/package.json` — React 19 + Vite 6 + TypeScript
   - `web/tsconfig.json` — bundler moduleResolution, react-jsx
   - `web/vite.config.ts` — dev proxy `/api` → :3456, `/ws` → ws://:3456
   - `.env.example` — 5 个环境变量模板
   - `.gitignore` — 更新忽略规则

3. **占位入口文件**
   - `server/index.ts` — 后端入口占位
   - `web/src/main.tsx` — 前端入口占位
   - `web/index.html` — HTML 模板

### 验证结果

| 验证项 | 结果 |
|--------|------|
| `npm install` (server) | ✅ 171 packages |
| `npm install` (web) | ✅ 69 packages |
| `@anthropic-ai/claude-agent-sdk` | ✅ v0.1.77 |
| `npx tsx index.ts` | ✅ 正常执行 |
| `npx vite build` | ✅ 构建成功 |

### 下一步

Task #2: SDK 集成验证 — 编写探针脚本验证 7 个关键假设

---

## Task #2: SDK 集成验证 — 编写探针脚本

**日期**: 2026-04-20
**状态**: ✅ 完成

### 完成内容

1. **探针脚本 `scripts/sdk-probe.ts`**
   - 验证假设 1: `query()` 参数签名正确 → ✅ `(params: {prompt, options?}) => AsyncGenerator<SDKMessage>`
   - 验证假设 2: `SDKSystemMessage` subtype "init" 包含 `session_id` → ✅ UUID 格式
   - 验证假设 3: `abortController` 参数被 SDK 支持 → ✅ abort 后流正确停止
   - 验证假设 4: `resume` 机制可恢复会话 → ✅ Agent 正确回忆上下文
   - 验证假设 5: `canUseTool` 回调接口存在 → ✅ 类型定义为异步回调
   - 验证假设 6: 预算超限返回 `ResultMessage(subtype="error_max_budget_usd")` → ✅
   - 验证假设 7: SDK 已公开发布，npm 可安装 → ✅ v0.1.77

2. **Windows 环境发现**
   - 必须设置 `CLAUDE_CODE_GIT_BASH_PATH` 环境变量指向 Git Bash 的 `bash.exe`
   - 更新 `.env.example` 添加此配置

3. **根目录依赖更新**
   - 更新 `package.json` 添加 `@anthropic-ai/claude-agent-sdk`、`tsx`、`typescript` 开发依赖
   - 添加 `"type": "module"` 配置
   - 添加 `npm run probe` 脚本

4. **验证报告**
   - 生成 `scripts/sdk-probe-report.md`，包含 7/7 通过的验证结论
   - 补充 Windows 环境说明和关键注意事项

### 验证结果

| 验证项 | 结果 |
|--------|------|
| SDK 安装 (npm) | ✅ v0.1.77 |
| query() 签名 | ✅ 正确 |
| system init session_id | ✅ UUID 格式 |
| abortController | ✅ 正常中止 |
| resume 恢复会话 | ✅ Agent 记住上下文 |
| canUseTool 回调 | ✅ 接口可用 |
| 预算超限行为 | ✅ 返回 error_max_budget_usd |
| Windows 兼容性 | ✅ 需设置 GIT_BASH_PATH |

### 关键发现

- **预算超限**: `ResultMessage.is_error=false`，但 `subtype="error_max_budget_usd"` 是可靠的判断依据
- **canUseTool**: SDK 内部可能自动批准简单工具调用，回调仅在需要权限审批时触发
- **Windows 必需**: `CLAUDE_CODE_GIT_BASH_PATH` 环境变量

### 下一步

Task #3: 后端 — JSON 数据存储基础设施（safeWrite + 文件锁 + 迁移）

---

## Task #3: 后端 — JSON 数据存储基础设施（safeWrite + 文件锁 + 迁移）

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`server/store/fileStore.ts`** — 核心文件存储工具
   - `safeWrite(filePath, data)`: 先写 `.tmp.<pid>` 临时文件再 `fs.rename` 原子替换，使用 `proper-lockfile` 加文件锁
   - `loadJson(filePath, defaultValue)`: 文件不存在时返回默认值并初始化文件
   - `migrate(filePath, data, targetVersion, migrations)`: 读取 `_schema_version` 字段，依次执行迁移函数
   - `FileStore` 类: 使用 `p-queue`(concurrency: 1) 串行化所有写操作，提供 `load()`、`getData()`、`save()` 方法

2. **`server/store/types.ts`** — 核心领域类型定义
   - `Project`, `Agent`, `Task`, `Event`, `Session` 接口
   - `SchemaEnvelope<T>` 及其子类型（`AgentsEnvelope`, `TasksEnvelope` 等）

3. **`server/store/index.ts`** — 统一导出与初始化
   - 创建 4 个 `FileStore` 单例（agents/tasks/sessions/projects）
   - `loadAllStores()`: 并行加载所有 store
   - `getAllStores()`: 返回所有 store 实例（诊断/测试用）

4. **`server/store/fileStore.test.ts`** — 13 个单元测试
   - safeWrite: 写入/覆写/无残留 tmp 文件/并发安全
   - loadJson: 缺失文件/已存在文件/空文件
   - migrate: 版本匹配/有序迁移/持久化
   - FileStore: 默认加载/save+getData/并发串行化

5. **数据文件初始化**
   - `data/agents.json`, `data/tasks.json`, `data/sessions.json`, `data/projects.json` 自动生成
   - 初始内容: `{ "_schema_version": 1, "<collection>": [] }`

### 验证结果

| 验证项 | 结果 |
|--------|------|
| safeWrite 原子写入 | ✅ |
| safeWrite 无 tmp 残留 | ✅ |
| safeWrite 并发安全 (5 并发) | ✅ |
| loadJson 默认值初始化 | ✅ |
| loadJson 读取已有文件 | ✅ |
| loadJson 处理空文件 | ✅ |
| migrate 版本匹配不操作 | ✅ |
| migrate 有序执行迁移 | ✅ |
| migrate 持久化到磁盘 | ✅ |
| FileStore 加载默认值 | ✅ |
| FileStore save+getData | ✅ |
| FileStore 串行化并发 (50 并发) | ✅ |
| 数据文件初始化 | ✅ 4 个 JSON 文件 |

### Windows 注意事项

- `proper-lockfile` 在 Windows 上并发锁竞争较慢，raw `safeWrite` 并发测试控制在 5 个
- 实际并发安全由 `FileStore` 的 `p-queue` 保证（50 并发测试通过）

### 下一步

Task #4: 后端 — 内存状态管理（agents/tasks/sessions/projects Map）

---

## Task #4: 后端 — 内存状态管理（agents/tasks/sessions/projects Map）

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`server/store/agentStore.ts`** — Agent 内存状态管理
   - `Map<string, Agent>` 存储全部 Agent
   - CRUD: `getAllAgents`, `getAgentById`, `createAgent`, `updateAgent`, `deleteAgent`
   - 专有查询: `getAgentsByStatus`, `getAgentsByProject`
   - 写操作后自动调用 `agentsStore.save()` 异步持久化

2. **`server/store/taskStore.ts`** — Task 内存状态管理
   - `Map<string, Task>` 存储全部 Task
   - CRUD: `getAllTasks`, `getTaskById`, `createTask`, `updateTask`, `deleteTask`
   - 高级查询: `queryTasks(options)` — 支持按 status/agentId/projectId/priority 过滤 + 分页
   - 专有查询: `getTasksByStatus`, `getActiveTaskForAgent`, `countTasksByStatus`

3. **`server/store/sessionStore.ts`** — Session 内存状态管理（含运行时状态）
   - `Map<string, Session>` 持久化 Session
   - `Map<string, RuntimeSession>` 运行时状态（不持久化）: `abortController`, `pendingToolApprovals`
   - CRUD: `getAllSessions`, `getSessionById`, `getSessionByTaskId`, `createSession`, `updateSession`
   - 运行时: `getAbortController`, `setAbortController`, `getPendingToolApproval`, `setPendingToolApproval`, `cleanupRuntime`

4. **`server/store/projectStore.ts`** — Project 内存状态管理
   - `Map<string, Project>` 存储全部 Project
   - CRUD: `getAllProjects`, `getProjectById`, `createProject`, `updateProject`, `deleteProject`

5. **`server/store/index.ts`** 更新
   - `loadAllStores()` 现在先加载 JSON 文件，再填充内存 Map
   - 统一导出所有 store 模块（`agentStore.*`, `taskStore.*`, `sessionStore.*`, `projectStore.*`）

6. **`server/store/memoryStores.test.ts`** — 12 个单元测试
   - Agent: CRUD 往返、更新持久化、删除、状态过滤
   - Task: 状态过滤、分页、状态流转、查找活跃任务
   - Session: 运行时状态不持久化、按 taskId 查找、cleanup 中止 controller
   - Project: 完整 CRUD 周期

### 验证结果

| 验证项 | 结果 |
|--------|------|
| Agent CRUD | ✅ |
| Agent 状态过滤 | ✅ |
| Task 状态过滤 | ✅ |
| Task 分页 | ✅ |
| Task 状态流转 | ✅ |
| Task 活跃任务查找 | ✅ |
| Session 运行时隔离 | ✅ |
| Session taskId 查找 | ✅ |
| Session cleanup | ✅ |
| Project 完整 CRUD | ✅ |
| 全部测试 (25) | ✅ |

### 下一步

Task #5: 后端 — Express Server 入口与基础中间件

---

## Task #5: 后端 — Express Server 入口与基础中间件

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`server/app.ts`** — Express 应用配置（可被测试导入）
   - CORS 中间件：允许 `localhost:5173`（Vite dev server）
   - `express.json({ limit: '10mb' })` 请求体解析
   - `GET /api/health`：返回 `{ status, version, uptime, activeTaskCount, maxConcurrentTasks, storageOk }`
   - 统一错误处理中间件：格式化为 `{ error: { code, message, details } }`，500 错误隐藏详情
   - `startServer()` 函数：加载 store → 启动 HTTP Server 监听 `127.0.0.1:3456`

2. **`server/index.ts`** — 入口文件，导入 `app.ts` 并调用 `startServer()`

3. **`server/server.test.ts`** — 5 个集成测试
   - Health check 返回 `status: "ok"`
   - `activeTaskCount` 为数字类型
   - 未知路由返回 404
   - CORS 允许 `localhost:5173`
   - CORS 拒绝其他来源

### 验证结果

| 验证项 | 结果 |
|--------|------|
| Health check /api/health | ✅ |
| CORS localhost:5173 | ✅ |
| CORS 拒绝其他来源 | ✅ |
| 404 未知路由 | ✅ |
| Server 启动 | ✅ 127.0.0.1:3456 |
| 全部测试 (30) | ✅ |

### 下一步

Task #6: 后端 — WebSocket Server 与广播服务

---

## Task #6: 后端 — WebSocket Server 与广播服务

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`server/services/wsBroadcaster.ts`** — WebSocket 广播服务
   - `initWebSocket(httpServer, maxClients)`: 在 HTTP Server 上集成 WebSocket，通过 `upgrade` 事件处理
   - 并发连接数限制：超过 `MAX_WS_CLIENTS`（默认 10）时返回 429 并拒绝连接
   - `broadcast(type, data)`: 向所有 `readyState === OPEN` 的客户端发送 `{ type, data }` JSON 消息
   - 心跳检测：30 秒间隔 ping/pong，自动移除断线客户端
   - `getConnectedClientCount()`: 返回当前连接数
   - `closeWebSocket()`: 关闭所有连接并清理

2. **`server/app.ts` 更新**
   - `startServer()` 中调用 `initWebSocket(server, MAX_WS_CLIENTS)`
   - 启动日志增加 WebSocket 地址

3. **`server/services/wsBroadcaster.test.ts`** — 5 个测试
   - 连接建立
   - 客户端计数追踪
   - 单客户端广播
   - 多客户端广播
   - 超出最大连接数拒绝

### 验证结果

| 验证项 | 结果 |
|--------|------|
| WebSocket 连接 | ✅ |
| 客户端计数 | ✅ |
| 单客户端广播 | ✅ |
| 多客户端广播 | ✅ |
| 连接数限制 | ✅ |
| 全部测试 (35) | ✅ |

### 下一步

Task #7: 后端 — Project 管理 API（CRUD）

---

## Task #7: 后端 — Project 管理 API（CRUD）

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`server/routes/projects.ts`** — Project CRUD REST API
   - `GET /api/projects` → `{ projects: Project[] }`
   - `POST /api/projects` → 校验 name `[a-zA-Z0-9_-]` + path 绝对路径且存在 → 201 创建
   - `PUT /api/projects/:id` → 部分更新 name/path/description → 校验同 POST
   - `DELETE /api/projects/:id` → 检查是否有 Running/Stuck Task → 409 RESOURCE_HAS_DEPENDENTS 保护
   - 404 PROJECT_NOT_FOUND 统一错误格式
   - 每次变更后 WebSocket 广播 `project:update` / `project:delete`

2. **`server/app.ts` 更新**
   - 注册路由 `app.use("/api/projects", projectsRouter)`
   - `startServer(overridePort?)` 支持随机端口（port 0），解决测试端口冲突

3. **`server/routes/projects.test.ts`** — 12 个集成测试
   - GET 空列表
   - POST 创建成功、无效 name、缺少 name、相对路径、不存在路径
   - PUT 更新 description、404、无效 name
   - DELETE 成功、404、有活跃 Task 时 409 保护

### 验证结果

| 验证项 | 结果 |
|--------|------|
| GET /api/projects | ✅ |
| POST 校验 | ✅ 5 项 |
| PUT 更新 | ✅ |
| PUT 404 | ✅ |
| DELETE 成功 | ✅ |
| DELETE 404 | ✅ |
| DELETE 409 保护 | ✅ |
| 全部测试 (47) | ✅ |

### 下一步

Task #8: 后端 — Agent 管理 API（GET）
