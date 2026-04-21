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

Task #8-#11: 后端 — Agent 管理 API（完整 CRUD）

---

## Task #8-#11: 后端 — Agent 管理 API（完整 CRUD）

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`server/routes/agents.ts`** — Agent 完整 CRUD REST API
   - `GET /api/agents` → `{ agents: Agent[] }`
   - `GET /api/agents/:id` → `{ agent }` / 404 AGENT_NOT_FOUND
   - `POST /api/agents` → 校验 name(1-50)/avatar(非空)/role(1-200)/prompt(10-5000) → 201 创建
     - 默认值: maxTurns=200, maxBudgetUsd=5.0, allowedTools=[Bash,Read,Write,Edit,Grep,Glob,WebFetch]
     - 生成: id(UUID), status="idle", isEnabled=true, taskCount=0, stats(全0)
   - `PUT /api/agents/:id` → 部分更新 + isEnabled→status 联动（false→offline, true→idle）
   - `DELETE /api/agents/:id` → 检查活跃 Task → 409 RESOURCE_HAS_DEPENDENTS 保护
   - 每次变更后 WebSocket 广播

2. **`server/routes/agents.test.ts`** — 16 个集成测试
   - GET: 空列表、按 ID 查找、404
   - POST: 创建成功、自定义配置、缺少 name、短 prompt、空 avatar
   - PUT: 更新 prompt、404、isEnabled→offline、offline→idle、无效 prompt
   - DELETE: 成功、404、有活跃 Task 时 409

### 验证结果

| 验证项 | 结果 |
|--------|------|
| GET /api/agents | ✅ |
| GET /api/agents/:id | ✅ |
| POST 创建 + 校验 | ✅ 5 项 |
| PUT 更新 + 状态联动 | ✅ 5 项 |
| DELETE + 保护 | ✅ 3 项 |
| 全部测试 (63) | ✅ |

### 下一步

Task #12: 后端 — Agent 统计 API

---

## Task #12: 后端 — Agent 统计 API

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`server/routes/agents.ts`** 新增 `GET /api/agents/:id/stats`
   - 返回 `agent.stats`（totalTasksCompleted, totalTasksCancelled, totalCostUsd, avgDurationMs）
   - 查询该 Agent 最近 10 条已完成的 Task（按 completedAt 降序）作为 `recentTasks`

2. **`server/routes/agents.test.ts`** 新增 3 个测试
   - 新 Agent 返回全 0 统计
   - 不存在的 Agent 返回 404
   - 包含最近已完成 Task

### 验证结果

| 验证项 | 结果 |
|--------|------|
| 新 Agent 统计全 0 | ✅ |
| 404 不存在 | ✅ |
| recentTasks 包含已完成 | ✅ |
| 全部测试 (66) | ✅ |

### 下一步

Task #13-#16: 后端 — Task 管理 API（完整 CRUD）

---

## Task #13-#16: 后端 — Task 管理 API（完整 CRUD）

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`server/routes/tasks.ts`** — Task 完整 CRUD REST API
   - `POST /api/tasks` — 创建 Task
     - 校验 title(1-100)/description(10-10000)/agentId/projectId
     - 验证 Agent 和 Project 存在
     - 继承 Agent 的 maxTurns/maxBudgetUsd 配置
     - 默认值: priority=1, tags=[], eventCount/turnCount/budgetUsed=0
     - 更新 Agent.taskCount(+1)
   - `GET /api/tasks` — 列表查询
     - 过滤: projectId, status(逗号分隔多值), agentId, q(关键词搜索)
     - 分页: page/limit/total/totalPages
     - 默认排除软删除，includeDeleted=true 显示
   - `GET /api/tasks/:id` — 单 Task 查询
   - `PUT /api/tasks/:id` — 编辑
     - Running/Stuck 状态禁止修改 agentId (409)
     - Todo 状态修改 agentId 时更新两个 Agent 的 taskCount
   - `DELETE /api/tasks/:id` — 删除
     - Running/Stuck 拒绝删除 (409)
     - Done/Cancelled 软删除（设置 deletedAt）
     - Todo 硬删除 + Agent.taskCount(-1)

2. **`server/routes/tasks.test.ts`** — 23 个集成测试

### 验证结果

