import { Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as projectStore from "../store/projectStore.js";
import * as taskStore from "../store/taskStore.js";
import { broadcast } from "../services/wsBroadcaster.js";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

function validateName(name: unknown): string | null {
  if (typeof name !== "string" || name.length === 0) {
    return "name is required";
  }
  if (!NAME_PATTERN.test(name)) {
    return "name must only contain [a-zA-Z0-9_-]";
  }
  return null;
}

function validatePath(projectPath: unknown): string | null {
  if (typeof projectPath !== "string" || projectPath.length === 0) {
    return "path is required";
  }
  if (!path.isAbsolute(projectPath)) {
    return "path must be an absolute path";
  }
  if (!fs.existsSync(projectPath)) {
    return "path does not exist on disk";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const projectsRouter = Router();

// GET /api/projects
projectsRouter.get("/", (_req, res) => {
  res.json({ projects: projectStore.getAllProjects() });
});

// POST /api/projects
projectsRouter.post("/", (req, res) => {
  const { name, path: projectPath, description } = req.body;

  const nameError = validateName(name);
  if (nameError) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: nameError },
    });
  }

  const pathError = validatePath(projectPath);
  if (pathError) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: pathError },
    });
  }

  const now = Date.now();
  const project = projectStore.createProject({
    id: crypto.randomUUID(),
    name: name as string,
    path: projectPath as string,
    description: description as string | undefined,
    createdAt: now,
    updatedAt: now,
  });

  broadcast("project:update", project);
  res.status(201).json({ project });
});

// PUT /api/projects/:id
projectsRouter.put("/:id", (req, res) => {
  const existing = projectStore.getProjectById(req.params.id);
  if (!existing) {
    return res.status(404).json({
      error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
    });
  }

  const patch: Record<string, unknown> = {};

  if (req.body.name !== undefined) {
    const nameError = validateName(req.body.name);
    if (nameError) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: nameError },
      });
    }
    patch.name = req.body.name;
  }

  if (req.body.path !== undefined) {
    const pathError = validatePath(req.body.path);
    if (pathError) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: pathError },
      });
    }
    patch.path = req.body.path;
  }

  if (req.body.description !== undefined) {
    patch.description = req.body.description;
  }

  const updated = projectStore.updateProject(req.params.id, patch);
  broadcast("project:update", updated);
  res.json({ project: updated });
});

// DELETE /api/projects/:id
projectsRouter.delete("/:id", (req, res) => {
  const existing = projectStore.getProjectById(req.params.id);
  if (!existing) {
    return res.status(404).json({
      error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
    });
  }

  // Check for running/stuck tasks
  const activeTasks = taskStore
    .getAllTasks()
    .filter(
      (t) =>
        t.projectId === req.params.id &&
        (t.status === "Running" || t.status === "Stuck"),
    );

  if (activeTasks.length > 0) {
    return res.status(409).json({
      error: {
        code: "RESOURCE_HAS_DEPENDENTS",
        message: `Cannot delete project: ${activeTasks.length} active task(s) are still running or stuck`,
      },
    });
  }

  projectStore.deleteProject(req.params.id);
  broadcast("project:delete", { id: req.params.id });
  res.json({ ok: true });
});
