import { useState, useEffect, useCallback, useRef } from "react";
import { useAppState } from "../../store/AppContext";
import * as api from "../../api/client";
import type { PipelineType, UploadedFile } from "../../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = 1 | 2 | 3;

interface Props {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DataPipelineModal({ onClose }: Props) {
  const { projects, activeProjectId, agents } = useAppState();

  const [step, setStep] = useState<Step>(1);
  const [pipelineType, setPipelineType] = useState<PipelineType | null>(null);
  const [projectId, setProjectId] = useState(activeProjectId ?? "");
  const [availablePdfs, setAvailablePdfs] = useState<UploadedFile[]>([]);
  const [selectedPdfs, setSelectedPdfs] = useState<Set<string>>(new Set());
  const [uploadingFiles, setUploadingFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 加载项目已有的 PDF
  const loadProjectPdfs = useCallback(async (pId: string) => {
    try {
      const res = await api.getProjectFiles(pId);
      setAvailablePdfs(res.files);
    } catch {
      setAvailablePdfs([]);
    }
  }, []);

  useEffect(() => {
    if (projectId) {
      loadProjectPdfs(projectId);
    }
  }, [projectId, loadProjectPdfs]);

  // 切换项目时重置已选文件
  const handleProjectChange = (pId: string) => {
    setProjectId(pId);
    setSelectedPdfs(new Set());
  };

  // 选择/取消选择 PDF
  const togglePdf = (relativePath: string) => {
    setSelectedPdfs((prev) => {
      const next = new Set(prev);
      if (next.has(relativePath)) {
        next.delete(relativePath);
      } else {
        next.add(relativePath);
      }
      return next;
    });
  };

  // 处理文件拖拽/选择
  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.name.endsWith(".pdf"),
    );
    setUploadingFiles((prev) => [...prev, ...files]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) =>
      f.name.endsWith(".pdf"),
    );
    setUploadingFiles((prev) => [...prev, ...files]);
  };

  // 上传文件
  const uploadPendingFiles = async (): Promise<string[]> => {
    if (uploadingFiles.length === 0) return [];
    setIsUploading(true);
    setError(null);
    try {
      const res = await api.uploadFiles(projectId, uploadingFiles);
      setUploadingFiles([]);
      await loadProjectPdfs(projectId);
      return res.files.map((f) => f.relativePath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
      return [];
    } finally {
      setIsUploading(false);
    }
  };

  // 下一步
  const handleNext = async () => {
    if (step === 1) {
      if (!pipelineType) return;
      if (!projectId) {
        setError("请选择一个项目");
        return;
      }
      setError(null);
      setStep(2);
    } else if (step === 2) {
      // 上传待上传文件
      if (uploadingFiles.length > 0) {
        const uploadedPaths = await uploadPendingFiles();
        // 自动选中刚上传的文件
        for (const p of uploadedPaths) {
          togglePdf(p);
        }
      }

      if (selectedPdfs.size === 0 && uploadingFiles.length === 0) {
        setError("请至少选择一个 PDF 文件或上传新文件");
        return;
      }
      setError(null);
      setStep(3);
    }
  };

  // 创建流水线
  const handleCreate = async () => {
    if (!pipelineType || !projectId || selectedPdfs.size === 0) return;
    setIsCreating(true);
    setError(null);
    try {
      await api.createDataPipeline({
        pipelineType,
        projectId,
        pdfFiles: Array.from(selectedPdfs),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建流水线失败");
    } finally {
      setIsCreating(false);
    }
  };

  // 查找将使用的 Agent
  const getPipelineAgents = () => {
    if (!pipelineType) return [];
    const agentNames =
      pipelineType === "qa"
        ? ["PDF 解析专家", "数据合成专家", "质检专家"]
        : ["PDF 解析专家", "Sci-Evo 生成专家"];
    return agentNames
      .map((name) => {
        const found = [...agents.values()].find((a) => a.name === name);
        return found ? found.name : `${name}（未找到）`;
      });
  };

  const pipelineLabel =
    pipelineType === "qa" ? "Q&A 训练数据" : "Sci-Evo 科学演化";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content modal-wide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>+ Pipeline</h2>
          <button className="modal-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        {/* 步骤指示器 */}
        <div className="pipeline-steps">
          <div className={`pipeline-step ${step >= 1 ? "active" : ""}`}>
            <span className="pipeline-step-num">1</span>
            <span>数据类型</span>
          </div>
          <div className="pipeline-step-line" />
          <div className={`pipeline-step ${step >= 2 ? "active" : ""}`}>
            <span className="pipeline-step-num">2</span>
            <span>PDF 来源</span>
          </div>
          <div className="pipeline-step-line" />
          <div className={`pipeline-step ${step >= 3 ? "active" : ""}`}>
            <span className="pipeline-step-num">3</span>
            <span>确认</span>
          </div>
        </div>

        {/* 步骤 1: 选择数据类型 */}
        {step === 1 && (
          <div className="pipeline-body">
            <p className="pipeline-hint">选择要生成的数据类型：</p>
            <div className="pipeline-cards">
              <button
                className={`pipeline-card ${pipelineType === "qa" ? "selected" : ""}`}
                onClick={() => setPipelineType("qa")}
              >
                <div className="pipeline-card-icon">{"\u{1F4CB}"}</div>
                <div className="pipeline-card-title">Q&A 训练数据</div>
                <div className="pipeline-card-desc">
                  论文 → 解析 → Q&A + 三元组 + 摘要 → 质检（3 步流水线）
                </div>
              </button>
              <button
                className={`pipeline-card ${pipelineType === "scievo" ? "selected" : ""}`}
                onClick={() => setPipelineType("scievo")}
              >
                <div className="pipeline-card-icon">{"\u{1F9EC}"}</div>
                <div className="pipeline-card-title">Sci-Evo 科学演化</div>
                <div className="pipeline-card-desc">
                  论文 → 解析 → 三段式 JSON（2 步流水线）
                </div>
              </button>
            </div>

            {/* 项目选择 */}
            <div className="form-field" style={{ marginTop: 16 }}>
              <label className="form-label">选择项目</label>
              <select
                className="form-select"
                value={projectId}
                onChange={(e) => handleProjectChange(e.target.value)}
              >
                <option value="">— 请选择项目 —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* 步骤 2: 选择 PDF 来源 */}
        {step === 2 && (
          <div className="pipeline-body">
            <p className="pipeline-hint">选择 PDF 文件来源：</p>

            {/* 上传新 PDF */}
            <div className="pipeline-section">
              <h3 className="pipeline-section-title">上传 PDF</h3>
              <div
                className="pipeline-dropzone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="pipeline-dropzone-text">
                  拖拽 PDF 文件到此处，或点击选择
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  multiple
                  style={{ display: "none" }}
                  onChange={handleFileSelect}
                />
              </div>
              {uploadingFiles.length > 0 && (
                <div className="pipeline-file-list">
                  {uploadingFiles.map((f, i) => (
                    <div key={i} className="pipeline-file-item pending">
                      <span>{f.name}</span>
                      <span className="pipeline-file-size">
                        {(f.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                      <button
                        className="pipeline-file-remove"
                        onClick={() =>
                          setUploadingFiles((prev) =>
                            prev.filter((_, idx) => idx !== i),
                          )
                        }
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                  <p className="pipeline-upload-hint">
                    文件将在下一步确认时上传
                  </p>
                </div>
              )}
            </div>

            {/* 使用已有 PDF */}
            {availablePdfs.length > 0 && (
              <div className="pipeline-section">
                <h3 className="pipeline-section-title">使用已有 PDF</h3>
                <div className="pipeline-file-list">
                  {availablePdfs.map((f) => (
                    <label key={f.relativePath} className="pipeline-file-item">
                      <input
                        type="checkbox"
                        checked={selectedPdfs.has(f.relativePath)}
                        onChange={() => togglePdf(f.relativePath)}
                      />
                      <span className="pipeline-file-name">{f.name}</span>
                      <span className="pipeline-file-size">
                        {(f.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                      <span className={`pipeline-file-source ${f.source}`}>
                        {f.source === "papers" ? "papers/" : "uploads/"}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {availablePdfs.length === 0 && uploadingFiles.length === 0 && (
              <p className="pipeline-empty">
                暂无 PDF 文件。请上传文件，或先用论文爬取专家下载论文到 papers/ 目录。
              </p>
            )}
          </div>
        )}

        {/* 步骤 3: 确认 */}
        {step === 3 && (
          <div className="pipeline-body">
            <p className="pipeline-hint">确认流水线配置：</p>

            <div className="pipeline-confirm-grid">
              <div className="pipeline-confirm-label">数据类型</div>
              <div className="pipeline-confirm-value">{pipelineLabel}</div>

              <div className="pipeline-confirm-label">项目</div>
              <div className="pipeline-confirm-value">
                {projects.find((p) => p.id === projectId)?.name ?? projectId}
              </div>

              <div className="pipeline-confirm-label">PDF 文件</div>
              <div className="pipeline-confirm-value">
                {selectedPdfs.size} 个文件
                <div className="pipeline-confirm-files">
                  {Array.from(selectedPdfs).map((p) => (
                    <span key={p} className="pipeline-confirm-file">
                      {p}
                    </span>
                  ))}
                </div>
              </div>

              <div className="pipeline-confirm-label">将使用的 Agent</div>
              <div className="pipeline-confirm-value">
                <ol className="pipeline-confirm-agents">
                  {getPipelineAgents().map((name, i) => (
                    <li key={i}>{name}</li>
                  ))}
                </ol>
              </div>

              <div className="pipeline-confirm-label">预计步骤</div>
              <div className="pipeline-confirm-value">
                {pipelineType === "qa" ? "3 步" : "2 步"}
              </div>
            </div>
          </div>
        )}

        {/* 错误信息 */}
        {error && (
          <div className="pipeline-error">{error}</div>
        )}

        {/* 操作按钮 */}
        <div className="pipeline-actions">
          {step > 1 && (
            <button
              className="btn btn-secondary"
              onClick={() => setStep((s) => (s - 1) as Step)}
              disabled={isUploading || isCreating}
            >
              上一步
            </button>
          )}
          <div style={{ flex: 1 }} />
          {step < 3 && (
            <button
              className="btn btn-primary"
              onClick={handleNext}
              disabled={
                (step === 1 && (!pipelineType || !projectId)) || isUploading
              }
            >
              {isUploading ? "上传中..." : "下一步"}
            </button>
          )}
          {step === 3 && (
            <button
              className="btn btn-primary"
              onClick={handleCreate}
              disabled={isCreating || selectedPdfs.size === 0}
            >
              {isCreating ? "创建中..." : "创建流水线"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
