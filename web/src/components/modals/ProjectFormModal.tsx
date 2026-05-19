import { useState } from "react";
import { X, Loader2, FolderPlus } from "lucide-react";

interface Props {
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export default function ProjectFormModal({ onClose, onSave }: Props) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const trimmed = name.trim();

    if (!trimmed) {
      setError("项目名称不能为空");
      return;
    }
    if (trimmed.length < 2 || trimmed.length > 50) {
      setError("项目名称需为 2-50 个字符");
      return;
    }
    if (!NAME_PATTERN.test(trimmed)) {
      setError("仅支持英文、数字、下划线、横杠");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
    } catch (err) {
      setError(`${err}`);
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !saving) {
      handleSave();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center animate-fade-in"
      onClick={onClose}
    >
      <div
        className="absolute inset-0"
        style={{
          background: "rgba(2,3,10,0.7)",
          backdropFilter: "blur(8px)",
        }}
      />
      <div
        className="relative w-[400px] animate-scale-in rounded-2xl"
        style={{
          background:
            "linear-gradient(175deg, rgba(5,8,18,0.98) 0%, rgba(3,5,12,0.98) 100%)",
          border: "1px solid rgba(200,149,108,0.05)",
          boxShadow:
            "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,162,122,0.03)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2">
            <FolderPlus size={16} style={{ color: "#ffa27a" }} />
            <h3
              className="text-sm font-medium tracking-wider"
              style={{ color: "var(--text-primary)" }}
            >
              新建项目
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/[0.03] transition-colors"
          >
            <X size={16} style={{ color: "var(--text-muted)" }} />
          </button>
        </div>

        {/* Form */}
        <div className="p-6 space-y-4">
          <div>
            <label
              className="flex items-center gap-1.5 text-[11px] font-medium tracking-wider uppercase mb-2"
              style={{ color: "var(--text-muted)" }}
            >
              项目名称 *
            </label>
            <input
              value={name}
              onChange={e => {
                setName(e.target.value);
                setError(null);
              }}
              onKeyDown={handleKeyDown}
              autoFocus
              className="w-full text-xs px-3 py-2.5 rounded-lg outline-none transition-all"
              style={{
                background: "rgba(200,149,108,0.04)",
                border: error
                  ? "1px solid rgba(239,68,68,0.4)"
                  : "1px solid var(--border-subtle)",
                color: "var(--text-primary)",
              }}
              placeholder="如 my-project、data_pipeline_01"
            />
            {error && (
              <p
                className="text-[10px] mt-1.5 animate-fade-in"
                style={{ color: "#ef4444" }}
              >
                {error}
              </p>
            )}
            <p
              className="text-[10px] mt-1.5"
              style={{ color: "var(--text-muted)" }}
            >
              仅支持英文、数字、下划线 (_) 和横杠 (-)
            </p>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-3 px-6 py-4 border-t"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs transition-all"
            style={{
              border: "1px solid var(--border-medium)",
              color: "var(--text-secondary)",
            }}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-5 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-all disabled:opacity-50"
            style={{
              background: "linear-gradient(135deg, #c8956c, #a07850)",
              color: "#0a0a0a",
              boxShadow: "0 2px 12px rgba(200,149,108,0.2)",
            }}
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : null}
            {saving ? "创建中..." : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
