// ---------------------------------------------------------------------------
// Copilot REST API 路由
// ---------------------------------------------------------------------------

import { Router } from "express";
import {
  createSession,
  deleteSession,
  chat,
  getPendingActions,
  clearPendingActions,
} from "../services/copilotService.js";
import { executeAction } from "../services/copilotActions.js";

export const copilotRouter = Router();

// POST /api/copilot/session — 创建新会话
copilotRouter.post("/session", (_req, res) => {
  const sessionId = createSession();
  res.json({ sessionId });
});

// DELETE /api/copilot/session/:id — 删除会话
copilotRouter.delete("/session/:id", (req, res) => {
  deleteSession(req.params.id);
  res.json({ ok: true });
});

// POST /api/copilot/chat — 发送消息
copilotRouter.post("/chat", async (req, res) => {
  const { sessionId, message } = req.body as {
    sessionId?: string;
    message?: string;
  };

  if (!message || typeof message !== "string") {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "message is required" },
    });
  }

  // Auto-create session if not provided
  const sid = sessionId && typeof sessionId === "string"
    ? sessionId
    : createSession();

  const result = await chat(sid, message);

  res.json({
    sessionId: sid,
    message: result.message,
    actions: result.actions,
    needsConfirmation: result.needsConfirmation,
  });
});

// POST /api/copilot/confirm — 确认/取消操作
copilotRouter.post("/confirm", (req, res) => {
  const { sessionId, actionIndex, confirmed } = req.body as {
    sessionId?: string;
    actionIndex?: number;
    confirmed?: boolean;
  };

  if (!sessionId || typeof actionIndex !== "number") {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "sessionId and actionIndex are required" },
    });
  }

  const pending = getPendingActions(sessionId);
  const action = pending[actionIndex];

  if (!action) {
    return res.status(404).json({
      error: { code: "ACTION_NOT_FOUND", message: "Action not found in pending list" },
    });
  }

  if (!confirmed) {
    clearPendingActions(sessionId);
    return res.json({
      success: true,
      message: "操作已取消",
    });
  }

  // Execute the action
  const result = executeAction(action);
  clearPendingActions(sessionId);

  res.json({
    success: result.success,
    message: result.message,
    data: result.data,
  });
});