| 验证项 | 结果 |
|--------|------|
| POST 创建 + 校验 | ✅ 7 项 |
| GET 列表 + 过滤/分页 | ✅ 6 项 |
| GET 单个 + 404 | ✅ 2 项 |
| PUT 编辑 + agentId 联动 | ✅ 4 项 |
| DELETE + 软删除/硬删除 | ✅ 4 项 |
| 全部测试 (89) | ✅ |

### 下一步

Task #18: 后端 — SDK messageParser — SDK 消息流转换为 Event

---

## Task #17: 后端 — SDK queryWrapper — 封装 query() 调用与 canUseTool 回调

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`server/sdk/queryWrapper.ts`** — SDK query() 完整封装
   - `isAutoAllowed(toolName, input)`: 自动批准规则
     - Read/Glob/Grep 只读工具自动批准
     - Bash 命令：不含危险关键词（rm -rf、format、del /s、shutdown、rmdir /s、mkfs、dd if=）时自动批准
     - 其他工具（Write、Edit 等）需要人工审批
   - `createCanUseToolCallback(taskId, sessionId)`: SDK canUseTool 回调工厂
     - 自动批准的调用直接返回 `{ behavior: 'allow' }`
     - 需要审批的调用：标记 Task 为 Stuck → 广播 `tool:approval` WebSocket 消息 → `Promise.race` 等待用户决策与超时
     - 用户批准后自动加入缓存，后续同类调用自动批准
   - `resolveToolDecision(taskId, decision)`: 供 approve-tool API 调用，解决等待中的决策
   - `startQuery(task, agent, projectDir)`: 构建完整 SDK query() 参数（systemPrompt、cwd、maxTurns、maxBudgetUsd、canUseTool、abortController）
   - `resumeQuery(sessionId, message, task, agent, projectDir)`: 恢复已有会话
   - `cleanupQuery(taskId)`: 清理 pending decisions 和 auto-allow 缓存
   - `hasPendingApproval(taskId)`: 查询是否有待审批的工具调用
   - `summarizeToolInput(input, maxLen)`: 工具输入摘要，截断长输入

2. **`server/sdk/queryWrapper.test.ts`** — 22 个单元测试
   - isAutoAllowed: Read/Glob/Grep 自动批准、安全 Bash、危险 Bash、Write/Edit 拒绝、未知工具
   - summarizeToolInput: 正常输出、长输入截断、默认长度
   - createCanUseToolCallback: 自动允许 Read/Glob、标记 Stuck + 广播、超时 deny、缓存已批准工具、deny 决策
   - resolveToolDecision: 无 pending 返回 false、有 pending 返回 true
   - cleanupQuery: 清理 pending 状态、无 pending 时不报错
   - hasPendingApproval: 无 pending 返回 false

### 验证结果

| 验证项 | 结果 |
|--------|------|
| isAutoAllowed 规则 | ✅ 8 项 |
| summarizeToolInput | ✅ 3 项 |
| canUseTool 回调 | ✅ 5 项 |
| resolveToolDecision | ✅ 2 项 |
| cleanupQuery | ✅ 2 项 |
| hasPendingApproval | ✅ 2 项 |
| 全部测试 (111) | ✅ |

### 下一步

Task #19: 后端 — SDKSessionManager

---

## Task #18: 后端 — SDK messageParser — SDK 消息流转换为 Event

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`server/sdk/messageParser.ts`** — SDK 消息流 → Event 转换器
   - `parseMessage(taskId, sessionId, message)`: 主解析函数，返回 `Event[]`
   - SDKSystemMessage(init) → `SDKInit` Event，记录 session_id
   - SDKAssistantMessage → 遍历 content 块：
     - tool_use 块 → `SDKAssistant` Event（toolName、toolInput 截断至 10KB）
     - text 块 → `SDKAssistant` Event（toolOutput 截断至 2000 字符）
   - SDKResultMessage → `SDKResult` Event（output、duration、费用信息）
   - 所有 Event 带 id(UUID)、taskId、sessionId、source='sdk'、timestamp、raw(截断至 10KB)
   - `extractSessionId(message)`: 从 init 消息中提取 session_id
   - `extractCostInfo(message)`: 从 result 消息中提取费用信息（totalCostUsd、numTurns、durationMs、subtype、isErr）

2. **`server/sdk/messageParser.test.ts`** — 16 个单元测试
   - SDKInit: 解析 init 消息、记录 session_id
   - SDKAssistant tool_use: 解析工具调用、截断大输入
   - SDKAssistant text: 解析文本输出、截断长文本
   - SDKAssistant 混合内容: 多块生成多事件
   - SDKResult: success、error、max_turns
   - 未识别消息: stream_event、system status 返回空数组
   - extractSessionId: init 提取、非 init 返回 undefined
   - extractCostInfo: success/error/非 result

