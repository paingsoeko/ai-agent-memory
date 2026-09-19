import { MemoryRow, MemoryDrawer } from "../components/memory";
import { DbError, Empty, Skeletons } from "../components/ui";
import { api, useFetch } from "../lib/api";
import { formatDateTime, formatDate } from "../lib/format";
import { useState } from "react";

export function Sessions() {
  const { data, error, loading, reload } = useFetch(() => api.sessions(), []);

  if (loading)
    return (
      <div className="page">
        <PageHead />
        <Skeletons rows={6} />
      </div>
    );
  if (error)
    return (
      <div className="page">
        <PageHead />
        <DbError error={error} onRetry={reload} />
      </div>
    );
  if (!data || data.length === 0)
    return (
      <div className="page">
        <PageHead />
        <Empty
          title="No sessions yet"
          body="Agent sessions appear here once an integration (Claude Code, Codex, Gemini, OpenCode) ingests a transcript."
        />
      </div>
    );

  const byDay = groupByDay(data.map((s) => ({ ...s, day: dayLabel(s.startedAt) })));

  return (
    <div className="page">
      <PageHead />
      {byDay.map(([day, items]) => (
        <div key={day}>
          <div className="timeline-date">{day}</div>
          <div className="list">
            {items.map((s) => (
              <a
                key={s.id}
                className="row"
                href={`#/session/${encodeURIComponent(s.sessionId ?? s.id)}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div className="row-meta" style={{ marginBottom: 3 }}>
                  <span>{formatDateTime(s.startedAt)}</span>
                  {s.agent && (
                    <span style={{ textTransform: "capitalize" }}>
                      {s.agent.replace(/-/g, " ")}
                    </span>
                  )}
                  {s.projectId && <span className="mono">{s.projectId}</span>}
                </div>
                <p className="row-content">{sessionTitle(s)}</p>
                <div className="row-meta">
                  <span>{s.memoryCount ?? 0} memories</span>
                  <span>·</span>
                  <span>{s.eventCount ?? 0} sources</span>
                </div>
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PageHead() {
  return (
    <div className="page-header">
      <h1 className="page-title">Sessions</h1>
      <p className="page-sub">Agent working sessions that produced memory.</p>
    </div>
  );
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function groupByDay<T extends { day: string }>(items: T[]): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const i of items) {
    const arr = map.get(i.day) ?? [];
    arr.push(i);
    map.set(i.day, arr);
  }
  return [...map.entries()];
}

function sessionTitle(s: { agent?: string; memoryCount?: number }): string {
  const who = (s.agent ?? "Agent").replace(/-/g, " ");
  return `${who} session · ${s.memoryCount ?? 0} memories captured`;
}

export function SessionDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useFetch(() => api.session(id), [id]);
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

  const duration =
    data.startedAt && data.endedAt
      ? `${Math.max(1, Math.round((+new Date(data.endedAt) - +new Date(data.startedAt)) / 60000))} min`
      : "—";
  const messages = Number(
    (data.metadata as Record<string, unknown>)?.messages ?? data.eventCount ?? 0,
  );

  return (
    <div className="page wide">
      <div className="page-header">
        <p className="small muted">
          <a href="#/sessions">Sessions</a> / <span className="mono">{data.sessionId}</span>
        </p>
        <h1 className="page-title" style={{ textTransform: "capitalize" }}>
          {(data.agent ?? "Agent").replace(/-/g, " ")}
        </h1>
        <p className="page-sub">
          {formatDate(data.startedAt)}
          {data.projectId ? ` · ${data.projectId}` : ""}
        </p>
      </div>
      <div className="stats" style={{ marginBottom: 20 }}>
        <div className="stat">
          <div className="stat-value">{duration}</div>
          <div className="stat-label">Duration</div>
        </div>
        <div className="stat">
          <div className="stat-value">{messages}</div>
          <div className="stat-label">Messages</div>
        </div>
        <div className="stat">
          <div className="stat-value">{data.memoryCount ?? data.memories?.length ?? 0}</div>
          <div className="stat-label">Memories created</div>
        </div>
        <div className="stat">
          <div className="stat-value">{data.eventCount ?? data.events?.length ?? 0}</div>
          <div className="stat-label">Sources</div>
        </div>
      </div>
      <section className="section" style={{ marginTop: 0 }}>
        <h2 className="section-title">Memories from this session</h2>
        {(data.memories ?? []).length === 0 ? (
          <p className="muted small">No linked memories.</p>
        ) : (
          <div className="list">
            {(data.memories ?? []).map((m) => (
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
      <section className="section">
        <h2 className="section-title">Sources</h2>
        {(data.events ?? []).length === 0 ? (
          <p className="muted small">No raw events retained.</p>
        ) : (
          <div className="list">
            {(data.events ?? []).map((e) => (
              <a
                key={e.id}
                className="row"
                href={`#/source/${e.id}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div className="row-meta">
                  <span className="src-kind">{e.kind.replace(/_/g, " ")}</span>
                  <span>{formatDateTime(e.createdAt)}</span>
                </div>
                <p className="row-content">{e.content.slice(0, 200)}</p>
              </a>
            ))}
          </div>
        )}
      </section>
      <MemoryDrawer
        id={openId}
        onClose={() => setOpenId(null)}
        onChanged={() => {}}
        onOpen={setOpenId}
      />
    </div>
  );
}
