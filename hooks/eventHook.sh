#!/usr/bin/env bash
# eventHook.sh — Claude Code Hook 事件转发脚本
# 从 stdin 读取 JSON，提取字段，追加到 hooks.log，POST 到 Server
# 错误静默忽略，不影响 Claude Code 正常运行

set -euo pipefail

SERVER_URL="http://localhost:3456/event"
LOG_FILE="./data/logs/hooks.log"
MAX_INPUT_BYTES=10240  # 10KB

# 确保日志目录存在
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true

# 从 stdin 读取 JSON
INPUT=$(cat)

# 提取字段
EVENT_NAME=$(echo "$INPUT" | jq -r '.hook_event_name // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# 提取 tool_input 并截断至 10KB
TOOL_INPUT=$(echo "$INPUT" | jq -r '.tool_input // empty')
if [ ${#TOOL_INPUT} -gt "$MAX_INPUT_BYTES" ]; then
  TOOL_INPUT="${TOOL_INPUT:0:$MAX_INPUT_BYTES}"
fi

TOOL_OUTPUT=$(echo "$INPUT" | jq -r '.tool_output // empty')

# 构建转发 payload
PAYLOAD=$(jq -c -n \
  --arg event "$EVENT_NAME" \
  --arg sid "$SESSION_ID" \
  --arg cwd "$CWD" \
  --arg tool "$TOOL_NAME" \
  --arg input "$TOOL_INPUT" \
  --arg output "$TOOL_OUTPUT" \
  '{hook_event_name: $event, session_id: $sid, cwd: $cwd, tool_name: $tool, tool_input: $input, tool_output: $output, source: "hook"}')

# 追加到日志文件
echo "$PAYLOAD" >> "$LOG_FILE" 2>/dev/null || true

# POST 到 Server（静默失败）
curl -s -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  > /dev/null 2>&1 || true
