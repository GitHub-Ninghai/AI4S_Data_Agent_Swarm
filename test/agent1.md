# Agent 1 论文爬取专家 — 端到端测试规范

## 人类操作
1. 
## 概述

本文档描述论文爬取专家（🔍）的完整测试流程，包括环境准备、任务创建、执行验证和结果检查。测试目的是验证 Agent 能否根据关键词搜索学术论文、收集元数据、去重并生成 `papers.json`。

---

## 前置条件

| 条件 | 说明 | 验证命令 |
|------|------|----------|
| Node.js >= 18 | 后端运行时 | `node --version` |
| Claude Code CLI 已登录 | SDK 执行引擎 | `claude --version` |
| 项目依赖已安装 | server/ 和 web/ | `cd server && npm install && cd ../web && npm install` |
| 服务正常运行 | 前后端联合 | `node start.js` 后访问 http://localhost:3456/api/health |

---

## 测试流程

### Step 1: 启动平台

```bash
# 在项目根目录执行
cd /path/to/AI4S_Data_Agent_Swarm
node start.js
```

验证：
- 浏览器访问 http://localhost:5173 能看到平台界面
- `curl http://localhost:3456/api/health` 返回 `{"status":"ok",...}`

### Step 2: 确认预设 Agent 存在

首次访问时，前端会自动调用 `seedPresetAgents()` 创建预设 Agent。验证：

```bash
# 查看所有 Agent，确认 "论文爬取专家" 存在
curl -s http://localhost:3456/api/agents | python3 -m json.tool
```

预期响应中应包含：
```json
{
  "agents": [
    {
      "name": "论文爬取专家",
      "avatar": "🔍",
      "role": "根据关键词搜索学术论文，收集元数据并下载PDF，生成结构化论文清单",
      ...
    },
    ...
  ]
}
```

记录 **论文爬取专家** 的 `id`（如 `621d2301-5a9a-4fe3-b330-57b1a00f9150`），后续步骤需要。

### Step 3: 创建 Project

Project 是 Task 的工作目录。Agent 执行任务时在此目录下操作文件。

```bash
# 创建测试项目（路径指向本仓库的 examples/ 目录，因为那里有 papers/ 子目录）
curl -s -X POST http://localhost:3456/api/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "agent1-test",
    "path": "/path/to/AI4S_Data_Agent_Swarm/examples",
    "description": "Agent 1 论文爬取专家功能测试"
  }' | python3 -m json.tool
```

**注意**：将 `/path/to/AI4S_Data_Agent_Swarm` 替换为实际绝对路径。

记录返回的 `project.id`，后续步骤需要。

验证：
```bash
curl -s http://localhost:3456/api/projects | python3 -m json.tool
```

### Step 4: 创建 Task

```bash
# 替换 <AGENT_ID> 和 <PROJECT_ID> 为实际值
curl -s -X POST http://localhost:3456/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "搜索 smart grid 论文",
    "description": "根据关键词 \"smart grid optimization\" 搜索学术论文，获取至少 3 篇论文的元数据（标题、作者、摘要、年份、DOI），输出 papers.json 到当前目录。优先使用 Semantic Scholar API。",
    "agentId": "<AGENT_ID>",
    "projectId": "<PROJECT_ID>",
    "maxTurns": 50,
    "maxBudgetUsd": 3.0
  }' | python3 -m json.tool
```

记录返回的 `task.id`。

验证：
```bash
curl -s http://localhost:3456/api/tasks | python3 -m json.tool
```

应看到 Task 状态为 `Todo`。

### Step 5: 启动 Task

```bash
# 替换 <TASK_ID> 为实际值
curl -s -X POST http://localhost:3456/api/tasks/<TASK_ID>/start | python3 -m json.tool
```

启动后：
1. 前端看板中 Task 应从 Todo 列移动到 Running 列
2. Agent 状态应从 idle 变为 working
3. 右侧详情面板应开始显示事件流（API 调用、文件操作等）

如果 Task 在启动后很快变为 **Stuck** 状态，说明 Agent 需要工具审批：
1. 在前端点击 Stuck 的任务卡片
2. 查看详情面板中的工具审批请求
3. 点击"允许"审批工具调用
4. Task 自动恢复为 Running

### Step 6: 监控执行过程

在前端观察 Task 执行：
- **事件时间线**：应逐步出现 "调用 Semantic Scholar API"、"解析返回数据"、"写入 papers.json" 等事件
- **预算消耗**：应在 $0.5 ~ $3.0 范围内
- **对话轮次**：应在 10 ~ 50 轮之间

