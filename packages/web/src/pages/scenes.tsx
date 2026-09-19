import { useState } from "react";
import { MemoryDrawer, MemoryRow } from "../components/memory";
import { DbError, Empty, Skeletons } from "../components/ui";
import { api, useFetch } from "../lib/api";
import { timeAgo } from "../lib/format";

export function Scenes() {
  const { data, error, loading, reload } = useFetch(() => api.scenes(), []);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Scenes</h1>
        <p className="page-sub">Clusters of related memories, grouped by topic.</p>
      </div>
      {loading ? (
        <Skeletons rows={5} />
      ) : error ? (
        <DbError error={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <Empty
          title="No scenes yet"
          body="Scenes are created automatically as memories cluster around topics, or attach memories to a named scene when remembering."
        />
      ) : (
        <div className="grid2">
          {data.map((s) => (
            <a
              key={s.id}
              className="card clickable"
              href={`#/scene/${s.id}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <p className="card-title">{s.name}</p>
              <p className="card-meta">
                {s.memoryIds.length} memories · Updated {timeAgo(s.updatedAt)}
              </p>
              {s.summary && (
                <p className="small muted" style={{ margin: "8px 0 0" }}>
                  {s.summary.slice(0, 140)}
                </p>
              )}
            </a>
          ))}
        </div>
      )}
      <MemoryDrawer
        id={openId}
        onClose={() => setOpenId(null)}
        onChanged={() => {}}
        onOpen={setOpenId}
      />
    </div>
  );
}

export function SceneDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useFetch(() => api.scene(id), [id]);
  const [openId, setOpenId] = useState<string | null>(null);

  if (loading)
    return (
      <div className="page">
        <Skeletons rows={6} />
      </div>
    );
  if (error || !data)
    return (
      <div className="page">
        <DbError error={error ?? new Error("not found")} onRetry={reload} />
      </div>
    );
  const members = data.members ?? [];
  const core = data.coreCount ?? members.filter((m) => m.level === "core").length;

  return (
    <div className="page wide">
      <div className="page-header">
        <p className="small muted">
          <a href="#/scenes">Scenes</a> / {data.name}
        </p>
        <h1 className="page-title">{data.name}</h1>
        <p className="page-sub">
          Updated {timeAgo(data.updatedAt)}
          {data.projectId ? ` · ${data.projectId}` : ""}
        </p>
      </div>
      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="stat-value">{data.memoryIds.length}</div>
          <div className="stat-label">Memories</div>
        </div>
        <div className="stat">
          <div className="stat-value">{core}</div>
          <div className="stat-label">Core memories</div>
        </div>
        <div className="stat">
          <div className="stat-value">{data.atomicCount ?? data.memoryIds.length - core}</div>
          <div className="stat-label">Atomic memories</div>
        </div>
      </div>
      {data.summary && (
        <section className="section" style={{ marginTop: 0 }}>
          <h2 className="section-title">Summary</h2>
          <p style={{ margin: 0 }}>{data.summary}</p>
          {data.projectId && (
            <p className="small muted" style={{ marginTop: 8 }}>
              Related projects:{" "}
              <a href={`#/project/${encodeURIComponent(data.projectId)}`}>{data.projectId}</a>
            </p>
          )}
        </section>
      )}
      <section className="section">
        <h2 className="section-title">Memories</h2>
        {members.length === 0 ? (
          <Empty title="Scene is empty" body="Memories grouped into this scene will appear here." />
        ) : (
          <div className="list">
            {members.map((m) => (
              <MemoryRow
                key={m.id}
                memory={m}
                selected={openId === m.id}
                onOpen={(mm) => setOpenId(mm.id)}
              />
            ))}
          </div>
        )}
      </section>
      <MemoryDrawer
        id={openId}
        onClose={() => setOpenId(null)}
        onChanged={reload}
        onOpen={setOpenId}
      />
    </div>
  );
}
