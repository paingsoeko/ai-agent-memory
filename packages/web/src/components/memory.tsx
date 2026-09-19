import { Archive, ArrowDown, History, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, useFetch } from "../lib/api";
import { formatDate, highlight, importanceLabel, pct, shortId, timeAgo } from "../lib/format";
import type { Memory, MemoryInspection } from "../lib/types";
import {
  Confirm,
  Field,
  LevelBadge,
  Modal,
  Skeletons,
  StatusBadge,
  TypeBadge,
  useToast,
} from "./ui";

/* ---------------- Row ---------------- */

export function MemoryRow({
  memory,
  selected,
  matched,
  onOpen,
}: {
  memory: Memory;
  selected?: boolean;
  matched?: string[];
  onOpen: (m: Memory) => void;
}) {
  return (
    <button
      className={`row ${selected ? "selected" : ""}`}
      onClick={() => onOpen(memory)}
      aria-label={`Open memory: ${memory.content.slice(0, 80)}`}
    >
      <p
        className="row-content"
        {...(matched?.length ? (highlight(memory.content, matched) ?? {}) : {})}
      >
        {matched?.length ? undefined : memory.content}
      </p>
      <div className="row-meta">
        <TypeBadge type={memory.type} />
        <LevelBadge level={memory.level} />
        <StatusBadge status={memory.status} />
        {memory.projectId && <span>{memory.projectId}</span>}
        <span
          className="conf"
          title={`Confidence ${pct(memory.confidence)} · Importance ${importanceLabel(memory.importance)}`}
        >
          {pct(memory.confidence)}
        </span>
        <span title={new Date(memory.updatedAt).toLocaleString()}>{timeAgo(memory.updatedAt)}</span>
      </div>
    </button>
  );
}

/* ---------------- Detail drawer ---------------- */