### 验证结果

| 验证项 | 结果 |
|--------|------|
| SDKInit 解析 | ✅ |
| SDKAssistant tool_use | ✅ |
| SDKAssistant text | ✅ |
| 混合内容多事件 | ✅ |
| 工具输入截断 10KB | ✅ |
| 文本输出截断 2KB | ✅ |
| SDKResult success | ✅ |
| SDKResult error | ✅ |
| 未识别消息跳过 | ✅ |
| extractSessionId | ✅ |
| extractCostInfo | ✅ |
| 全部测试 (127) | ✅ |

### 下一步

Task #20: 后端 — TaskManager

---

## Task #19: 后端 — SDKSessionManager — 基础框架与 startTask/bindSession

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`server/services/sdkSessionManager.ts`** — SDK 会话生命周期管理（单例）
   - `startTask(task, agent, projectDir)`: 调用 `startQuery()` 获取 stream/abortController → 注册到 `activeQueries` Map → 后台启动 `consumeStream()` 消费消息流
   - `resumeTask(sessionId, message, task, agent, projectDir)`: 恢复已有 SDK 会话
   - `stopTask(taskId)`: 中止 stream、清理映射
   - `bindSession(taskId, sessionId)`: 绑定 SDK session_id → Task 双向映射（activeQueries + sessionReverseMap）
   - `consumeStream()`: 异步消费 SDK 消息流 → `processMessage()` 处理每条消息
   - `processMessage()`: 解析 SDK 消息 → 更新 Task 计数器(eventCount/turnCount/budgetUsed) → 广播 WebSocket 事件
   - `handleTaskCompletion()`: 处理 SDKResult → 根据 subtype 设置 completedReason(sdk_result/max_turns/max_budget/error) → 更新 Agent 统计
   - `handleStreamError()`: 处理 stream 异常 → 标记 Task 完成(reason=error)
   - 查询方法: `getByTaskId()`, `getTaskIdBySession()`, `getActiveTaskCount()`, `hasActiveTask()`
   - `stopAll()`: 批量停止所有活跃查询

2. **`server/services/sdkSessionManager.test.ts`** — 9 个单元测试
   - startTask: 注册查询、存储 AbortController
   - stopTask: 中止并清理、处理不存在的 task
   - bindSession: 绑定 session_id、建立双向映射、广播更新
   - 查询方法: getByTaskId、getTaskIdBySession、getActiveTaskCount
   - stopAll: 批量停止

### 验证结果

| 验证项 | 结果 |
|--------|------|
| startTask 注册查询 | ✅ |
| startTask 存储 AbortController | ✅ |
| stopTask 中止+清理 | ✅ |
| stopTask 处理不存在 | ✅ |
| bindSession 双向映射 | ✅ |
| 查询方法 | ✅ 3 项 |
| stopAll 批量停止 | ✅ |
| 全部测试 (136) | ✅ |

### 下一步

Task #21: 后端 — Task 操作 API（start/cancel/done/retry）

---

## Task #20: 后端 — TaskManager — 核心状态迁移（start/complete/cancel/done）

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`server/services/taskManager.ts`** — Task 生命周期状态管理器（单例）
   - `startTask(taskId)`: Todo → Running 状态迁移
     - 校验 Task 为 Todo、Agent 为 idle 且 isEnabled
     - 检查 Agent 单 Task 约束（`getActiveTaskForAgent`）
     - 检查系统并发上限（`MAX_CONCURRENT_TASKS`）
     - 校验 Project 存在
     - 调用 `sdkSessionManager.startTask()` 启动 SDK 会话
     - 更新 Task 状态/startedAt、Agent 状态→working/currentTaskId
     - SDK 启动失败时自动回滚（Task→Todo、Agent→idle）
     - 广播 `task:update` + `agent:update`
   - `completeTask(taskId, reason, output?)`: Running/Stuck → Done
     - 供 SDK 完成或外部调用
     - 更新 completedAt/completedReason/output（截断 10KB）
     - 更新 Agent 统计（totalTasksCompleted++、totalCostUsd 累加、avgDurationMs 重算）
     - 智能判断 Agent 是否有其他活跃 Task，有则保持当前状态，无则→idle
   - `cancelTask(taskId)`: Running/Stuck → Cancelled
     - 调用 `sdkSessionManager.stopTask()` 中止 SDK 会话
     - completedReason = 'user_cancelled'
     - 更新 Agent 统计（totalTasksCancelled++）
     - Agent 状态智能管理
   - `doneTask(taskId)`: Running/Stuck → Done
     - 用户手动标记完成，completedReason = 'user_done'
     - 同 completeTask 的统计逻辑
   - `updateAgentStatus(agentId)` 私有辅助：检查 Agent 是否还有 Running/Stuck Task
   - `TaskManagerError` 自定义错误类（含 statusCode/code/message）

