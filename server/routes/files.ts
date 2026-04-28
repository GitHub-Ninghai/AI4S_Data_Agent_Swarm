// ---------------------------------------------------------------------------
// 文件上传路由 — PDF 上传到项目 uploads/ 目录
// ---------------------------------------------------------------------------

import { Router } from "express";
import multer from "multer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as projectStore from "../store/projectStore.js";

export const filesRouter = Router();

// ---------------------------------------------------------------------------
// Multer 配置
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      // 临时目录，后续移动到项目目录
      const tmpDir = path.resolve(process.cwd(), "data", "uploads_tmp");
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      cb(null, tmpDir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.originalname.endsWith(".pdf")) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
});

// ---------------------------------------------------------------------------
// POST /api/files/upload — 上传 PDF 文件
// ---------------------------------------------------------------------------

filesRouter.post("/upload", upload.array("files", 20), (req, res) => {
  const projectId = req.body.projectId as string;
  if (!projectId) {
    // 清理临时文件
    cleanupFiles(req.files as Express.Multer.File[]);
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "projectId is required" },
    });
  }

  const project = projectStore.getProjectById(projectId);
  if (!project) {
    cleanupFiles(req.files as Express.Multer.File[]);
    return res.status(404).json({
      error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
    });
  }

  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "No files uploaded" },
    });
  }

  // 确保项目 uploads/ 目录存在
  const uploadsDir = path.join(project.path, "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const uploadedFiles = files.map((file) => {
    const id = crypto.randomUUID();
    const originalName = Buffer.from(file.originalname, "latin1").toString("utf-8");
    const destName = `${id}_${originalName}`;
    const destPath = path.join(uploadsDir, destName);

    // 移动文件到项目 uploads/ 目录
    fs.renameSync(file.path, destPath);

    const stat = fs.statSync(destPath);

    return {
      id,
      name: originalName,
      path: destPath,
      relativePath: `uploads/${destName}`,
      size: stat.size,
      uploadedAt: Date.now(),
    };
  });

  res.status(201).json({ files: uploadedFiles });
});

// ---------------------------------------------------------------------------
// GET /api/files/:projectId — 列出项目已上传文件
// ---------------------------------------------------------------------------

filesRouter.get("/:projectId", (req, res) => {
  const { projectId } = req.params;
  const project = projectStore.getProjectById(projectId);
  if (!project) {
    return res.status(404).json({
      error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
    });
  }

  const uploadsDir = path.join(project.path, "uploads");
  const papersDir = path.join(project.path, "papers");

  const files: Array<{
    id: string;
    name: string;
    path: string;
    relativePath: string;
    size: number;
    source: "uploads" | "papers";
  }> = [];

  // 读取 uploads/ 目录
  collectPdfs(uploadsDir, "uploads", files);
  // 读取 papers/ 目录
  collectPdfs(papersDir, "papers", files);

  res.json({ files });
});

// ---------------------------------------------------------------------------
// DELETE /api/files/:projectId/:fileId — 删除已上传文件
// ---------------------------------------------------------------------------

filesRouter.delete("/:projectId/:fileId", (req, res) => {
  const { projectId, fileId } = req.params;
  const project = projectStore.getProjectById(projectId);
  if (!project) {
    return res.status(404).json({
      error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
    });
  }

  const uploadsDir = path.join(project.path, "uploads");
  if (!fs.existsSync(uploadsDir)) {
    return res.status(404).json({
      error: { code: "FILE_NOT_FOUND", message: "File not found" },
    });
  }

  // 查找以 fileId 开头的文件
  const entries = fs.readdirSync(uploadsDir);
  const target = entries.find((f) => f.startsWith(fileId));
  if (!target) {
    return res.status(404).json({
      error: { code: "FILE_NOT_FOUND", message: "File not found" },
    });
  }

  const filePath = path.join(uploadsDir, target);
  fs.unlinkSync(filePath);

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectPdfs(
  dir: string,
  source: "uploads" | "papers",
  files: Array<{
    id: string;
    name: string;
    path: string;
    relativePath: string;
    size: number;
    source: "uploads" | "papers";
  }>,
): void {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    if (!entry.endsWith(".pdf")) continue;
    const fullPath = path.join(dir, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;

      // 从文件名提取 id (格式: uuid_originalname.pdf)
      const underscoreIdx = entry.indexOf("_");
      const id = underscoreIdx > 0 ? entry.substring(0, underscoreIdx) : entry.replace(".pdf", "");

      files.push({
        id,
        name: entry,
        path: fullPath,
        relativePath: `${source}/${entry}`,
        size: stat.size,
        source,
      });
    } catch {
      // Skip inaccessible files
    }
  }
}

function cleanupFiles(files: Express.Multer.File[]): void {
  if (!files) return;
  for (const f of files) {
    try {
      if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
    } catch {
      // Ignore cleanup errors
    }
  }
}