export function MemoryDrawer({
  id,
  onClose,
  onChanged,
  onOpen,
}: {
  id: string | null;
  onClose: () => void;
  onChanged: () => void;
  onOpen: (id: string) => void;
}) {
  const { data, error, loading, reload } = useFetch(() => api.inspect(id!), [id]);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<null | "delete" | "archive">(null);
  const toast = useToast();

  useEffect(() => {
    setEditing(false);
    setConfirming(null);
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!id) return;
      if (e.key === "Escape") {
        if (!editing && !confirming) onClose();
      }
      if (
        (e.target as HTMLElement).tagName === "INPUT" ||
        (e.target as HTMLElement).tagName === "TEXTAREA"
      )
        return;
      if (e.key.toLowerCase() === "e") setEditing(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [id, editing, confirming, onClose]);

  const open = !!id;

  const doArchive = async (insp: MemoryInspection) => {
    await api.remove(insp.memory.id, true);
    toast("Memory archived");
    setConfirming(null);
    onClose();
    onChanged();
  };
  const doDelete = async (insp: MemoryInspection) => {
    await api.remove(insp.memory.id, false);
    toast("Memory deleted");
    setConfirming(null);
    onClose();
    onChanged();
  };

  return (
    <>
      <div className={`scrim ${open ? "open" : ""}`} onClick={onClose} aria-hidden="true" />
      <aside
        className={`drawer ${open ? "open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Memory detail"
        aria-hidden={!open}
      >
        <div className="drawer-head">
          <span className="drawer-title">Memory</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close detail (Esc)">
            <X size={16} />
          </button>
        </div>
        <div className="drawer-body">
          {!open || loading ? (
            <Skeletons rows={4} />
          ) : error || !data ? (
            <div>
              <p className="muted">Could not load this memory.</p>
              <p className="small muted">{error?.message}</p>
              <button className="btn sm" onClick={reload}>
                Retry
              </button>
            </div>
          ) : (
            <DetailBody insp={data} onOpen={onOpen} onEdit={() => setEditing(true)} />
          )}
        </div>
        {data && !loading && !error && (
          <div className="drawer-foot">
            <button className="btn sm" onClick={() => setEditing(true)} title="Edit (E)">
              <Pencil size={13} /> Edit
            </button>
            <button
              className="btn sm"
              onClick={() => setConfirming("archive")}
              title="Archive (soft-delete)"
            >
              <Archive size={13} /> Archive
            </button>
            <button className="btn sm danger" onClick={() => setConfirming("delete")}>
              <Trash2 size={13} /> Delete
            </button>
          </div>
        )}
      </aside>
      {editing && data && !("error" in (data as object)) && (
        <EditMemoryModal
          memory={(data as MemoryInspection).memory}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
            onChanged();
          }}
        />
      )}
      {confirming &&
        data &&
        (confirming === "archive" ? (
          <Confirm
            title="Archive memory?"
            body="The memory will be hidden from future retrieval but kept in the database."
            note="Its original source will remain unless explicitly deleted."
            confirmLabel="Archive"
            onCancel={() => setConfirming(null)}
            onConfirm={() => void doArchive(data as MemoryInspection)}
          />
        ) : (
          <Confirm
            title="Delete memory?"
            body="This will remove the memory from future retrieval."
            note="Its original source will remain unless explicitly deleted."
            confirmLabel="Delete"
            danger
            onCancel={() => setConfirming(null)}
            onConfirm={() => void doDelete(data as MemoryInspection)}
          />
        ))}
    </>
  );
}

function DetailBody({
  insp,
  onOpen,
  onEdit,
}: {
  insp: MemoryInspection;
  onOpen: (id: string) => void;
  onEdit: () => void;
}) {
  const m = insp.memory;
  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <LevelBadge level={m.level} />
        <TypeBadge type={m.type} />
        <StatusBadge status={m.status} />
      </div>
      <p className="drawer-content">{m.content}</p>

      <dl className="kv">
        <dt>Confidence</dt>
        <dd className="conf">{pct(m.confidence)}</dd>
        <dt>Importance</dt>
        <dd>
          {importanceLabel(m.importance)} <span className="muted">({pct(m.importance)})</span>
        </dd>
        <dt>Scope</dt>
        <dd style={{ textTransform: "capitalize" }}>{m.scope}</dd>
        {m.projectId && (
          <>
            <dt>Project</dt>
            <dd>
              <a href={`#/project/${encodeURIComponent(m.projectId)}`}>{m.projectId}</a>
            </dd>
          </>
        )}
        {m.agent && (
          <>
            <dt>Agent</dt>
            <dd>{m.agent}</dd>
          </>
        )}
        <dt>Created</dt>
        <dd>{formatDate(m.createdAt)}</dd>
        <dt>Updated</dt>
        <dd>
          {formatDate(m.updatedAt)} <span className="muted">({timeAgo(m.updatedAt)})</span>
        </dd>
        {m.tags.length > 0 && (
          <>
            <dt>Tags</dt>
            <dd>{m.tags.join(", ")}</dd>
          </>
        )}
        <dt>ID</dt>
        <dd className="mono muted">{shortId(m.id)}</dd>
      </dl>

      {(insp.supersedes || insp.supersededBy) && (
        <>
          <hr className="divider" />
          <h3 className="mini-title">Lineage</h3>
          {insp.supersedes && (
            <div className="vs" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
              <button className="rel-item" onClick={() => onOpen(insp.supersedes!.id)}>
                <span className="muted small">
                  Superseded · {formatDate(insp.supersedes.updatedAt)}
                </span>
                <br />
                {insp.supersedes.content}
              </button>
              <span className="arrow-down" aria-hidden="true">
                <ArrowDown size={14} />
              </span>
              <div className="vs-new" aria-current="true">
                {m.content}
              </div>
            </div>
          )}
          {insp.supersededBy && (
            <div className="vs" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
              <div className="vs-old">{m.content}</div>
              <span className="arrow-down" aria-hidden="true">
                <ArrowDown size={14} />
              </span>
              <button className="rel-item" onClick={() => onOpen(insp.supersededBy!.id)}>
                <span className="muted small">
                  Superseded by · {formatDate(insp.supersededBy.updatedAt)}
                </span>
                <br />
                {insp.supersededBy.content}
              </button>
            </div>
          )}
        </>
      )}

      <hr className="divider" />
      <h3 className="mini-title">Provenance</h3>
      <Provenance insp={insp} />

      {insp.related.length > 0 && (
        <>
          <hr className="divider" />
          <h3 className="mini-title">Related memories</h3>
          {insp.related.slice(0, 6).map((r) => (
            <button key={r.id} className="rel-item" onClick={() => onOpen(r.id)}>
              {r.content}
            </button>
          ))}
        </>
      )}

      {insp.history.length > 0 && (
        <>
          <hr className="divider" />
          <h3 className="mini-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <History size={12} /> History
          </h3>
          <div className="small muted" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {insp.history
              .slice(-8)
              .reverse()
              .map((h, i) => (
                <div key={i}>
                  {formatDate(h.at)} — {h.action}
                  {h.detail ? ` · ${h.detail}` : ""}
                </div>
              ))}
          </div>
        </>
      )}

      <div style={{ marginTop: 16 }}>
        <button className="btn sm" onClick={onEdit}>
          <Pencil size={13} /> Edit all fields
        </button>
      </div>
    </div>
  );
}

/* ---------------- Provenance (vertical timeline) ---------------- */