2. **`server/services/taskManager.test.ts`** — 20 个单元测试
   - startTask: Todo→Running+Agent→working、Task不存在、非Todo、Agent禁用、Agent忙碌、SDK失败回滚
   - cancelTask: Running→Cancelled+Agent→idle、更新cancelled统计、不存在、非活跃状态、调用stopTask
   - doneTask: Running→Done+user_done、更新Agent统计、Todo拒绝
   - completeTask: sdk_result+output、不存在跳过、Todo跳过、output截断
   - Agent状态管理: 多Task保持working、全部完成后→idle

### 验证结果

| 验证项 | 结果 |
|--------|------|
| startTask Todo→Running | ✅ |
| startTask Agent→working | ✅ |
| startTask 不存在Task 404 | ✅ |
| startTask 非Todo 409 | ✅ |
| startTask Agent禁用 409 | ✅ |
| startTask Agent忙碌 409 | ✅ |
| startTask SDK失败回滚 | ✅ |
| cancelTask Running→Cancelled | ✅ |
| cancelTask Agent→idle | ✅ |
| cancelTask cancelled统计 | ✅ |
| doneTask Running→Done | ✅ |
| doneTask user_done reason | ✅ |
| doneTask Agent统计更新 | ✅ |
| completeTask sdk_result | ✅ |
| completeTask output截断 | ✅ |
| 多Task Agent保持working | ✅ |
| 全部测试 (156) | ✅ |

### 下一步

Task #27: 后端 — Task Event 查询 API

---

## Task #21-#26: 后端 — Task 操作 API（start/stop/done/message/approve-tool/retry）

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`server/routes/tasks.ts`** 新增 6 个操作路由
   - `POST /api/tasks/:id/start` — 启动 Todo Task
     - 调用 `taskManager.startTask()`，含 Agent 状态和并发校验
     - Task 状态先同步变为 Running，sessionId 通过 WebSocket 异步通知
     - 返回 `{ task }`（status 已为 Running）
   - `POST /api/tasks/:id/stop` — 取消运行中 Task
     - 调用 `taskManager.cancelTask()`，中止 SDK 消息流
     - Task → Cancelled，Agent → idle
   - `POST /api/tasks/:id/done` — 手动标记完成
     - 调用 `taskManager.doneTask()`，completedReason = 'user_done'
   - `POST /api/tasks/:id/message` — 向 Stuck Task 发送消息（SDK resume）
     - 接收 `{ message, allowTool? }`，支持附带工具审批决策
     - 先调用 `resolveToolDecision()`，再调用 `sdkSessionManager.resumeTask()`
     - Task Stuck → Running，Agent stuck → working
   - `POST /api/tasks/:id/approve-tool` — 工具审批
     - 接收 `{ decision: 'allow' | 'deny' }`
     - 调用 `resolveToolDecision()` 解除 canUseTool 阻塞
     - allow 时自动恢复 Running 状态
   - `POST /api/tasks/:id/retry` — 重试已完成/已取消 Task
     - 复制原 Task 配置创建新 Task，title 追加 '(重试)'
     - `parentTaskId` 指向原 Task，状态为 Todo
     - 保留原 Task 的 tags/maxTurns/maxBudgetUsd/priority

2. **`server/routes/taskActions.test.ts`** — 27 个集成测试
   - start: 启动成功、404不存在、非Todo拒绝、Agent禁用拒绝、Agent状态更新
   - stop: 取消成功、404、Todo拒绝、Agent→idle
   - done: 标记完成、404、Todo拒绝
   - message: 404、非Stuck拒绝、空消息拒绝、发送成功恢复Running
   - approve-tool: 404、非Stuck拒绝、无效decision、allow恢复Running
   - retry: Done重试、Cancelled重试、404、Todo拒绝、Running拒绝、taskCount递增、配置保留

### 验证结果

