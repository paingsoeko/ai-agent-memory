import { ArrowUp, ArrowDown, History, Trash2 } from "lucide-react";
import { useState } from "react";
import { MemoryDrawer } from "../components/memory";
import {
  Confirm,
  DbError,
  Empty,
  LevelBadge,
  Skeletons,
  TypeBadge,
  useToast,
} from "../components/ui";
import { api, useFetch } from "../lib/api";
import { pct, timeAgo } from "../lib/format";

const GROUPS = [
  "Project Knowledge",
  "User Preferences",
  "Architecture",
  "Conventions",
  "Long-term Decisions",
];

function groupFor(content: { type: string; scope: string }): string {
  if (content.scope === "user") return "User Preferences";
  if (content.type === "architecture") return "Architecture";
  if (content.type === "convention") return "Conventions";
  if (content.type === "decision") return "Long-term Decisions";
  return "Project Knowledge";
}

export function CoreMemory() {
  const { data, error, loading, reload } = useFetch(
    () =>
      api.memories({ level: ["core"], limit: 200, all: true, sort: "importance", order: "desc" }),
    [],
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const toast = useToast();

  const demote = async (id: string) => {
    setActing(id);
    try {
      await api.demote(id);
      toast("Demoted to atomic");
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(null);
    }
  };

  if (loading)
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Core Memory</h1>
        </div>
        <Skeletons rows={8} />
      </div>
    );
  if (error)
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Core Memory</h1>
        </div>
        <DbError error={error} onRetry={reload} />
      </div>
    );
  const items = data?.data ?? [];

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Core Memory</h1>
        <p className="page-sub">
          Curated long-term knowledge — promoted for every retrieval. {items.length} items.
        </p>
      </div>
      {items.length === 0 ? (
        <Empty
          title="No core memories"
          body="Promote important memories to core so agents always recall them."
        />
      ) : (
        GROUPS.map((g) => {
          const group = items.filter((m) => groupFor(m) === g);
          if (!group.length) return null;
          return (
            <section className="section" key={g} aria-label={g}>
              <h2 className="section-title">{g}</h2>
              <div className="list">
                {group.map((m) => (
                  <div key={m.id} className="row" style={{ cursor: "default" }}>
                    <button
                      onClick={() => setOpenId(m.id)}
                      style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}
                    >
                      <p className="row-content">{m.content}</p>
                    </button>
                    <div className="row-meta">
                      <TypeBadge type={m.type} />
                      <LevelBadge level={m.level} />
                      <span className="conf">{pct(m.confidence)} confidence</span>
                      <span>Updated {timeAgo(m.updatedAt)}</span>
                      <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
                        <button
                          className="btn sm"
                          title="Inspect provenance"
                          onClick={() => setOpenId(m.id)}
                        >
                          <History size={12} /> Provenance
                        </button>
                        <button
                          className="btn sm"
                          title="Demote to atomic"
                          disabled={acting === m.id}
                          onClick={() => void demote(m.id)}
                        >
                          <ArrowDown size={12} /> Demote
                        </button>
                        <button
                          className="btn sm danger"
                          title="Delete"
                          onClick={() => setDeleting(m.id)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })
      )}
      <p className="small muted" style={{ marginTop: 16 }}>
        <ArrowUp size={12} style={{ verticalAlign: -1 }} /> Promote from any memory drawer to add it
        here.
      </p>
      <MemoryDrawer
        id={openId}
        onClose={() => setOpenId(null)}
        onChanged={reload}
        onOpen={setOpenId}
      />
      {deleting && (
        <Confirm
          title="Delete core memory?"
          body="This will remove the memory from future retrieval."
          note="Its original source will remain unless explicitly deleted."
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            void api.remove(deleting).then(() => {
              toast("Memory deleted");
              setDeleting(null);
              reload();
            });
          }}
        />
      )}
    </div>
  );
}