export function Provenance({ insp }: { insp: MemoryInspection }) {
  const m = insp.memory;
  const sessionId = m.sessionId ?? insp.sources[0]?.sessionId;
  return (
    <ol className="prov">
      <li className="prov-node current">
        <span className="prov-dot" aria-hidden="true" />
        <div className="prov-card" aria-current="true">
          <div className="prov-kind">{m.level} memory</div>
          <div className="prov-label">{m.content.slice(0, 80)}</div>
          <div className="prov-sub">
            {m.type} · {pct(m.confidence)} confidence
          </div>
        </div>
      </li>
      {insp.scenes.map((s) => (
        <li className="prov-node" key={s.id}>
          <span className="prov-dot" aria-hidden="true" />
          <button
            className="prov-card"
            onClick={() => {
              window.location.hash = `#/scene/${s.id}`;
            }}
          >
            <div className="prov-kind">Scene</div>
            <div className="prov-label">{s.name}</div>
            <div className="prov-sub">{s.memoryIds.length} memories</div>
          </button>
        </li>
      ))}
      {sessionId && (
        <li className="prov-node" key="session">
          <span className="prov-dot" aria-hidden="true" />
          <button
            className="prov-card"
            onClick={() => {
              window.location.hash = `#/session/${encodeURIComponent(sessionId)}`;
            }}
          >
            <div className="prov-kind">Agent session</div>
            <div className="prov-label mono">#{sessionId.slice(0, 24)}</div>
            {m.agent && <div className="prov-sub">{m.agent}</div>}
          </button>
        </li>
      )}
      {insp.sources.slice(0, 3).map((s) => (
        <li className="prov-node" key={s.id}>
          <span className="prov-dot" aria-hidden="true" />
          <button
            className="prov-card"
            onClick={() => {
              window.location.hash = `#/source/${s.id}`;
            }}
          >
            <div className="prov-kind">Original {s.kind.replace(/_/g, " ")}</div>
            <div className="prov-label" style={{ fontWeight: 500 }}>
              {s.content.slice(0, 100)}
            </div>
            <div className="prov-sub">
              {formatDate(s.createdAt)}
              {s.agent ? ` · ${s.agent}` : ""}
            </div>
          </button>
        </li>
      ))}
      {insp.sources.length === 0 && !sessionId && (
        <li className="prov-node" key="manual">
          <span className="prov-dot" aria-hidden="true" />
          <div className="prov-card">
            <div className="prov-kind">Source</div>
            <div className="prov-label" style={{ fontWeight: 500 }}>
              Manual entry
            </div>
            <div className="prov-sub">Created directly, no session provenance</div>
          </div>
        </li>
      )}
    </ol>
  );
}

/* ---------------- Edit modal ---------------- */

const TYPES = [
  "fact",
  "preference",
  "decision",
  "architecture",
  "convention",
  "pattern",
  "bug_fix",
  "lesson",
  "task",
  "constraint",
  "persona",
  "project_context",
  "summary",
];
const SCOPES = ["global", "user", "project", "workspace", "session"];
const STATUSES = ["active", "superseded", "conflicted", "archived"];
const LEVELS = ["atomic", "core"];

export function EditMemoryModal({
  memory,
  onClose,
  onSaved,
}: {
  memory: Memory;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [content, setContent] = useState(memory.content);
  const [type, setType] = useState(memory.type);
  const [level, setLevel] = useState(memory.level);
  const [scope, setScope] = useState(memory.scope);
  const [status, setStatus] = useState(memory.status);
  const [confidence, setConfidence] = useState(String(memory.confidence));
  const [importance, setImportance] = useState(String(memory.importance));
  const [tags, setTags] = useState(memory.tags.join(", "));
  const [project, setProject] = useState(memory.projectId ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!content.trim()) {
      setErr("Content must not be empty.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await api.update(memory.id, {
        content: content.trim(),
        type,
        level,
        scope,
        status,
        confidence: Number(confidence),
        importance: Number(importance),
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        projectId: project.trim() || undefined,
      });
      toast("Memory updated");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Edit memory"
      sub={`ID ${shortId(memory.id)} · created ${formatDate(memory.createdAt)}`}
      onClose={onClose}
    >
      <Field label="Content">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          aria-label="Memory content"
        />
      </Field>
      <div className="field-row">
        <Field label="Type">
          <select
            className="select"
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Type"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
            {!TYPES.includes(type) && <option value={type}>{type}</option>}
          </select>
        </Field>
        <Field label="Level">
          <select
            className="select"
            value={level}
            onChange={(e) => setLevel(e.target.value as "atomic" | "core")}
            aria-label="Level"
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="field-row">
        <Field label="Scope">
          <select
            className="select"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            aria-label="Scope"
          >
            {SCOPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            className="select"
            value={status}
            onChange={(e) => setStatus(e.target.value as Memory["status"])}
            aria-label="Status"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="field-row">
        <Field label="Confidence (0–1)">
          <input
            className="input"
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={confidence}
            onChange={(e) => setConfidence(e.target.value)}
            aria-label="Confidence"
          />
        </Field>
        <Field label="Importance (0–1)">
          <input
            className="input"
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={importance}
            onChange={(e) => setImportance(e.target.value)}
            aria-label="Importance"
          />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Project">
          <input
            className="input"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            placeholder="project name"
            aria-label="Project"
          />
        </Field>
        <Field label="Tags (comma separated)">
          <input
            className="input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            aria-label="Tags"
          />
        </Field>
      </div>
      <details className="advanced">
        <summary>Advanced metadata</summary>
        <pre className="mono small muted" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
          {JSON.stringify(memory.metadata ?? {}, null, 2)}
        </pre>
      </details>
      {err && (
        <p role="alert" style={{ color: "var(--danger)", fontSize: 12.5 }}>
          {err}
        </p>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}