| 验证项 | 结果 |
|--------|------|
| POST /start Todo→Running | ✅ |
| POST /start Agent→working | ✅ |
| POST /start 404/409 校验 | ✅ 3 项 |
| POST /stop Running→Cancelled | ✅ |
| POST /stop Agent→idle | ✅ |
| POST /done Running→Done | ✅ |
| POST /message Stuck→Running | ✅ |
| POST /message 校验 | ✅ 3 项 |
| POST /approve-tool allow | ✅ |
| POST /approve-tool 校验 | ✅ 3 项 |
| POST /retry Done→新Task | ✅ |
| POST /retry 配置保留 | ✅ |
| POST /retry 校验 | ✅ 3 项 |
| 全部测试 (183) | ✅ |

### 下一步

Task #27-#32: 后端 — Event 管道、Stuck 检测与崩溃恢复

---

## Task #27-#32: 后端 — Event 管道、Stuck 检测与崩溃恢复

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **Task #27: `GET /api/tasks/:id/events`** — Task 事件分页查询
   - 从 `data/events/<taskId>.jsonl` 文件逐行读取事件
   - 支持 `.jsonl.gz` 归档文件，自动解压读取后与当前文件合并
   - 支持 `type` 事件类型过滤
   - 分页参数: `page`/`limit`/`total`/`totalPages`
   - 按时间戳升序排列
   - 容错处理: 跳过格式错误的 JSONL 行

2. **Task #28: `GET /api/tasks/:id/sdk-status`** — Task SDK 实时状态
   - 返回 `{ running, turnCount, budgetUsed, maxBudgetUsd }`
   - `running` 通过 `sdkSessionManager.hasActiveTask()` 判断

3. **Task #29: `server/services/eventProcessor.ts`** — 事件处理器（单例）
   - `processEvent(event)`: 去重(`Set<id>`) → 计算 duration → 写入 JSONL → 更新 Task.eventCount → 广播 WebSocket
   - Duration 计算: PreToolUse 记录时间戳，PostToolUse 匹配计算差值
   - JSONL 追加写入 `data/events/<taskId>.jsonl`
   - 异步归档: 文件超 100MB 自动压缩为 `.jsonl.gz`

4. **Task #30: `server/services/stuckDetector.ts`** — Stuck 检测器（双通道）
   - `isPermissionPrompt(event)`: 检测 5 个权限关键词（大小写不敏感）
   - `handleHookEvent(event)`: Notification + 权限关键词 → 标记 Task 为 Stuck + 广播通知
   - `taskManager.stuckTask(taskId, reason)`: Running → Stuck 状态迁移

5. **Task #31: `server/routes/events.ts`** — Hook 事件接收端点
   - `POST /event`（无 `/api` 前缀）
   - 接收 Claude Code Hook 上报的事件
   - 通过 `session_id` → `taskStore.getTaskBySessionId()` 关联 Task
   - 转换为内部 Event（source='hook'）→ eventProcessor → stuckDetector
   - 原始数据追加到 `data/logs/hooks.log`

6. **Task #32: Server 崩溃恢复**
   - `recoverRunningTasks()`: 启动时扫描所有 Running Task
     - 有 sessionId → Stuck（用户可恢复）
     - 无 sessionId → Cancelled
   - 对应 Agent 状态自动更新
   - 磁盘空间检查（<500MB 警告，不阻止启动）
   - `taskStore.getTaskBySessionId()`: 新增按 SDK session_id 查找 Task

7. **`server/app.ts` 更新**
   - 注册 eventsRouter: `app.use("/", eventsRouter)`
   - 导入 agentStore 用于崩溃恢复
   - 启动流程: loadAllStores → recoverRunningTasks → initWebSocket → listen

### 新增/修改文件

| 文件 | 操作 |
|------|------|
| `server/routes/tasks.ts` | 新增 events/sdk-status 路由 |
| `server/routes/events.ts` | **新建** Hook 事件端点 |
| `server/services/eventProcessor.ts` | **新建** 事件处理器 |
| `server/services/stuckDetector.ts` | **新建** Stuck 检测器 |
| `server/services/taskManager.ts` | 新增 stuckTask 方法 |
| `server/store/taskStore.ts` | 新增 getTaskBySessionId |
| `server/app.ts` | 新增崩溃恢复 + 磁盘检查 + eventsRouter |
| `server/routes/taskEvents.test.ts` | **新建** 14 个测试 |
| `server/services/eventProcessor.test.ts` | **新建** 8 个测试 |
| `server/services/stuckDetector.test.ts` | **新建** 13 个测试 |
| `server/routes/events.test.ts` | **新建** 9 个测试 |
| `server/server.recovery.test.ts` | **新建** 3 个测试 |

