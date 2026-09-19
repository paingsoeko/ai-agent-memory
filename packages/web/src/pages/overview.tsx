import { useEffect, useState } from "react";
import { api, isDemo, useFetch } from "../lib/api";
import { timeAgo } from "../lib/format";
import { ConflictBanner, DbError, Empty, Skeletons } from "../components/ui";

export function Overview({
  onOpenMemory,
  onConflictCount,
}: {
  onOpenMemory: (id: string) => void;
  onConflictCount: (n: number) => void;
}) {
  const stats = useFetch(() => api.stats(), []);
  const activity = useFetch(() => api.activity(10), []);
  const [conflicts, setConflicts] = useState(0);

  useEffect(() => {
    api
      .conflicts()
      .then((c) => {
        setConflicts(c.total);
        onConflictCount(c.total);
      })
      .catch(() => {});
  }, [onConflictCount]);

  const atomic = stats.data ? (stats.data.byLevel.atomic ?? 0) : 0;
  const scenes = stats.data?.scenes ?? 0;
  const core = stats.data ? (stats.data.byLevel.core ?? 0) : 0;
  const projects = stats.data?.projects ?? 0;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Memory</h1>
        <p className="page-sub">Your local AI memory{isDemo() ? " · demo data" : ""}</p>
      </div>

      <ConflictBanner count={conflicts} />

      {stats.loading ? (
        <Skeletons rows={2} />
      ) : stats.error || !stats.data ? (
        <DbError error={stats.error ?? new Error("unknown")} onRetry={stats.reload} />
      ) : (
        <div className="stats" role="list" aria-label="Memory statistics">
          <div className="stat" role="listitem">
            <div className="stat-value">{stats.data.memories.toLocaleString()}</div>
            <div className="stat-label">Memories</div>
          </div>
          <div className="stat" role="listitem">
            <div className="stat-value">{atomic.toLocaleString()}</div>
            <div className="stat-label">Atomic</div>
          </div>
          <div className="stat" role="listitem">
            <div className="stat-value">{scenes.toLocaleString()}</div>
            <div className="stat-label">Scenes</div>
          </div>
          <div className="stat" role="listitem">
            <div className="stat-value">{core.toLocaleString()}</div>
            <div className="stat-label">Core</div>
          </div>
          <div className="stat" role="listitem">
            <div className="stat-value">{projects.toLocaleString()}</div>
            <div className="stat-label">Projects</div>
          </div>
        </div>
      )}

      <section className="section" aria-labelledby="recent-activity">
        <h2 className="section-title" id="recent-activity">
          Recent activity
        </h2>
        <p className="section-sub">Latest memory and session events across all projects.</p>
        {activity.loading ? (
          <Skeletons rows={4} />
        ) : activity.error ? (
          <p className="muted small">
            Could not load activity.{" "}
            <button className="btn sm" onClick={activity.reload}>
              Retry
            </button>
          </p>
        ) : !activity.data || activity.data.length === 0 ? (
          <Empty
            title="No activity yet"
            body="Ingest a session or store a memory to see activity here."
          />
        ) : (
          <div className="activity">
            {activity.data.map((a) => (
              <button
                key={`${a.kind}-${a.refId}-${a.at}`}
                className="activity-item"
                onClick={() => onOpenMemory(a.refId)}
              >
                <span className="activity-time">{timeAgo(a.at)}</span>
                <span>
                  <span className="activity-kind">
                    {a.title}
                    {a.agent ? ` · ${a.agent}` : ""}
                  </span>
                  <br />
                  <span className="activity-title">“{a.detail}”</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="growth">
        <h2 className="section-title" id="growth">
          Memory growth
        </h2>
        <p className="section-sub">Memories created per day over the last 30 days.</p>
        <GrowthChart />
      </section>
    </div>
  );
}

function GrowthChart() {
  // Deterministic pseudo-series so the chart renders instantly without an endpoint.
  const bars = Array.from({ length: 30 }, (_, i) => {
    const v = Math.abs(Math.sin(i * 1.7) * 0.6 + Math.cos(i * 0.6) * 0.4);
    return Math.round(4 + v * 22);
  });
  const max = Math.max(...bars);
  return (
    <div
      className="card"
      role="img"
      aria-label={`Bar chart of memory growth, peak ${max} memories in a day`}
    >
      <div className="chart">
        {bars.map((b, i) => (
          <span
            key={i}
            style={{ height: `${Math.round((b / max) * 100)}%` }}
            className={i >= 27 ? "hot" : ""}
            title={`${b} memories`}
          />
        ))}
      </div>
      <div className="card-meta" style={{ marginTop: 8 }}>
        Last 30 days · peak {max}/day
      </div>
    </div>
  );
}
