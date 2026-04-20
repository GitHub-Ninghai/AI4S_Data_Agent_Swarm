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