### 验证结果

| 验证项 | 结果 |
|--------|------|
| GET /events 分页 | ✅ |
| GET /events 类型过滤 | ✅ |
| GET /events GZ 归档读取 | ✅ |
| GET /events 合并归档+当前 | ✅ |
| GET /events 容错 | ✅ |
| GET /sdk-status | ✅ |
| EventProcessor 去重 | ✅ |
| EventProcessor duration 计算 | ✅ |
| EventProcessor JSONL 写入 | ✅ |
| StuckDetector 权限关键词检测 | ✅ 6 项 |
| StuckDetector Hook 事件处理 | ✅ 6 项 |
| POST /event Hook 端点 | ✅ 9 项 |
| 崩溃恢复 Running→Stuck | ✅ |
| 崩溃恢复 Running→Cancelled | ✅ |
| 崩溃恢复 跳过非Running | ✅ |
| 全部测试 (230) | ✅ |

### 下一步

Task #34: 后端 — 日志策略与日志轮转

---

## Task #33: 后端 — Hook 脚本与注册工具

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`hooks/eventHook.sh`** — Claude Code Hook 事件转发脚本
   - 从 stdin 读取 JSON，用 `jq` 提取 6 个字段（hook_event_name/session_id/cwd/tool_name/tool_input/tool_output）
   - `tool_input` 截断至 10KB（超出部分裁剪）
   - 紧凑 JSON 格式（`jq -c`）追加到 `data/logs/hooks.log`
   - `curl POST` 转发到 `http://localhost:3456/event`，静默失败
   - 使用 `bash ./hooks/eventHook.sh` 作为 Hook 命令（兼容 Git Bash）

2. **`scripts/register-hooks.js`** — Hook 自动注册工具
   - 自动检测 Claude Code 配置目录（优先 `claude --config-dir`，回退到默认路径）
   - 注册 4 个 Hook 事件：Stop、SessionStart、SessionEnd、Notification
   - 幂等：已注册的 Hook 跳过，不重复添加
   - 支持 `--unregister` 参数注销 Hook
   - 跨平台兼容（Windows/macOS/Linux）

### 验证结果

| 验证项 | 结果 |
|--------|------|
| eventHook.sh JSON 转发 | ✅ |
| eventHook.sh 紧凑 JSON 输出 | ✅ |
| eventHook.sh tool_input 10KB 截断 | ✅ |
| register-hooks.js 首次注册 4 个 Hook | ✅ |
| register-hooks.js 幂等跳过 | ✅ |
| register-hooks.js settings.json 格式 | ✅ |

### 下一步

Task #34: 后端 — 日志策略与日志轮转

---

## Task #34: 后端 — 日志策略与日志轮转

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`server/services/logRotator.ts`** — 日志轮转工具
   - `rotateIfNeeded(filePath, options)`: 检查文件大小，超过 maxBytes（默认 50MB）时执行轮转
   - 轮转策略: `server.log` → `server.log.1` → ... → `server.log.5`（最多 5 个）
   - 超出 maxFiles 的旧文件自动删除
   - `FileLogger` 类: 封装文件日志写入 + 自动轮转，提供 info/warn/error 方法
   - `log(level, message)`: 同时输出到 console 和 server.log 文件
   - `rotateHooksLog()`: hooks.log 轮转入口

2. **`server/services/logRotator.test.ts`** — 10 个单元测试

### 验证结果

| 验证项 | 结果 |
|--------|------|
| rotateIfNeeded 基本场景 | ✅ 6 项 |
| FileLogger 功能 | ✅ 4 项 |
| 全部测试 (240) | ✅ |

### 下一步

Task #36: 前端 — REST API 客户端 — 基础封装与 Agent/Project API

---

## Task #35: 前端 — Vite + React + TypeScript 项目初始化

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`web/index.html`** — 添加 CSP meta 标签
   - `default-src 'self'`
   - `connect-src`: 允许 localhost:3456 和 localhost:5173 的 HTTP/WebSocket
   - `style-src 'self' 'unsafe-inline'`; `script-src 'self' 'unsafe-inline'`

