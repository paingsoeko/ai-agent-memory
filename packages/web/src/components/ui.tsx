import { AlertTriangle, Check, Database, Inbox, SearchX } from "lucide-react";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/* ---------- Badges ---------- */

export function LevelBadge({ level }: { level: string }) {
  const cls =
    level === "core"
      ? "level-core"
      : level === "atomic"
        ? "level-atomic"
        : level === "scene"
          ? "level-scene"
          : "level-raw";
  return (
    <span className={`badge ${cls}`}>
      {level === "scene" ? "Scene" : level[0]!.toUpperCase() + level.slice(1)}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  if (status === "active") return null;
  return <span className={`badge status-${status}`}>{status}</span>;
}

export function TypeBadge({ type }: { type: string }) {
  return <span className="badge type">{type.replace(/_/g, " ")}</span>;
}

/* ---------- Empty / loading / error ---------- */

export function Empty({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty" role="status">
      <div className="empty-icon">{icon ?? <Inbox size={18} />}</div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function NoMemories({ onClear }: { onClear?: () => void }) {
  return (
    <Empty
      title="No memories yet"
      body="Your AI agents will create memories as they work with your projects."
      action={
        onClear ? (
          <button className="btn" onClick={onClear}>
            Clear search &amp; filters
          </button>
        ) : (
          <a className="btn" href="#/settings">
            Learn how memory works
          </a>
        )
      }
    />
  );
}

export function NoResults({ onClear }: { onClear: () => void }) {
  return (
    <Empty
      icon={<SearchX size={18} />}
      title="No memories found"
      body="Try a different query or remove filters."
      action={
        <button className="btn" onClick={onClear}>
          Clear search &amp; filters
        </button>
      }
    />
  );
}

export function Skeletons({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skel" aria-label="Loading" role="status">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skel-row" key={i}>
          <div className="skel-line" style={{ width: `${82 - (i % 3) * 14}%`, marginBottom: 8 }} />
          <div className="skel-line" style={{ width: "38%" }} />
        </div>
      ))}
    </div>
  );
}

export function ErrorBox({
  title,
  body,
  technical,
  onRetry,
}: {
  title: string;
  body: string;
  technical?: string;
  onRetry: () => void;
}) {
  return (
    <div className="error-box" role="alert">
      <h3>{title}</h3>
      <p>{body}</p>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button className="btn" onClick={onRetry}>
          Retry
        </button>
        <a className="btn" href="#/settings">
          Open database settings
        </a>
      </div>
      {technical && (
        <details style={{ marginTop: 12, fontSize: 12, color: "var(--text-secondary)" }}>
          <summary style={{ cursor: "pointer" }}>Technical details</summary>
          <pre className="mono" style={{ textAlign: "left", whiteSpace: "pre-wrap", marginTop: 8 }}>
            {technical}
          </pre>
        </details>
      )}
    </div>
  );
}

export function DbError({ error, onRetry }: { error: { message: string }; onRetry: () => void }) {
  return (
    <ErrorBox
      title="Unable to load memories"
      body="The local memory database could not be opened."
      technical={error.message}
      onRetry={onRetry}
    />
  );
}

/* ---------- Modal ---------- */

export function Modal({
  title,
  sub,
  onClose,
  children,
  labelledBy,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: React.ReactNode;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>("textarea, input, select, button");
    el?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="modal-wrap"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? "modal-title"}
        ref={ref}
      >
        <h2 id={labelledBy ?? "modal-title"}>{title}</h2>
        {sub && <p className="sub">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>
        {label}
        {children}
      </label>
    </div>
  );
}

export function Confirm({
  title,
  body,
  note,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  note?: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="sub">{body}</p>
      {note && <p className="small muted">{note}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className={`btn ${danger ? "solid-danger" : "primary"}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ---------- Popover ---------- */

export function Popover({
  label,
  children,
  align,
}: {
  label: React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  align?: "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="pop-wrap" ref={ref}>
      <button
        className="btn sm"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <div className={`pop ${align === "right" ? "right" : ""}`} role="menu">
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

export function CheckItem({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button className="pop-item" role="menuitemcheckbox" aria-checked={checked} onClick={onToggle}>
      <span className="check">{checked ? <Check size={14} /> : null}</span>
      {label}
    </button>
  );
}

/* ---------- Conflict banner ---------- */

export function ConflictBanner({ count }: { count: number }) {
  if (!count) return null;
  return (
    <div
      className="conflict-box"
      role="alert"
      style={{ marginBottom: 12, display: "flex", gap: 10, alignItems: "center" }}
    >
      <AlertTriangle size={16} />
      <div style={{ fontSize: 13 }}>
        <strong>
          {count} conflict{count === 1 ? "" : "s"} need{count === 1 ? "s" : ""} review.
        </strong>{" "}
        <span className="muted">Conflicts are never resolved silently.</span>{" "}
        <a href="#/memories?status=conflicted" style={{ fontWeight: 600 }}>
          Review
        </a>
      </div>
    </div>
  );
}

/* ---------- Toasts ---------- */

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  const push = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setItems((v) => [...v, { id, msg }]);
    setTimeout(() => setItems((v) => v.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div className="toast" key={t.id}>
            <Check size={15} />
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function DbBadge() {
  return (
    <span
      className="small muted mono"
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      <Database size={12} /> ~/.ai-memory/memory.db
    </span>
  );
}
