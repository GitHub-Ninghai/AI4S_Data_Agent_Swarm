# AI4S Data Agent Swarm — 系统部署与 API 接口文档

> 文档版本：v1.0  
> 更新日期：2026-05-19  
> 项目仓库：https://github.com/GitHub-Ninghai/AI4S_Data_Agent_Swarm

---

## 目录

1. [系统概述与架构](#1-系统概述与架构)
2. [运行环境要求](#2-运行环境要求)
3. [Docker 部署](#3-docker-部署)
4. [源码运行](#4-源码运行)
5. [运行验证](#5-运行验证)
6. [日志与数据查看](#6-日志与数据查看)
7. [API 接口文档](#7-api-接口文档)
   - [7.1 通用规范](#71-通用规范)
   - [7.2 认证接口](#72-认证接口)
   - [7.3 健康检查](#73-健康检查)
   - [7.4 项目管理](#74-项目管理)
   - [7.5 Agent 管理](#75-agent-管理)
   - [7.6 Task 管理](#76-task-管理)
   - [7.7 文件上传](#77-文件上传)
   - [7.8 数据流水线](#78-数据流水线)
   - [7.9 Autodata 弱-强对抗](#79-autodata-弱-强对抗)
   - [7.10 Copilot](#710-copilot)
   - [7.11 Hook 事件接口](#711-hook-事件接口)
   - [7.12 World 接口](#712-world-接口)
   - [7.13 Capability 接口](#713-capability-接口)
   - [7.14 WebSocket](#714-websocket)
8. [组委会验证流程](#8-组委会验证流程)
9. [常见问题与排障](#9-常见问题与排障)

---

## 1. 系统概述与架构

### 1.1 系统简介

**AI4S Data Agent Swarm** 是一个本地部署的 Web 应用，用于管理和协调多个 AI Agent 完成 AI4S（AI for Science）数据合成任务。系统本身不实现 Agent 推理逻辑，而是通过 `@anthropic-ai/claude-agent-sdk` 调用 Claude Code 作为执行后端，将多个 Claude Code 会话包装为专业化 Agent，以看板界面呈现，支持任务分配、启动、进度跟踪、人工干预与取消。

### 1.2 典型场景

- **AI4S 数据合成**：爬取论文 → 解析 PDF → 合成 Q&A → 质量验证
- **代码审查流水线**：静态分析 → 自动修复 → 人工复审
- **文档批量生成**：模板填充 → 格式转换 → 质量检查

### 1.3 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                              │
│              React + Vite Single Page App                   │
│         http://localhost:3456  (Web UI)                     │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP REST + WebSocket
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Express Server (port 3456)                     │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ REST API │  │ WebSocket│  │ Hook API │  │ Static    │  │
│  │ /api/*   │  │ /ws      │  │ /event   │  │ Assets    │  │
│  └────┬─────┘  └──────────┘  └────┬─────┘  │ web/dist  │  │
│       │                            │        └───────────┘  │
│       ▼                            ▼                        │
│  ┌──────────────────────────────────────────────────┐      │
│  │              Services Layer                       │      │
│  │  taskManager │ sdkSessionManager │ eventProcessor │      │
│  │  stuckDetector │ wsBroadcaster │ copilotService  │      │
│  └──────────────────────┬───────────────────────────┘      │
│                         │ query()                           │
│                         ▼                                   │
│  ┌──────────────────────────────────────────────────┐      │
│  │         Claude Agent SDK                         │      │
│  │  @anthropic-ai/claude-agent-sdk                  │      │
│  └──────────────────────┬───────────────────────────┘      │
│                         │                                    │
└─────────────────────────┼────────────────────────────────────┘
                          │
                          ▼
              ┌──────────────────────┐
              │  Claude Code CLI     │
              │  (多个并发 Session)  │
              └──────────────────────┘
```

### 1.4 核心组件

| 组件 | 技术栈 | 说明 |
|------|--------|------|
| 后端 | Node.js 20 + Express + ws | REST API、WebSocket、SDK 会话管理 |
| 前端 | React 19 + Vite + TypeScript | 看板式管理界面 |
| 数据层 | JSON 文件存储 | data/agents.json, data/tasks.json 等 |
| 执行引擎 | Claude Agent SDK | 调用 Claude Code 执行 Agent 任务 |
| 容器化 | Docker + Docker Compose | 多阶段构建，生产部署 |

### 1.5 数据流

```
用户创建 Task
  → POST /api/tasks
  → Task 进入 Todo 状态
  → 用户点击"启动"
  → SDK query() 创建 Claude Code 会话
  → 实时事件流通过 WebSocket 推送到前端
  → Task 完成 → SDKResult → Done 状态
  → 输出文件写入项目工作目录

人工介入流程：
  → SDK canUseTool 回调等待审批
  → Task 进入 Stuck 状态
  → WebSocket 推送 tool:approval 事件
  → 用户批准/拒绝 → SDK resume → Task 恢复 Running
```

---

## 2. 运行环境要求

### 2.1 操作系统

| 平台 | 支持情况 | 备注 |
|------|---------|------|
| Linux x86_64 | ✅ 推荐 | Ubuntu 22.04 / Debian 12 已验证 |
| macOS (Intel/Apple Silicon) | ✅ 支持 | 通过 Docker Desktop |
| Windows 10/11 | ✅ 支持 | 通过 Docker Desktop + WSL2 |

### 2.2 基础软件（Docker 方式）

| 软件 | 最低版本 | 说明 |
|------|---------|------|
| Docker Engine | 24+ | 容器运行时 |
| Docker Compose | v2 | 容器编排（已集成在 Docker CLI 中） |

### 2.3 基础软件（源码方式）

| 软件 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | 18+ | 运行时 |
| npm | 9+ | 包管理器 |
| Claude Code CLI | 最新 | Agent 执行后端（可选，用于 Agent 任务执行） |

### 2.4 硬件资源

| 配置 | 最低要求 | 推荐配置 | 说明 |
|------|---------|---------|------|
| CPU | 2 核 | 4 核+ | 基础 CRUD 操作资源需求低；Agent 任务执行时需更多 CPU |
| 内存 | 4 GB | 8 GB+ | Agent 任务并发执行时内存消耗增加 |
| 磁盘 | 10 GB | 20 GB+ | 用于存储项目文件、上传的 PDF 和生成的训练数据 |
| 网络 | 公网访问 | 稳定带宽 | Agent 任务和 PDF 解析需调用外部模型 API |

> **说明**：基础界面浏览、健康检查、项目/Agent/Task 管理等 CRUD 操作对资源的要求较低。Agent 实际执行任务、Copilot 对话或 MinerU PDF 解析时，依赖外部模型 API，会增加 CPU、内存与网络开销。

### 2.5 环境变量

#### 核心变量

| 变量名 | 默认值 | 必填 | 说明 |
|--------|--------|------|------|
| `PORT` | `3456` | 否 | 服务监听端口 |
| `HOST` | `127.0.0.1` | 否 | 服务监听地址；Docker 部署建议设为 `0.0.0.0` |
| `MAX_CONCURRENT_TASKS` | `10` | 否 | 系统最大并发任务数 |
| `MAX_WS_CLIENTS` | `10` | 否 | WebSocket 最大连接数 |
| `TOOL_APPROVAL_TIMEOUT_MS` | `300000` | 否 | 工具审批超时（毫秒），超时自动拒绝 |
| `USER_MESSAGE_TIMEOUT_MS` | `1800000` | 否 | 用户消息等待超时（毫秒） |

#### 模型 API 变量

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `ANTHROPIC_AUTH_TOKEN` | 否* | Anthropic API Token（与 API_KEY 二选一） |
| `ANTHROPIC_API_KEY` | 否* | 模型 API Key（支持 DeepSeek、OpenAI 等第三方） |
| `ANTHROPIC_BASE_URL` | 否 | 模型服务基地址 |
| `ANTHROPIC_MODEL` | 否 | 主模型名（如 `deepseek-chat`） |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 否 | 备选模型名 |
| `COPILOT_MODEL` | 否 | Copilot 模型名，默认 `glm-5` |
| `API_TIMEOUT_MS` | 否 | API 调用超时（毫秒），默认 `600000` |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | 否 | 设为 `1` 可减少 Claude Code 非必要网络流量 |

> *Agent/Copilot 执行时需要配置；纯界面和 CRUD 验证无需。

#### PDF 解析变量

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `MINERU_TOKEN` | 否* | MinerU Open API Token |
| `MINERU_API_KEY` | 否* | MinerU API Key（与 TOKEN 等价） |

> *仅在使用 MinerU PDF 解析流水线时需要。

#### Windows 特有

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `CLAUDE_CODE_GIT_BASH_PATH` | 否 | Git Bash 路径，如 `D:\Git\bin\bash.exe`；macOS/Linux 可忽略 |

---

## 3. Docker 部署

### 3.1 准备

```bash
# 克隆仓库
git clone https://github.com/GitHub-Ninghai/AI4S_Data_Agent_Swarm.git
cd AI4S_Data_Agent_Swarm

# 创建环境变量文件
cp .env.example .env
# 编辑 .env 填入需要的变量（API Key 等）

# 创建工作目录
mkdir -p workspace
```

### 3.2 构建镜像

```bash
# 基本构建
docker build -t ai4s-data-agent-swarm:latest .

# 国内用户使用 npm 镜像加速
docker build -t ai4s-data-agent-swarm:latest \
  --build-arg NPM_REGISTRY=https://registry.npmmirror.com .
```

构建说明：

- 使用 Node.js 20 (bookworm-slim) 多阶段构建
- 第一阶段：安装依赖 + TypeScript 编译 + Vite 前端构建
- 第二阶段：仅复制运行产物，极小化镜像体积
- Web 前端构建跳过 `tsc -b` 类型检查（预存 TS 错误不阻塞 Docker 构建，类型检查在独立 CI 中处理）

### 3.3 启动服务

```bash
docker compose up --build -d
```

启动后访问：**http://localhost:3456**

### 3.4 服务管理

```bash
# 查看运行状态
docker compose ps

# 查看日志
docker compose logs -f

# 停止服务
docker compose down

# 重启服务
docker compose restart
```

### 3.5 挂载目录

| 宿主机目录 | 容器内目录 | 作用 |
|-----------|-----------|------|
| `./data` | `/app/data` | 系统持久化数据、事件流、日志 |
| `./workspace` | `/workspace` | 项目工作目录、上传文件、论文文件等 |

> **注意**：创建项目时 `path` 必须为容器内绝对路径（如 `/workspace`），系统会校验路径是否存在。

### 3.6 镜像架构参考

```text
docker-compose.yml
  │
  └── service: ai4s-data-agent-swarm
        ├── build: . (Dockerfile)
        ├── ports: 3456:3456
        ├── volumes: ./data → /app/data
        │             ./workspace → /workspace
        ├── env_file: .env
        └── restart: unless-stopped
```

> Screenshot placeholder: ![Docker 部署架构](screenshots/docker-architecture.png)
> *图：Docker 部署架构示意图*

### 3.7 Health Check

Dockerfile 内置了 HEALTHCHECK 指令，每 30s 检查 `/api/health` 端点，连续 3 次失败则标记容器不健康。可通过 `docker inspect` 查看健康状态。

---

## 4. 源码运行

### 4.1 环境准备

```bash
# 安装 Node.js 18+（推荐使用 nvm）
nvm install 20
nvm use 20

# 克隆仓库
git clone https://github.com/GitHub-Ninghai/AI4S_Data_Agent_Swarm.git
cd AI4S_Data_Agent_Swarm

# 配置环境变量
cp .env.example .env
```

### 4.2 安装依赖

```bash
# 后端
cd server && npm install && cd ..

# 前端
cd web && npm install && cd ..

# 创建工作目录
mkdir -p workspace
```

### 4.3 启动服务

```bash
# 启动后端（开发模式，自动监听变更）
cd server && npx tsx watch index.ts

# 新开终端，启动前端开发服务器（可选，热更新）
cd web && npm run dev
```

后端启动后：**http://localhost:3456**（生产构建）  
前端开发服务器：**http://localhost:5173**（热更新模式，需代理到后端）

### 4.4 生产构建

```bash
# 后端编译
cd server && npm run build

# 前端构建（跳过 tsc -b）
cd web && npx vite build

# 启动
cd server && node dist/index.js
```

---

## 5. 运行验证

### 5.1 基础可用性验证

#### 5.1.1 访问 Web UI

打开浏览器访问 `http://localhost:3456`，应看到系统主界面。

> Screenshot placeholder: ![系统首页](screenshots/00-landing-page.png)
> *图：系统首页 / 登录页面*

进入系统：

> Screenshot placeholder: ![登录页面](screenshots/auth-login.png)
> *图：系统登录页面*

填写默认管理员账号登录：

> Screenshot placeholder: ![登录信息填写](screenshots/auth-login-filled.png)
> *图：登录信息填写*

登录成功后进入主界面：

> Screenshot placeholder: ![系统主界面](screenshots/01-homepage.png)
> *图：系统主界面 — Agent 面板、看板、详情面板三栏布局*

#### 5.1.2 Health Check

```bash
curl http://localhost:3456/api/health
```

预期响应：

```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 12.345,
  "activeTaskCount": 0,
  "maxConcurrentTasks": 10,
  "storageOk": true
}
```

### 5.2 认证与业务接口验证

```bash
# 1. 获取 Token
TOKEN=$(curl -s -X POST http://localhost:3456/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"admin","password":"admin123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

echo "Token: $TOKEN"

# 2. 创建项目
curl -X POST http://localhost:3456/api/projects \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"demo-project","path":"/workspace","description":"demostration project"}'

# 3. 查询项目列表
curl http://localhost:3456/api/projects -H "Authorization: Bearer $TOKEN"

# 4. 查询 Agent 列表
curl http://localhost:3456/api/agents -H "Authorization: Bearer $TOKEN"

# 5. 查询 Task 列表
curl http://localhost:3456/api/tasks -H "Authorization: Bearer $TOKEN"
```

### 5.3 前端功能验证

依次验证以下功能点：

1. **Project 选择**：顶部栏右侧下拉框切换项目

   > Screenshot placeholder: ![Project 下拉选择](screenshots/project-dropdown.png)
   > *图：Project 筛选器*

2. **创建 Agent**：点击"创建 Agent"按钮，填写表单

   > Screenshot placeholder: ![创建 Agent 弹窗](screenshots/create-agent-modal.png)
   > *图：创建 Agent 表单*

3. **创建 Task**：在看板中创建新 Task

   > Screenshot placeholder: ![创建 Task 弹窗](screenshots/06-create-task.png)
   > *图：创建 Task 表单*

4. **Agent 详情**：点击左侧 Agent 卡片查看详情

   > Screenshot placeholder: ![Agent 详情面板](screenshots/08-agent-detail.png)
   > *图：Agent 详情面板*

5. **Copilot**：使用 Copilot 对话功能

   > Screenshot placeholder: ![Copilot 界面](screenshots/10-copilot.png)
   > *图：Copilot 对话界面*

6. **用户中心**：右上角用户菜单

   > Screenshot placeholder: ![用户菜单](screenshots/user-dropdown.png)
   > *图：用户下拉菜单*

   > Screenshot placeholder: ![个人信息弹窗](screenshots/user-profile-modal.png)
   > *图：个人信息编辑*

7. **Agent 大厅**：可视化 Agent 状态

   > Screenshot placeholder: ![Agent 大厅](screenshots/大厅.jpg)
   > *图：Agent 大厅可视化界面*

### 5.4 自动化测试（源码环境）

```bash
cd server && npx vitest run
```

测试范围包括：

| 测试文件 | 覆盖内容 |
|---------|---------|
| `routes/agents.test.ts` | Agent CRUD API |
| `routes/tasks.test.ts` | Task CRUD API |
| `routes/taskActions.test.ts` | Task 启动/停止/完成等操作 |
| `routes/taskEvents.test.ts` | Task 事件查询 |
| `routes/projects.test.ts` | Project CRUD API |
| `routes/events.test.ts` | Hook 事件处理 |

---

## 6. 日志与数据查看

### 6.1 容器日志

```bash
# 实时查看日志
docker compose logs -f

# 查看最近 100 行
docker compose logs --tail=100
```

### 6.2 持久化数据目录

```text
data/
├── agents.json              # Agent 元数据
├── tasks.json               # Task 元数据（含任务描述、状态、输出摘要）
├── sessions.json            # SDK 会话映射
├── projects.json            # 项目元数据
├── events/
│   ├── <task-id>.jsonl      # 任务实时事件流（JSONL 格式，按行追加）
│   └── <task-id>.jsonl.gz   # 归档事件（超过 100MB 时压缩）
├── logs/
│   └── hooks.log            # Hook 原始日志（补充通道）
├── uploads_tmp/             # 文件上传临时目录
└── projects/                # 自动创建的项目目录（当 path 未指定时）
```

### 6.3 常用查看命令

```bash
# 查看 Task 列表
cat data/tasks.json | python3 -m json.tool

# 查看指定 Task 的事件流
cat data/events/<task-id>.jsonl | head -100

# 实时监控 Hook 日志
tail -f data/logs/hooks.log

# 统计事件文件大小
ls -lah data/events/

# 查看项目数据
cat data/projects.json | python3 -m json.tool
```

### 6.4 日志分析

| 信息源 | 查看方式 | 用途 |
|--------|---------|------|
| `docker compose logs` | 标准输出 | Server 运行日志、错误堆栈、启动信息 |
| `data/logs/hooks.log` | JSONL 文件 | Claude Hook 原始事件记录 |
| `data/events/*.jsonl` | JSONL 文件 | 每个 Task 的详细执行事件 |
| `data/tasks.json` | JSON 文件 | Task 元数据和最终输出摘要 |
| `workspace/` | 文件系统 | Agent 执行生成的所有输出文件 |

---

## 7. API 接口文档

### 7.1 通用规范

#### 7.1.1 Base URL

```
http://localhost:3456
```

所有 API 请求以 `/api/` 为前缀（Hook 事件接口除外，为 `/event`）。

#### 7.1.2 认证方式

**JWT Bearer Token 认证**。

除以下接口外，所有业务接口均需认证：

| 接口 | 路径 | 认证要求 |
|------|------|---------|
| 健康检查 | `GET /api/health` | ❌ 无需认证 |
| 用户注册 | `POST /api/auth/register` | ❌ 无需认证 |
| 用户登录 | `POST /api/auth/login` | ❌ 无需认证 |
| Hook 事件 | `POST /event` | ❌ 无需认证 |
| 所有业务接口 | `/api/*` | ✅ 需 Bearer Token |

**请求头格式**：

```
Authorization: Bearer <token>
```

**Token 获取**：

```bash
curl -X POST http://localhost:3456/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"admin","password":"admin123"}'
```

Token 有效期：7 天（可通过 `JWT_SECRET` 环境变量自定义签名密钥）。

#### 7.1.3 请求 Content-Type

- 非文件上传：`application/json`
- 文件上传：`multipart/form-data`

#### 7.1.4 成功响应格式

```json
{
  "code": 0,
  "data": { ... },
  "message": "ok",
  "timestamp": 1716000000000
}
```

或简化格式（取决于具体接口）：

```json
{ "projects": [...] }
{ "task": { ... } }
{ "ok": true }
```

#### 7.1.5 错误响应格式

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {}
  }
}
```

#### 7.1.6 通用错误码

| HTTP 状态码 | 错误码 | 场景 |
|------------|--------|------|
| 400 | `VALIDATION_ERROR` | 请求参数格式错误、缺少必填字段 |
| 401 | `UNAUTHORIZED` | 未提供 Token 或 Token 无效 |
| 403 | `FORBIDDEN` | 权限不足（非管理员操作管理员接口） |
| 404 | `*_NOT_FOUND` | 资源不存在（AGENT/TASK/PROJECT 等） |
| 409 | `TASK_ALREADY_RUNNING` | 尝试启动已在运行的 Task |
| 409 | `AGENT_BUSY` | Agent 正在执行其他任务 |
| 409 | `RESOURCE_HAS_DEPENDENTS` | 删除有关联资源的项目/Agent |
| 500 | `INTERNAL_ERROR` | 服务器内部错误 |

---

### 7.2 认证接口

#### 7.2.1 用户注册

```
POST /api/auth/register
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `email` | string | 是 | 邮箱，作为登录账号 |
| `password` | string | 是 | 密码，至少 6 位 |
| `name` | string | 否 | 显示名称，默认取 email 的 @ 前部分 |

**响应**：

```json
{
  "code": 0,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "uuid",
      "name": "用户名",
      "email": "user@example.com",
      "avatar": null,
      "role": "user",
      "createdAt": 1716000000000
    }
  },
  "message": "ok",
  "timestamp": 1716000000000
}
```

#### 7.2.2 用户登录

```
POST /api/auth/login
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `account` | string | 是 | 登录账号（即 email） |
| `password` | string | 是 | 密码 |

**响应**：同注册接口。

> **默认管理员账号**：`admin` / `admin123`（首次启动时自动创建，role 为 `admin`）

#### 7.2.3 用户登出

```
POST /api/auth/logout
```

**响应**：

```json
{ "code": 0, "data": null, "message": "ok", "timestamp": 1716000000000 }
```

#### 7.2.4 获取个人信息

```
GET /api/user/profile
```

**响应**：

```json
{
  "code": 0,
  "data": {
    "id": "uuid",
    "name": "指挥员",
    "email": "admin",
    "avatar": "/images/avatar-default.png",
    "role": "系统管理员",
    "createdAt": 1716000000000
  },
  "message": "ok",
  "timestamp": 1716000000000
}
```

#### 7.2.5 修改个人信息

```
PUT /api/user/profile
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 否 | 新显示名称 |
| `avatar` | string | 否 | 新头像 URL |

**响应**：同个人信息查询。

---

### 7.3 健康检查

```
GET /api/health
```

**认证**：无需

**响应**：

```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 12.345,
  "activeTaskCount": 0,
  "maxConcurrentTasks": 10,
  "storageOk": true
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | 服务状态，"ok" 表示正常 |
| `version` | string | 系统版本号 |
| `uptime` | number | 服务运行秒数 |
| `activeTaskCount` | number | 当前运行中/卡住的任务数 |
| `maxConcurrentTasks` | number | 最大并发任务数配置 |
| `storageOk` | boolean | 存储是否正常 |

---

### 7.4 项目管理

#### 7.4.1 项目列表

```
GET /api/projects
```

**响应**：

```json
{
  "projects": [
    {
      "id": "uuid",
      "name": "my-project",
      "path": "/workspace",
      "description": "AI4S data synthesis project",
      "createdAt": 1716000000000,
      "updatedAt": 1716000000000
    }
  ]
}
```

#### 7.4.2 创建项目

```
POST /api/projects
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 项目名称，仅允许 `[a-zA-Z0-9_-]` |
| `path` | string | 否 | 绝对路径（容器内），默认为 `data/projects/{name}` |
| `description` | string | 否 | 项目描述 |

> `path` 如指定，必须是已存在的目录；不指定则自动创建 `data/projects/{name}` 目录。

**响应**：

```json
{
  "project": {
    "id": "uuid",
    "name": "my-project",
    "path": "/workspace",
    "description": "...",
    "createdAt": 1716000000000,
    "updatedAt": 1716000000000
  }
}
```

#### 7.4.3 更新项目

```
PUT /api/projects/:id
```

**请求体**（至少一个字段）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 否 | 新项目名称 |
| `path` | string | 否 | 新工作目录路径 |
| `description` | string | 否 | 新描述 |

#### 7.4.4 删除项目

```
DELETE /api/projects/:id
```

**约束**：项目下有 Running/Stuck 状态的任务时返回 409 Conflict。

**响应**：

```json
{ "ok": true }
```

---

### 7.5 Agent 管理

Agent 是系统的核心实体——一个"数字员工"。每个 Agent 由自定义系统提示词（prompt）和资源配置定义，不包含推理逻辑。

#### 7.5.1 Agent 列表

```
GET /api/agents
```

**响应**：

```json
{
  "agents": [
    {
      "id": "uuid",
      "name": "PDF 解析专家",
      "avatar": "📄",
      "role": "负责解析论文 PDF 为结构化数据",
      "prompt": "你是一个专业的 PDF 解析专家...",
      "isEnabled": true,
      "status": "idle",
      "projectId": null,
      "currentTaskId": null,
      "maxTurns": 200,
      "maxBudgetUsd": 5.0,
      "allowedTools": ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "WebFetch"],
      "hasApiKey": false,
      "apiKey": "",
      "model": "",
      "provider": "",
      "apiBaseUrl": "",
      "taskCount": 0,
      "stats": {
        "totalTasksCompleted": 0,
        "totalTasksCancelled": 0,
        "totalCostUsd": 0,
        "avgDurationMs": 0
      },
      "lastEventAt": 0,
      "createdAt": 1716000000000,
      "updatedAt": 1716000000000
    }
  ]
}
```

> **安全说明**：返回的 Agent 列表中 `apiKey` 字段已脱敏（仅显示末 4 位），`hasApiKey` 指示是否配置了 Key。

#### 7.5.2 创建 Agent

```
POST /api/agents
```

**请求体**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `name` | string | 是 | - | 名称，1-50 字符 |
| `avatar` | string | 是 | - | 头像 emoji，非空 |
| `role` | string | 是 | - | 角色描述，1-200 字符 |
| `prompt` | string | 是 | - | 系统提示词，10-15000 字符 |
| `projectId` | string | 否 | null | 默认关联项目 |
| `maxTurns` | number | 否 | 200 | 最大对话轮次 |
| `maxBudgetUsd` | number | 否 | 5.0 | 预算上限（美元） |
| `allowedTools` | string[] | 否 | 全部 | 允许的工具列表 |
| `model` | string | 否 | "" | 使用的模型名 |
| `provider` | string | 否 | "" | 模型提供商 |
| `apiKey` | string | 否 | "" | 模型 API Key |
| `apiBaseUrl` | string | 否 | "" | 模型服务地址 |

**Agent 状态流转**：

```
创建 → idle
idle → working（Task 开始执行）
working → stuck（需要人工介入）
stuck → working（用户恢复）
working → idle（Task 完成）
idle → offline（手动停用）
offline → idle（手动启用）
```

**响应**：包含新创建的 Agent 对象。

#### 7.5.3 获取 Agent 详情

```
GET /api/agents/:id
```

**响应**：

```json
{ "agent": { ... } }
```

#### 7.5.4 更新 Agent

```
PUT /api/agents/:id
```

**请求体**支持部分更新。特殊处理：

- `apiKey` 为 `""` → 清空 Key
- `apiKey` 以 `"****"` 开头 → 保持现有 Key（前端脱敏占位符）
- `isEnabled` → 触发 Agent 状态迁移

#### 7.5.5 Agent 统计

```
GET /api/agents/:id/stats
```

**响应**：

```json
{
  "totalTasksCompleted": 5,
  "totalTasksCancelled": 1,
  "totalCostUsd": 2.5,
  "avgDurationMs": 120000,
  "recentTasks": [
    { "id": "...", "title": "...", "status": "Done", ... }
  ]
}
```

#### 7.5.6 删除 Agent

```
DELETE /api/agents/:id
```

**约束**：有 Running/Stuck 任务时返回 409 Conflict。

**响应**：

```json
{ "ok": true }
```

#### 7.5.7 启用 Agent

```
POST /api/agents/:id/start
```

#### 7.5.8 停用 Agent

```
POST /api/agents/:id/stop
```

#### 7.5.9 测试模型连接

```
POST /api/agents/test-connection
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 否* | 模型名称 |
| `apiKey` | string | 否 | API Key |
| `apiBaseUrl` | string | 否* | 模型服务地址 |

> `model` 和 `apiBaseUrl` 至少提供一个。

**响应**：

```json
{ "ok": true, "model": "deepseek-chat", "message": "连接成功: deepseek-chat" }
```

或失败：

```json
{ "ok": false, "error": "认证失败 (401): API Key 无效或已过期" }
```

---

### 7.6 Task 管理

Task 是用户的核心操作对象——它是可独立验证的工作单元。一个 Task 指派给一个 Agent，通过 SDK 会话执行。

#### 7.6.1 Task 状态机

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│    ┌──────┐    start     ┌─────────┐   SDK Result   ┌────┐ │
│    │ Todo │─────────────▶│ Running │───────────────▶│Done│ │
│    └──┬───┘              └────┬────┘                └────┘ │
│       │                      │                              │
│       │                  canUseTool                         │
│       │                  拦截/超时                           │
│       │                      ▼                              │
│       │                  ┌──────┐   resume   ┌─────────┐   │
│       │                  │Stuck │───────────▶│ Running │   │
│       │                  └──┬───┘            └─────────┘   │
│       │                     │                               │
│       │                     ▼                               │
│       │                 ┌──────────┐                        │
│       └────────────────▶│Cancelled │                        │
│                         └──────────┘                        │
│  cancel (任意状态)                                           │
└─────────────────────────────────────────────────────────────┘
```

#### 7.6.2 Task 列表

```
GET /api/tasks
```

**查询参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `projectId` | string | - | 按项目过滤 |
| `status` | string | - | 按状态过滤（逗号分隔多值，如 `Todo,Running`） |
| `agentId` | string | - | 按 Agent 过滤 |
| `q` | string | - | 关键词搜索（匹配 title + description） |
| `page` | number | 1 | 页码 |
| `limit` | number | 20 | 每页条数（最大 100） |
| `includeDeleted` | boolean | false | 是否包含软删除的 Task |

**响应**：

```json
{
  "tasks": [
    {
      "id": "uuid",
      "title": "示例任务",
      "description": "[Project Working Directory]\n/workspace\n\n这是任务的详细描述",
      "status": "Todo",
      "agentId": "agent-uuid",
      "projectId": "project-uuid",
      "sessionId": null,
      "parentTaskId": null,
      "output": null,
      "completedReason": null,
      "priority": 1,
      "tags": ["eval"],
      "eventCount": 0,
      "turnCount": 0,
      "budgetUsed": 0,
      "maxTurns": 200,
      "maxBudgetUsd": 5.0,
      "deletedAt": null,
      "createdAt": 1716000000000,
      "startedAt": null,
      "completedAt": null,
      "stuckReason": null
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20,
  "totalPages": 1
}
```

> **注意**：`description` 字段在创建时自动注入 `[Project Working Directory]` 前缀，指向项目工作目录，确保 Agent 知道输出文件写入位置。

#### 7.6.3 创建 Task

```
POST /api/tasks
```

**请求体**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `title` | string | 是 | - | 标题，1-100 字符 |
| `description` | string | 是 | - | 描述，10-10000 字符 |
| `agentId` | string | 是 | - | 指派 Agent ID |
| `projectId` | string | 是 | - | 所属项目 ID |
| `priority` | number | 否 | 1 | 优先级 0(低)/1(中)/2(高)/3(紧急) |
| `tags` | string[] | 否 | [] | 标签列表 |
| `maxTurns` | number | 否 | 继承 Agent 配置 | 最大轮次 |
| `maxBudgetUsd` | number | 否 | 继承 Agent 配置 | 预算上限 |
| `pipelineType` | string | 否 | - | 流水线类型（qa/scievo） |
| `inputFiles` | string[] | 否 | - | 输入文件列表 |

#### 7.6.4 获取 Task 详情

```
GET /api/tasks/:id
```

#### 7.6.5 更新 Task

```
PUT /api/tasks/:id
```

**编辑规则**：

| 字段 | Todo | Running/Stuck | Done/Cancelled |
|------|------|---------------|----------------|
| title / description | ✅ | ✅（不影响运行） | ❌ |
| agentId | ✅ | ❌ | ❌ |
| projectId | ✅ | ❌ | ❌ |
| priority / tags | ✅ | ✅ | ✅ |
| maxTurns / maxBudgetUsd | ✅ | ⚠️ 仅可提高 | ❌ |

#### 7.6.6 删除 Task

```
DELETE /api/tasks/:id
```

**删除规则**：

| 状态 | 处理方式 |
|------|---------|
| Todo / Cancelled | 硬删除（直接删除记录和事件文件） |
| Done | 软删除（添加 `deletedAt` 时间戳） |
| Running / Stuck | 返回 409 Conflict |

#### 7.6.7 启动 Task

```
POST /api/tasks/:id/start
```

启动流程：
1. 验证 Agent 状态为 idle
2. 调用 SDK `query()` 创建 Claude Code 会话
3. 绑定 session_id → Task
4. Task → Running，Agent → working
5. 开始消费 SDK 消息流并生成事件

#### 7.6.8 停止 Task

```
POST /api/tasks/:id/stop
```

中止 SDK 消息流，Task → Cancelled。

#### 7.6.9 标记完成

```
POST /api/tasks/:id/done
```

用户手动将 Task 标记为完成。

#### 7.6.10 发送消息（恢复 Stuck Task）

```
POST /api/tasks/:id/message
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | string | 是 | 发送给 Agent 的消息文本 |
| `allowTool` | object | 否 | 附带工具审批决策 |
| `allowTool.decision` | string | 是 | `"allow"` 或 `"deny"` |

调用 SDK `resume` 恢复会话，Task → Running。

#### 7.6.11 批准/拒绝工具调用

```
POST /api/tasks/:id/approve-tool
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `decision` | string | 是 | `"allow"` 或 `"deny"` |

#### 7.6.12 重试 Task

```
POST /api/tasks/:id/retry
```

创建一个新 Task，复制原 Task 的配置（title 追加 "(重试)"），`parentTaskId` 指向原 Task。

#### 7.6.13 查询 Task 事件

```
GET /api/tasks/:id/events
```

**查询参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `page` | number | 1 | 页码 |
| `limit` | number | 50 | 每页条数（最大 200） |
| `type` | string | - | 按事件类型过滤 |

**事件类型**：

| 类型 | 来源 | 说明 |
|------|------|------|
| `SDKInit` | SDK | 会话初始化，含 session_id |
| `SDKAssistant` | SDK | 助手消息（工具调用、文本输出） |
| `SDKResult` | SDK | 任务完成/失败 |
| `SessionStart` | Hook | 会话启动 |
| `PreToolUse` | Hook | 工具调用前 |
| `PostToolUse` | Hook | 工具调用后 |
| `Stop` | Hook | Agent 停止 |
| `UserPromptSubmit` | Hook | 用户提交消息 |
| `Notification` | Hook | 系统通知 |

**响应**：

```json
{
  "events": [
    {
      "id": "event-uuid",
      "taskId": "task-uuid",
      "sessionId": "session-uuid",
      "eventType": "PreToolUse",
      "source": "sdk",
      "toolName": "Read",
      "toolInput": "{\"filePath\": \"...\"}",
      "toolOutput": "[文件内容摘要]",
      "duration": 1234,
      "timestamp": 1716000000000,
      "raw": "{\"原始数据\": ...}"
    }
  ],
  "total": 150,
  "page": 1,
  "limit": 50,
  "totalPages": 3
}
```

#### 7.6.14 查询 SDK 运行状态

```
GET /api/tasks/:id/sdk-status
```

**响应**：

```json
{
  "running": true,
  "turnCount": 15,
  "budgetUsed": 1.23,
  "maxBudgetUsd": 5.0
}
```

---

### 7.7 文件上传

#### 7.7.1 上传文件

```
POST /api/files/upload
```

**请求格式**：`multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `projectId` | string | 是 | 所属项目 ID |
| `files` | File[] | 是 | PDF 文件，最多 20 个，单文件最大 200MB |

**约束**：仅支持 PDF 文件。

**响应**：

```json
{
  "files": [
    {
      "id": "file-uuid",
      "name": "paper.pdf",
      "path": "/workspace/uploads/uuid_paper.pdf",
      "relativePath": "uploads/uuid_paper.pdf",
      "size": 2048576,
      "uploadedAt": 1716000000000
    }
  ]
}
```

文件存储于项目目录的 `uploads/` 子目录下。

#### 7.7.2 项目文件列表

```
GET /api/files/:projectId
```

列出项目 `uploads/` 和 `papers/` 目录下的所有 PDF 文件。

#### 7.7.3 删除文件

```
DELETE /api/files/:projectId/:fileId
```

---

### 7.8 数据流水线

数据流水线将多个 Task 串联为预设工作流，自动为每个步骤查找对应名称的 Agent 并创建 Task。

#### 7.8.1 创建流水线

```
POST /api/pipeline/create
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `pipelineType` | string | 是 | `"qa"` 或 `"scievo"` |
| `projectId` | string | 是 | 目标项目 ID |
| `pdfFiles` | string[] | 是 | PDF 文件路径列表 |
| `maxTurns` | number | 否 | 覆盖默认 maxTurns |
| `maxBudgetUsd` | number | 否 | 覆盖默认预算上限 |

**流水线模板**：

**QA 流水线（3 步骤）**：

| 步骤 | Agent 名称 | 任务 | maxTurns |
|------|-----------|------|----------|
| 1 | PDF 解析专家 | 使用 MinerU 解析 PDF 为结构化 JSON | 150 |
| 2 | 数据合成专家 | 生成 Q&A 训练数据、三元组、摘要 | 200 |
| 3 | 质检专家 | 格式检查、事实验证、去重、标签校验 | 100 |

**Sci-Evo 流水线（2 步骤）**：

| 步骤 | Agent 名称 | 任务 | maxTurns |
|------|-----------|------|----------|
| 1 | PDF 解析专家 | 使用 MinerU 解析 PDF 为结构化 JSON | 150 |
| 2 | Sci-Evo 生成专家 | 生成科学演化三段式 JSON 数据 | 150 |

**响应**：

```json
{
  "pipeline": {
    "type": "qa",
    "projectId": "project-uuid",
    "pdfFiles": ["uploads/paper1.pdf"],
    "tasks": [
      { "id": "task-1", "title": "PDF 解析", ... },
      { "id": "task-2", "title": "Q&A 数据合成", ... },
      { "id": "task-3", "title": "数据质检", ... }
    ]
  }
}
```

> **注意**：流水线要求系统中存在对应名称的 Agent（PDF 解析专家、数据合成专家、质检专家、Sci-Evo 生成专家），否则创建失败。

---

### 7.9 Autodata 弱-强对抗

提供弱-强对抗验证的自动化数据流水线。通过 Challenger（挑战者）生成问题，Weak Solver（弱求解器）和 Strong Solver（强求解器）分别解答，Judge（裁判）评估回答质量，多轮迭代。

#### 7.9.1 创建 Autodata 流水线

```
POST /api/autodata/create
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `projectId` | string | 是 | 项目 ID |
| `inputFiles` | string[] | 是 | 输入文件路径 |
| `maxRounds` | number | 否 | 最大迭代轮数（1-20，默认 5） |
| `challenger` | object | 是 | 挑战者模型配置 |
| `weakSolver` | object | 是 | 弱求解器模型配置 |
| `strongSolver` | object | 是 | 强求解器模型配置 |
| `judge` | object | 是 | 裁判模型配置 |

每个模型配置：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是 | 模型名称 |
| `apiKey` | string | 是 | API Key |
| `apiBaseUrl` | string | 是 | 服务基地址 |

**约束**：Challenger 和 Judge 不能使用相同的 model + apiKey 组合。

**响应**：

```json
{
  "group": {
    "id": "group-uuid",
    "projectId": "project-uuid",
    "status": "running",
    "rounds": [...],
    "createdAt": 1716000000000
  },
  "firstTaskId": "task-uuid"
}
```

#### 7.9.2 Autodata 迭代组列表

```
GET /api/autodata/groups
```

#### 7.9.3 Autodata 迭代组详情

```
GET /api/autodata/groups/:id
```

返回每轮次的 Task 状态摘要。

#### 7.9.4 重试 Autodata 组

```
POST /api/autodata/groups/:id/retry
```

---

### 7.10 Copilot

Copilot 是面向任务的 AI 助手，支持多轮对话和操作执行。

#### 7.10.1 创建会话

```
POST /api/copilot/session
```

**响应**：

```json
{ "sessionId": "session-uuid" }
```

#### 7.10.2 删除会话

```
DELETE /api/copilot/session/:id
```

#### 7.10.3 发送聊天消息

```
POST /api/copilot/chat
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | 否 | 会话 ID（不提供则自动创建） |
| `message` | string | 是 | 用户消息 |

**响应**：

```json
{
  "sessionId": "session-uuid",
  "message": "Copilot 的回复文本",
  "actions": [
    {
      "type": "createAgent",
      "params": { "name": "新 Agent", ... },
      "description": "创建一个新 Agent"
    }
  ],
  "needsConfirmation": true
}
```

当 `needsConfirmation` 为 `true` 时，前端应展示操作确认界面，用户确认后调用 `/api/copilot/confirm`。

#### 7.10.4 确认操作

```
POST /api/copilot/confirm
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | 是 | 会话 ID |
| `actionIndex` | number | 是 | 操作列表中的索引 |
| `confirmed` | boolean | 是 | 是否确认 |

---

### 7.11 Hook 事件接口

用于接收 Claude Hook 事件的补充通道。路径无 `/api` 前缀。

```
POST /event
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `hook_event_name` | string | 是 | Hook 事件名（SessionStart、PreToolUse 等） |
| `session_id` | string | 否 | SDK 会话 ID |
| `tool_name` | string | 否 | 工具名称 |
| `tool_input` | string | 否 | 工具输入 |
| `tool_output` | string | 否 | 工具输出 |

**支持的事件映射**：

| Hook 事件 | 内部 EventType |
|-----------|---------------|
| `SessionStart` | SessionStart |
| `SessionEnd` | SessionEnd |
| `PreToolUse` | PreToolUse |
| `PostToolUse` | PostToolUse |
| `Stop` | Stop |
| `UserPromptSubmit` | UserPromptSubmit |
| `Notification` | Notification |

**响应**：

```json
{ "ok": true }
```

---

### 7.12 World 接口

提供 Agent 的虚拟世界状态管理，支持 Agent 在虚拟空间中的位置和状态可视化。

#### 7.12.1 获取世界配置

```
GET /api/world/config
```

#### 7.12.2 获取所有 Agent 世界状态

```
GET /api/world/agents
```

#### 7.12.3 获取单个 Agent 世界状态

```
GET /api/world/agent/:id
```

#### 7.12.4 移动 Agent

```
POST /api/world/agent/:id/move
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `areaId` | string | 是 | 目标区域 ID |

---

### 7.13 Capability 接口

管理 Agent 的能力绑定关系。

#### 7.13.1 获取所有能力绑定

```
GET /api/capabilities/bindings
```

#### 7.13.2 获取 Agent 的能力绑定

```
GET /api/capabilities/agents/:agentId/bindings
```

#### 7.13.3 设置 Agent 能力绑定

```
PUT /api/capabilities/agents/:agentId/bindings/:capabilityId
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `enabled` | boolean | 是 | 是否启用该能力 |

---

### 7.14 WebSocket

#### 7.14.1 连接地址

```
ws://localhost:3456/ws
```

#### 7.14.2 消息类型（Server → Client）

| 类型 | 说明 | 数据示例 |
|------|------|---------|
| `task:update` | Task 状态更新 | `{ "id": "...", "status": "Running" }` |
| `agent:update` | Agent 状态更新 | `{ "id": "...", "status": "working" }` |
| `event:new` | 新事件 | `{ "event": { "id": "...", "toolName": "Bash", ... } }` |
| `tool:approval` | 工具审批请求 | `{ "taskId": "...", "toolName": "Bash", "stuckReason": "..." }` |
| `task:budget` | 预算消耗更新 | `{ "taskId": "...", "budgetUsed": 1.23, "maxBudgetUsd": 5.0 }` |
| `notification` | 系统通知 | `{ "level": "info", "message": "Task 已完成" }` |
| `error` | 错误通知 | `{ "message": "SDK 调用失败" }` |

#### 7.14.3 消息格式

```json
{
  "type": "task:update",
  "data": { "task": { "id": "uuid", "status": "Running" } }
}
```

#### 7.14.4 重连机制

前端使用指数退避重连策略：首次 1s → 2s → 4s → ... → 最大 30s。断连期间底部状态栏显示 "🔴 连接中断"。

---

## 8. 组委会验证流程

以下为建议的完整验证流程，按顺序执行：

### Step 1: 环境准备

```bash
cp .env.example .env
mkdir -p workspace
# 编辑 .env 填入 API Key（如有），或保留空白验证基础功能
```

### Step 2: 构建并启动

```bash
docker compose up --build -d
```

### Step 3: 验证服务运行

```bash
# 查看容器状态
docker compose ps

# 确认健康检查通过
curl http://localhost:3456/api/health
# 预期: {"status":"ok","version":"0.1.0","uptime":...,"activeTaskCount":0,...}
```

### Step 4: 访问 Web UI

打开浏览器访问 `http://localhost:3456`

- 确认页面正常加载
- 看到登录页面

### Step 5: 登录系统

- 使用账号 `admin` / `password` `admin123` 登录
- 确认成功进入系统主界面（三栏布局：Agent 面板、任务看板、详情面板）

### Step 6: 创建项目

```bash
TOKEN=$(curl -s -X POST http://localhost:3456/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"admin","password":"admin123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

curl -X POST http://localhost:3456/api/projects \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"eval-project","path":"/workspace","description":"committee verification project"}'
```

### Step 7: 验证核心业务接口

```bash
# 项目列表
curl http://localhost:3456/api/projects -H "Authorization: Bearer $TOKEN"

# Agent 列表
curl http://localhost:3456/api/agents -H "Authorization: Bearer $TOKEN"

# Task 列表
curl http://localhost:3456/api/tasks -H "Authorization: Bearer $TOKEN"
```

### Step 8: 创建 Agent

```bash
curl -X POST http://localhost:3456/api/agents \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "测试Agent",
    "avatar": "🤖",
    "role": "Verification Agent for committee evaluation",
    "prompt": "You are a helpful assistant for demonstration purposes.",
    "maxTurns": 20,
    "maxBudgetUsd": 1
  }'
```

### Step 9: 创建 Task

```bash
curl -X POST http://localhost:3456/api/tasks \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "title": "验证任务",
    "description": "输出当前工作目录的文件列表",
    "agentId": "<上一步返回的 agent.id>",
    "projectId": "<项目的 id>",
    "priority": 1,
    "tags": ["eval"]
  }'
```

### Step 10: 验证日志与数据

```bash
# 查看容器日志
docker compose logs --tail=50

# 查看数据文件
ls -lah data/
cat data/projects.json | python3 -m json.tool
cat data/agents.json | python3 -m json.tool
cat data/tasks.json | python3 -m json.tool
```

---

## 9. 常见问题与排障

### 9.1 Docker 构建失败

**问题**：`npm install` 超时或失败  
**解决**：使用国内镜像源

```bash
docker build --build-arg NPM_REGISTRY=https://registry.npmmirror.com -t ai4s-data-agent-swarm:latest .
```

**问题**：Web 构建失败（`tsc -b` 报类型错误）  
**说明**：这是预期行为。Docker 构建已跳过 `tsc -b`，直接使用 `vite build`。类型错误不影响运行时功能。

### 9.2 服务无法启动

**问题**：`docker compose up` 后容器退出  
**排查**：

```bash
# 查看详细日志
docker compose logs

# 检查端口冲突
lsof -i :3456

# 检查环境变量
docker compose config
```

### 9.3 登录失败

**问题**：`Invalid email or password`  
**解决**：

- 首次启动自动创建管理员账号 `admin` / `admin123`
- 如需自定义，设置环境变量 `DEFAULT_USER_EMAIL` 和 `DEFAULT_USER_PASSWORD`
- 确认 `.env` 文件已正确配置

### 9.4 Token 过期

**问题**：接口返回 401 `Token 无效或已过期`

- Token 有效期为 7 天，过期后需重新登录
- 可通过 `JWT_SECRET` 环境变量自定义签名密钥

### 9.5 项目创建失败（path 不存在）

**问题**：返回 `path does not exist on disk`

- Docker 环境下 `path` 必须为容器内路径（如 `/workspace`）
- 确保 `workspace/` 目录已挂载并存在
- 也可不传 `path`，系统自动在 `data/projects/{name}` 创建

### 9.6 Agent 任务无法启动

**问题**：Task 启动后一直 stuck

- 检查模型 API 配置是否正确
- 使用 `test-connection` 接口验证模型连接
- 查看容器日志中是否有 SDK 错误
- 在 Web UI 中查看 Task 详情中的 stuckReason

### 9.7 预知限制

1. **Agent 执行需要外部模型 API**：未配置 API Key 时，Agent 任务无法执行，但基础 CRUD 和界面可正常验证。
2. **Web 前端预存 TypeScript 类型错误**：不影响运行时功能，仅影响 `tsc -b` 编译。
3. **数据存储为 JSON 文件**：无数据库，大规模数据场景下查询性能受限。
4. **单用户设计**：服务绑定 `127.0.0.1`，无多用户鉴权机制。公网发布需添加反向代理层。

---

> **文档结束**  
> 本文档对应系统版本 v0.1.0，如有更新请参考项目仓库最新代码。