2. **`web/src/main.tsx`** — 入口文件重构
   - 导入 `App` 组件（从独立文件）
   - 导入全局 CSS reset（`index.css`）

3. **`web/src/App.tsx`** — 根组件
   - 最小屏幕宽度检测：`window.innerWidth < 1280` 时显示提示
   - 监听 `resize` 事件动态响应
   - 基础布局结构：header + main

4. **`web/src/index.css`** — CSS Reset + 全局样式
   - 完整 box-sizing reset
   - 全局字体栈（系统字体）
   - `.screen-warning` 样式
   - `.app-header` 深色背景 + `.app-main` 弹性布局

5. **已有配置验证**
   - `vite.config.ts` proxy 配置已就绪（`/api` → :3456, `/ws` → ws://:3456）
   - `web/tsconfig.json` ES2022 + strict + react-jsx 已配置
   - `web/package.json` React 19 + Vite 6 + TypeScript 5.7 已配置

6. **清理**：删除 `components/.gitkeep`、`hooks/.gitkeep`、`api/.gitkeep` 占位文件

### 验证结果

| 验证项 | 结果 |
|--------|------|
| TypeScript 类型检查 (`tsc --noEmit`) | ✅ 无错误 |
| Vite 生产构建 (`vite build`) | ✅ 512ms，输出 3 个文件 |
| CSP meta 标签 | ✅ connect-src 包含 localhost |
| 屏幕宽度检测 | ✅ < 1280px 显示提示 |

### 下一步

Task #37: 前端 — WebSocket 客户端 Hook（useWebSocket.ts）

---

## Task #36: 前端 — REST API 客户端 — 基础封装与 Agent/Project API

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`web/src/types.ts`** — 前端共享 TypeScript 接口
   - 与后端 `server/store/types.ts` 对齐: `Project`, `Agent`, `AgentStats`, `AgentStatus`, `Task`, `TaskStatus`, `Event`, `EventType`, `HealthStatus`
   - WebSocket 类型: `WSMessageType`, `WSMessage<T>`
   - API 辅助类型: `PaginatedResponse<T>`, `CreateAgentData`, `UpdateAgentData`, `CreateProjectData`, `UpdateProjectData`, `CreateTaskData`, `UpdateTaskData`

2. **`web/src/api/client.ts`** — 完整 REST API 客户端
   - `ApiError` 类: 含 `code`, `message`, `status` 属性
   - `request<T>(method, path, body?)`: 基础 fetch 封装，自动处理 JSON/错误
   - Health API: `getHealth()`
   - Agent API: `getAgents`, `getAgent`, `createAgent`, `updateAgent`, `deleteAgent`, `getAgentStats`
   - Project API: `getProjects`, `createProject`, `updateProject`, `deleteProject`
   - Task API: `getTasks(queryOpts)`, `getTask`, `createTask`, `updateTask`, `deleteTask`
   - Task Actions: `startTask`, `stopTask`, `doneTask`, `messageTask`, `approveTool`, `retryTask`
   - Event API: `getTaskEvents`, `getTaskSdkStatus`

### 验证结果

| 验证项 | 结果 |
|--------|------|
| TypeScript 类型检查 | ✅ 无错误 |
| Vite 生产构建 | ✅ 501ms |
| 类型与后端对齐 | ✅ 完全匹配 |

### 下一步

Task #38: 前端 — 全局状态管理（Context + Reducer）

---

## Task #37: 前端 — WebSocket 客户端 Hook（useWebSocket.ts）

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`web/src/hooks/useWebSocket.ts`** — WebSocket 连接管理 Hook
   - 组件挂载时自动连接 `ws://localhost:3456/ws`
   - 指数退避重连: 初始延迟 1s，每次失败翻倍，最大 30s
   - 消息路由: 解析 JSON，根据 `type` 分发到对应回调
   - 支持 7 种消息类型: `task:update`, `agent:update`, `event:new`, `tool:approval`, `task:budget`, `notification`, `error`
   - 返回 `{ connected, reconnectCount }` 状态
   - 组件卸载时自动断开连接，阻止重连

### 验证结果

| 验证项 | 结果 |
|--------|------|
| TypeScript 类型检查 | ✅ |
| Vite 生产构建 | ✅ 503ms |

### 下一步

Task #39: 前端 — 整体三栏布局（App.tsx + 顶部栏 + 底部状态栏）

---

