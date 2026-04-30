<h1 align="center">AI4S Data Agent Swarm</h1>

<p align="center">
  AI for Science 数据合成 · 多 Agent 协同编排平台
</p>

<p align="center">
  <img src="screenshots/00-landing-page.png" width="600" />
</p>

---

## 快速开始

```bash
git clone https://github.com/GitHub-Ninghai/AI4S_Data_Agent_Swarm.git
cd AI4S_Data_Agent_Swarm

# 安装依赖
cd server && npm install && cd ..
cd web && npm install && cd ..

# 配置环境变量
cp .env.example .env

# 启动
node start.js
```

访问 http://localhost:5173

Windows 用户需在 `.env` 中配置 `CLAUDE_CODE_GIT_BASH_PATH=D:\Git\bin\bash.exe`

---

## 系统要求

| 依赖 | 说明 |
|------|------|
| Node.js >= 18 | 后端运行时 |
| Claude Code CLI | AI 执行引擎（[安装指南](https://docs.anthropic.com/en/docs/claude-code/overview)） |
| Git Bash | Windows 用户必需 |

---

## 预置 Agent

| Agent | 职能 |
|-------|------|
| 论文爬取专家 | 从 arXiv / Semantic Scholar 检索论文 |
| PDF 解析专家 | MinerU 解析 PDF，提取结构化内容 |
| 数据合成专家 | 生成 Q&A 对、知识图谱数据 |
| 质检专家 | 数据质量审核：准确性、完整性、去重 |
| 流程编排专家 | 编排流水线，协调多 Agent 执行 |
| Sci-Evo 生成专家 | 科学演化数据生成 |

---

## 主界面

![Homepage](screenshots/01-homepage.png)

三栏布局：**Agent 面板**（左） · **任务看板**（中） · **详情面板**（右）

---

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Express 4 + ws 8 + @anthropic-ai/claude-agent-sdk |
| 前端 | React 19 + Vite 6 + TypeScript 5.7 |
| 存储 | JSON 文件（无数据库） |
| 测试 | Vitest（249 个用例） |

---

## 开发命令

```bash
node start.js              # 启动开发模式
node stop.js               # 停止
cd server && npx vitest    # 运行测试
```

---

## License

MIT