```bash
# 查看事件流（替换 <TASK_ID>）
curl -s "http://localhost:3456/api/tasks/<TASK_ID>/events?limit=20" | python3 -m json.tool

# 查看 SDK 状态
curl -s "http://localhost:3456/api/tasks/<TASK_ID>/sdk-status" | python3 -m json.tool
```

### Step 7: 验证 Task 完成

Task 应自动变为 Done 状态（`completedReason: "sdk_result"`）。

```bash
# 查看任务状态
curl -s http://localhost:3456/api/tasks/<TASK_ID> | python3 -m json.tool
```

预期响应中：
```json
{
  "task": {
    "status": "Done",
    "completedReason": "sdk_result",
    ...
  }
}
```

### Step 8: 验证输出文件

核心验证：确认 Agent 在 Project 目录下生成了合法的 `papers.json`。

```bash
# 检查 papers.json 是否存在
ls -la /path/to/AI4S_Data_Agent_Swarm/examples/papers.json

# 检查 JSON 格式是否合法
python3 -c "
import json
with open('/path/to/AI4S_Data_Agent_Swarm/examples/papers.json') as f:
    data = json.load(f)
print(f'JSON 合法: ✓')
print(f'查询关键词: {data.get(\"query\", \"<缺失>\")}')
print(f'论文数量: {data.get(\"total_results\", 0)}')
print(f'papers 数组长度: {len(data.get(\"papers\", []))}')
"
```

---

## 验收检查清单

以下检查项对应 `requirement.md` 和 prompt 设计中的验收标准：

### ✅ C1: 搜索指定关键词，成功生成 `papers.json`

```bash
# 检查文件是否存在且非空
[ -f /path/to/AI4S_Data_Agent_Swarm/examples/papers.json ] && \
  [ -s /path/to/AI4S_Data_Agent_Swarm/examples/papers.json ] && \
  echo "PASS: papers.json 存在且非空" || echo "FAIL: papers.json 不存在或为空"
```

### ✅ C2: `papers.json` 字段完整

```python
import json

with open('/path/to/AI4S_Data_Agent_Swarm/examples/papers.json') as f:
    data = json.load(f)

# 检查顶层字段
assert 'query' in data, "缺少 query 字段"
assert 'total_results' in data, "缺少 total_results 字段"
assert 'papers' in data, "缺少 papers 字段"
assert isinstance(data['papers'], list), "papers 字段不是数组"

# 检查每篇论文的必填字段
required_fields = ['title', 'authors', 'abstract', 'year']
optional_fields = ['doi', 'arxiv_id', 'pdf_url', 'local_path', 'citation_count', 'source']

for i, paper in enumerate(data['papers']):
    for field in required_fields:
        assert field in paper, f"论文 {i}: 缺少必填字段 {field}"
    # 标题不应为空
    assert paper['title'] and len(paper['title']) > 0, f"论文 {i}: 标题为空"
    # authors 应为数组
    assert isinstance(paper['authors'], list), f"论文 {i}: authors 不是数组"

print(f"字段完整度检查: ✓ ({len(data['papers'])} 篇论文)")

# 检查 failed_downloads 字段
assert 'failed_downloads' in data, "缺少 failed_downloads 字段"
```

### ✅ C3: 至少成功获取 2 篇论文的元数据

```python
assert len(data['papers']) >= 2, f"论文数量不足: {len(data['papers'])} < 2"
print(f"论文数量检查: ✓ ({len(data['papers'])} 篇 >= 2)")
```

### ✅ C4: 论文之间无重复

```python
# 基于 DOI/arXiv ID 去重检查
doi_set = set()
arxiv_id_set = set()
title_set = set()
duplicates = []

for paper in data['papers']:
    doi = paper.get('doi')
    arxiv_id = paper.get('arxiv_id')
    title = paper.get('title', '').strip().lower()

    if doi and doi in doi_set:
        duplicates.append(f"DOI 重复: {doi}")
    if doi:
        doi_set.add(doi)

    if arxiv_id and arxiv_id in arxiv_id_set:
        duplicates.append(f"arXiv ID 重复: {arxiv_id}")
    if arxiv_id:
        arxiv_id_set.add(arxiv_id)

    if title in title_set:
        duplicates.append(f"标题重复: {paper.get('title')}")
    title_set.add(title)

if duplicates:
    print(f"去重检查: ✗ 发现重复:\n" + "\n".join(duplicates))
else:
    print(f"去重检查: ✓ (DOI: {len(doi_set)}, arXiv: {len(arxiv_id_set)}, 标题: {len(title_set)})")
```

