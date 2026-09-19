import { useState } from "react";
import { DbError, Empty, Skeletons } from "../components/ui";
import { api, useFetch } from "../lib/api";
import { formatDateTime } from "../lib/format";

const KINDS = ["message", "tool_result", "task_summary", "commit", "decision", "note", "external"];

function kindLabel(kind: string): string {
  switch (kind) {
    case "message":
      return "Conversation";
    case "tool_result":
      return "Tool Result";
    case "commit":
      return "Git Commit";
    case "task_summary":
      return "Agent Session";
    case "decision":
      return "Decision";
    case "note":
      return "Manual";
    case "external":
      return "Imported";
    default:
      return kind.replace(/_/g, " ");
  }
}

export function Sources() {
  const [kind, setKind] = useState("");
  const { data, error, loading, reload } = useFetch(() => api.sources({ limit: 50 }), []);

  const items = (data?.data ?? []).filter((e) => !kind || e.kind === kind);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Sources</h1>
        <p className="page-sub">
          Original provenance — raw events memories were derived from. Never rewritten.
        </p>
      </div>
      <div className="toolbar">
        <select
          className="select"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="Filter by source type"
        >
          <option value="">All types</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <Skeletons rows={6} />
      ) : error ? (
        <DbError error={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <Empty
          title="No sources yet"
          body="Sources appear when agents ingest conversations, commits or manual notes."
        />
      ) : (
        <div className="list">
          {items.map((e) => (
            <a
              key={e.id}
              className="row"
              href={`#/source/${e.id}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div className="row-meta" style={{ marginBottom: 3 }}>
                <span className="badge">{kindLabel(e.kind)}</span>
                {e.agent && <span style={{ textTransform: "capitalize" }}>{e.agent}</span>}
                <span>{formatDateTime(e.createdAt)}</span>
              </div>
              <p className="row-content">{e.content.slice(0, 220)}</p>
              {e.sessionId && (
                <div className="row-meta">
                  <span className="mono">Session #{e.sessionId.slice(0, 12)}</span>
                </div>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function SourceDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useFetch(() => api.source(id), [id]);
  if (loading)
    return (
      <div className="page">
        <Skeletons rows={5} />
      </div>
    );
  if (error || !data)
    return (
      <div className="page">
        <DbError error={error ?? new Error("not found")} onRetry={reload} />
      </div>
    );
  const s = data as unknown as Record<string, unknown> & {
    kind: string;
    agent?: string;
    sessionId?: string;
    projectId?: string;
    createdAt: string;
    content: string;
    metadata: Record<string, unknown>;
    memories?: { id: string; content: string }[];
  };

  return (
    <div className="page">
      <div className="page-header">
        <p className="small muted">
          <a href="#/sources">Sources</a> / {kindLabel(s.kind)}
        </p>
        <h1 className="page-title">
          {kindLabel(s.kind)}
          {s.agent ? ` · ${s.agent}` : ""}
        </h1>
        <p className="page-sub">{formatDateTime(s.createdAt)}</p>
      </div>
      <div className="card">
        <h2 className="section-title">Original content</h2>
        <p style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>{s.content}</p>
      </div>
      <dl className="kv" style={{ marginTop: 16 }}>
        {s.sessionId && (
          <>
            <dt>Session</dt>
            <dd>
              <a className="mono" href={`#/session/${encodeURIComponent(s.sessionId)}`}>
                #{s.sessionId.slice(0, 24)}
              </a>
            </dd>
          </>
        )}
        {s.projectId && (
          <>
            <dt>Project</dt>
            <dd>
              <a href={`#/project/${encodeURIComponent(s.projectId)}`}>{s.projectId}</a>
            </dd>
          </>
        )}
        {Object.keys(s.metadata ?? {}).length > 0 && (
          <>
            <dt>Metadata</dt>
            <dd>
              <pre className="mono small muted" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {JSON.stringify(s.metadata, null, 2)}
              </pre>
            </dd>
          </>
        )}
      </dl>
      {(s.memories ?? []).length > 0 && (
        <section className="section">
          <h2 className="section-title">Derived memories ({(s.memories ?? []).length})</h2>
          <div className="list">
            {(s.memories ?? []).map((m) => (
              <a
                key={m.id}
                className="row"
                href={`#/memories?open=${m.id}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <p className="row-content">{m.content}</p>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
