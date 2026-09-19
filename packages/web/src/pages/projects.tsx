import { useState } from "react";
import { MemoryDrawer, MemoryRow } from "../components/memory";
import { DbError, Empty, Skeletons } from "../components/ui";
import { api, useFetch } from "../lib/api";
import { timeAgo } from "../lib/format";

export function Projects() {
  const { data, error, loading, reload } = useFetch(() => api.projects(), []);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Projects</h1>
        <p className="page-sub">Memory is isolated per project by default.</p>
      </div>
      {loading ? (
        <Skeletons rows={4} />
      ) : error ? (
        <DbError error={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <Empty
          title="No projects yet"
          body="Projects are created automatically when agents store memories, or pin one with aam project use."
        />
      ) : (
        <div className="grid2">
          {data.map((p) => (
            <a
              key={p.id}
              className="card clickable"
              href={`#/project/${encodeURIComponent(p.id)}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div className="card-row">
                <p className="card-title mono">{p.name}</p>
              </div>
              <p className="card-meta">
                {(p.memoryCount ?? 0).toLocaleString()} memories · {p.sceneCount ?? 0} scenes · Last
                activity {timeAgo(p.lastActivity ?? p.updatedAt)}
              </p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

const TABS = ["Overview", "Memories", "Scenes", "Decisions", "Sessions", "Sources"] as const;

export function ProjectDetail({ id }: { id: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const project = useFetch(() => api.project(id), [id]);
  const memories = useFetch(
    () => api.memories({ project: id, limit: 20, all: true, sort: "updatedAt" }),
    [id, tab],
  );
  const [openId, setOpenId] = useState<string | null>(null);

  if (project.loading)
    return (
      <div className="page">
        <Skeletons rows={5} />
      </div>
    );
  if (project.error || !project.data)
    return (
      <div className="page">
        <DbError error={project.error ?? new Error("not found")} onRetry={project.reload} />
      </div>
    );
  const p = project.data as unknown as Record<string, unknown> & {
    name: string;
    description?: string;
    memoryCount: number;
    eventCount: number;
    scenes: { id: string; name: string; memoryIds: string[]; updatedAt: string }[];
    recentDecisions: { id: string; content: string }[];
    topCore: { id: string; content: string }[];
  };

  return (
    <div className="page wide">
      <div className="page-header">
        <p className="small muted">
          <a href="#/projects">Projects</a> / {p.name}
        </p>
        <h1 className="page-title mono">{p.name}</h1>
        {p.description ? <p className="page-sub">{String(p.description)}</p> : null}
      </div>
      <div
        className="seg"
        role="tablist"
        aria-label="Project sections"
        style={{ marginBottom: 16 }}
      >
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat-value">{Number(p.memoryCount ?? 0).toLocaleString()}</div>
              <div className="stat-label">Memories</div>
            </div>
            <div className="stat">
              <div className="stat-value">{(p.scenes ?? []).length}</div>
              <div className="stat-label">Scenes</div>
            </div>
            <div className="stat">
              <div className="stat-value">{Number(p.eventCount ?? 0).toLocaleString()}</div>
              <div className="stat-label">Sources</div>
            </div>
            <div className="stat">
              <div className="stat-value">{(p.topCore ?? []).length}</div>
              <div className="stat-label">Core</div>
            </div>
          </div>
          <section className="section">
            <h2 className="section-title">Top core knowledge</h2>
            {(p.topCore ?? []).length === 0 ? (
              <p className="muted small">Nothing promoted yet.</p>
            ) : (
              <div className="list">
                {(p.topCore ?? []).map((m) => (
                  <div className="row" key={m.id} style={{ cursor: "default" }}>
                    <p className="row-content">{m.content}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
      {tab === "Memories" &&
        (memories.loading ? (
          <Skeletons rows={6} />
        ) : (
          <div className="list">
            {(memories.data?.data ?? []).map((m) => (
              <MemoryRow
                key={m.id}
                memory={m}
                selected={openId === m.id}
                onOpen={(mm) => setOpenId(mm.id)}
              />
            ))}
          </div>
        ))}
      {tab === "Scenes" && (
        <div className="grid2">
          {(p.scenes ?? []).map((s) => (
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
            </a>
          ))}
          {(p.scenes ?? []).length === 0 && (
            <p className="muted small">No scenes for this project yet.</p>
          )}
        </div>
      )}
      {tab === "Decisions" && (
        <div className="list">
          {(p.recentDecisions ?? []).map((m) => (
            <div className="row" key={m.id} style={{ cursor: "default" }}>
              <p className="row-content">{m.content}</p>
            </div>
          ))}
          {(p.recentDecisions ?? []).length === 0 && (
            <div className="row">
              <p className="muted small">No recorded decisions.</p>
            </div>
          )}
        </div>
      )}
      {(tab === "Sessions" || tab === "Sources") && (
        <p className="muted small">
          See <a href={tab === "Sessions" ? "#/sessions" : "#/sources"}>{tab.toLowerCase()}</a>{" "}
          filtered by project <span className="mono">{p.name}</span>.
        </p>
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