### ✅ C5: 数据来源可追溯

```python
for paper in data['papers']:
    source = paper.get('source', '')
    assert source in ['semanticscholar', 'arxiv', 'dblp', 'semanticscholar+arxiv'], \
        f"论文 {paper.get('title')}: source 字段值 '{source}' 不合法"
print(f"数据来源检查: ✓")
```

### ✅ C6: Semantic Scholar API 响应中 doi/arxiv_id 正确提取

```python
# 验证 doi 和 arxiv_id 来自 externalIds 嵌套对象
papers_with_doi = [p for p in data['papers'] if p.get('doi')]
papers_with_arxiv = [p for p in data['papers'] if p.get('arxiv_id')]
print(f"DOI 提取: {len(papers_with_doi)}/{len(data['papers'])} 篇有 DOI")
print(f"arXiv ID 提取: {len(papers_with_arxiv)}/{len(data['papers'])} 篇有 arXiv ID")
# DOI 格式应类似 10.xxxx/xxxx
for paper in papers_with_doi:
    assert paper['doi'].startswith('10.'), f"DOI 格式异常: {paper['doi']}"
print(f"DOI 格式检查: ✓")
```

---

## 快速测试脚本

将以下脚本保存为 `test/quick_test.sh`，一键运行完整测试流程：

```bash
#!/bin/bash
set -e

BASE_URL="http://localhost:3456"
AGENT_NAME="论文爬取专家"
PROJECT_NAME="agent1-test"
PROJECT_PATH="$(cd "$(dirname "$0")/.." && pwd)/examples"

echo "=== Agent 1 论文爬取专家 端到端测试 ==="
echo ""

# Step 1: 健康检查
echo "Step 1: 健康检查..."
HEALTH=$(curl -s "$BASE_URL/api/health")
echo "  服务状态: $(echo $HEALTH | python3 -c 'import sys,json; print(json.load(sys.stdin)["status"])')"
echo ""

# Step 2: 获取 Agent ID
echo "Step 2: 获取论文爬取专家 Agent ID..."
AGENTS=$(curl -s "$BASE_URL/api/agents")
AGENT_ID=$(echo $AGENTS | python3 -c "
import sys, json
agents = json.load(sys.stdin)['agents']
for a in agents:
    if a['name'] == '$AGENT_NAME':
        print(a['id'])
        break
")
echo "  Agent ID: $AGENT_ID"
echo ""

# Step 3: 创建 Project
echo "Step 3: 创建测试项目..."
PROJECT=$(curl -s -X POST "$BASE_URL/api/projects" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"$PROJECT_NAME\", \"path\": \"$PROJECT_PATH\", \"description\": \"Agent 1 功能测试\"}")
PROJECT_ID=$(echo $PROJECT | python3 -c "import sys,json; print(json.load(sys.stdin)['project']['id'])")
echo "  Project ID: $PROJECT_ID"
echo ""

# Step 4: 创建 Task
echo "Step 4: 创建搜索任务..."
TASK=$(curl -s -X POST "$BASE_URL/api/tasks" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"搜索 smart grid optimization 论文\",
    \"description\": \"根据关键词 \\\"smart grid optimization\\\" 搜索学术论文，获取至少 3 篇论文的元数据（标题、作者、摘要、年份、DOI），输出 papers.json 到当前目录。优先使用 Semantic Scholar API。如有 DOI 或 arXiv ID 重复，合并为一条记录。\",
    \"agentId\": \"$AGENT_ID\",
    \"projectId\": \"$PROJECT_ID\",
    \"maxTurns\": 50,
    \"maxBudgetUsd\": 3.0
  }")
TASK_ID=$(echo $TASK | python3 -c "import sys,json; print(json.load(sys.stdin)['task']['id'])")
echo "  Task ID: $TASK_ID"
echo ""

# Step 5: 启动 Task
echo "Step 5: 启动任务..."
curl -s -X POST "$BASE_URL/api/tasks/$TASK_ID/start" | python3 -c "import sys,json; t=json.load(sys.stdin)['task']; print(f'  状态: {t[\"status\"]}')"
echo ""

# Step 6: 等待完成
echo "Step 6: 等待任务完成..."
STATUS="Running"
while [ "$STATUS" = "Running" ] || [ "$STATUS" = "Stuck" ]; do
  sleep 10
  STATUS=$(curl -s "$BASE_URL/api/tasks/$TASK_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['task']['status'])")
  echo "  当前状态: $STATUS"
done
echo "  最终状态: $STATUS"
echo ""

# Step 7: 验证输出文件
echo "Step 7: 验证输出文件..."
PAPERS_FILE="$PROJECT_PATH/papers.json"

if [ -f "$PAPERS_FILE" ]; then
  echo "  ✓ papers.json 文件存在"

  # JSON 有效性检查
  python3 -c "import json; json.load(open('$PAPERS_FILE'))" && echo "  ✓ JSON 格式合法" || echo "  ✗ JSON 格式无效"

  # 字段检查
  python3 -c "
import json
data = json.load(open('$PAPERS_FILE'))
print(f'  查询关键词: {data.get(\"query\", \"<缺失>\")}')
print(f'  论文数量: {len(data.get(\"papers\", []))}')
print(f'  下载失败数: {len(data.get(\"failed_downloads\", []))}')

# 必填字段检查
for i, p in enumerate(data.get('papers', [])):
    for f in ['title', 'authors', 'abstract', 'year']:
        if f not in p:
            print(f'  ✗ 论文 {i}: 缺少 {f}')
    if p.get('source'):
        print(f'  ✓ 论文 {i}: source={p[\"source\"]}')
" || true
else
  echo "  ✗ papers.json 文件不存在"
fi

echo ""
echo "=== 测试完成 ==="
echo "查看详细事件: curl -s $BASE_URL/api/tasks/$TASK_ID/events?limit=50 | python3 -m json.tool"
echo "查看输出文件: cat $PAPERS_FILE | python3 -m json.tool"
```