## Task #38: 前端 — 全局状态管理（Context + Reducer）

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`web/src/store/AppContext.tsx`** — 全局状态管理
   - `AppState` 接口: agents/tasks Map, projects 数组, selectedTaskId/selectedAgentId, notifications, wsConnected, activeProjectId, loading
   - `appReducer`: 处理 14 种 action（SET_LOADING, SET_AGENTS, UPDATE_AGENT, REMOVE_AGENT, SET_TASKS, UPDATE_TASK, REMOVE_TASK, SET_PROJECTS, SET_SELECTED_TASK, SET_SELECTED_AGENT, ADD_NOTIFICATION, DISMISS_NOTIFICATION, SET_WS_CONNECTED, SET_ACTIVE_PROJECT）
   - `Notification` 类型: id, type(info/warning/error/stuck), message, timestamp
   - `AppProvider`: 启动时并行加载 agents/tasks/projects API 数据，集成 useWebSocket 实时更新状态
   - `useAppState()` 和 `useAppDispatch()` hooks

2. **`web/src/App.tsx`** 更新
   - 用 `AppProvider` 包裹整个应用

### 验证结果

| 验证项 | 结果 |
|--------|------|
| TypeScript 类型检查 | ✅ |
| Vite 生产构建 | ✅ 516ms |
| Context + Reducer | ✅ 14 种 action |

### 下一步

Task #40: 前端 — AgentCard 组件

---

## Task #39: 前端 — 整体三栏布局（App.tsx + 顶部栏 + 底部状态栏）

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`web/src/App.tsx`** — 三栏布局框架
   - **TopBar (56px)**: 左侧 "Agent Swarm" 标题，右侧 Project 筛选下拉框（数据来自全局状态）
   - **MainLayout (flex row)**: 左栏 AgentPanel(240px) + 中栏 KanbanBoard(flex:1) + 右栏 DetailPanel(420px)
   - **StatusBar (32px)**: N Agents | N Running | Server 绿/红指示灯，断连显示"连接中断"
   - 左右栏折叠/展开按钮（width 0.2s transition）

2. **`web/src/index.css`** — 完整布局样式
   - `.app-root`: flex column, 100vh
   - `.panel-*`: 三栏 flex 布局，可折叠
   - `.status-bar`: 底部状态栏样式
   - `.status-dot`: 绿色/红色圆点指示灯
   - `.top-bar`: 深色顶部栏

### 验证结果

| 验证项 | 结果 |
|--------|------|
| TypeScript 类型检查 | ✅ |
| Vite 生产构建 | ✅ 533ms |
| 三栏布局 | ✅ 左240+中flex+右420 |
| 折叠/展开 | ✅ |
| 状态栏 | ✅ Agent/Running计数+连接状态 |

### 下一步

Task #42: 前端 — TaskCard 组件

---

## Task #40-#41: 前端 — AgentCard + AgentPanel 组件

**日期**: 2026-04-21
**状态**: ✅ 完成

### 完成内容

1. **`web/src/components/AgentCard.tsx`** — Agent 卡片组件
   - 左边缘 4px 状态色条: idle=#9CA3AF, working=#3B82F6, stuck=#F59E0B, offline=#6B7280
   - 状态动画: idle 呼吸灯, working 蓝色脉冲, stuck 橙色闪烁, offline 无动画
   - 显示: avatar(大号emoji), name, 状态文字标签, taskCount, lastEventAt 相对时间
   - 点击触发 onSelect，isSelected 时高亮背景

2. **`web/src/components/AgentPanel.tsx`** — Agent 列表面板
   - 从全局状态获取 agents Map，按状态排序(stuck > working > idle > offline)
   - 空状态: 图标 + 提示文字 + 创建按钮
   - "+ Agent" 按钮展开创建表单(name/role/prompt)
   - 调用 API 创建 Agent，更新全局状态

3. **`web/src/index.css`** — AgentCard + AgentPanel + 表单样式
   - 动画 keyframes: pulse-bar, blink-bar, breathe-bar
   - 按钮系统: btn-primary, btn-secondary, btn-small
   - 表单样式: form-label, form-input, form-textarea

4. **`web/src/App.tsx`** — 左栏集成 AgentPanel

### 验证结果

| 验证项 | 结果 |
|--------|------|
| TypeScript 类型检查 | ✅ |
| Vite 生产构建 | ✅ 516ms |
| AgentCard 状态色条+动画 | ✅ |
| AgentPanel 排序+创建 | ✅ |

### 下一步

Task #42: 前端 — TaskCard 组件