---

## 参考输出

成功的 `papers.json` 应类似以下结构（与 `examples/papers.json` 对比）：

```json
{
  "query": "smart grid optimization",
  "total_results": 3,
  "papers": [
    {
      "title": "A Comprehensive Review of Smart Grid Technologies...",
      "authors": ["Mahmoud Kiasari", "Mahdi Ghaffari", "Hamed H. Aly"],
      "abstract": "The integration of renewable energy sources...",
      "year": 2024,
      "doi": "10.3390/en17164128",
      "arxiv_id": null,
      "pdf_url": null,
      "local_path": null,
      "citation_count": 108,
      "source": "semanticscholar"
    }
  ],
  "failed_downloads": []
}
```

**关键字段说明**：

| 字段 | 来源 | 说明 |
|------|------|------|
| `doi` | `externalIds.DOI` | Semantic Scholar 嵌套对象中提取 |
| `arxiv_id` | `externalIds.ArXiv` | Semantic Scholar 嵌套对象中提取 |
| `pdf_url` | 拼接或 API 返回 | arXiv: `https://arxiv.org/pdf/{arxiv_id}.pdf` |
| `local_path` | 下载后本地路径 | 无下载则为 `null` |
| `citation_count` | `citationCount` | Semantic Scholar 直接字段 |
| `source` | 按 API 来源标注 | `semanticscholar` / `arxiv` / `dblp` |

---

## Prompt 修复记录

| 日期 | 修复项 | 说明 |
|------|--------|------|
| 2026-04-25 | P1 | 补充 Semantic Scholar API `externalIds` 嵌套对象提取路径说明（`externalIds.DOI`、`externalIds.ArXiv`） |
| 2026-04-25 | P2 | 补充 arXiv API XML 解析的 `python3 -c` 命令示例 |
| 2026-04-25 | P3 | 添加 `source` 字段标注逻辑（按 API 来源填充） |
| 2026-04-25 | P4 | 统一 PDF 文件命名规则（arXiv ID 中点替换为下划线） |
| 2026-04-25 | P5 | 添加跨 API 去重逻辑（DOI 相同或标题高度相似时合并记录） |

---

## 故障排查

| 问题 | 可能原因 | 解决方法 |
|------|----------|----------|
| Task 启动后立即失败 | Claude Code CLI 未登录 | 运行 `claude` 检查登录状态 |
| Task 一直 Stuck | Agent 等待工具审批 | 在前端点击"允许"审批 |
| papers.json 为空 | API 调用失败 | 检查网络连接，查看 Task 事件流中的 Bash 输出 |
| JSON 格式错误 | Agent 写入失败 | 检查 Task 事件流，查看是否有文件写入权限问题 |
| 只有 1 篇论文 | API 返回结果少 | 尝试换关键词或增大 limit 参数 |
| Windows 下启动失败 | Git Bash 路径未配置 | 在 `.env` 中设置 `CLAUDE_CODE_GIT_BASH_PATH` |