import { AlertTriangle, ArrowDown } from "lucide-react";
import { useState } from "react";
import { api, useFetch } from "../lib/api";
import { formatDate } from "../lib/format";
import { Confirm, DbError, Empty, Skeletons, useToast } from "../components/ui";

export function ConflictsPage({ onCount }: { onCount: (n: number) => void }) {
  const { data, error, loading, reload } = useFetch(() => api.conflicts(), []);
  const [resolving, setResolving] = useState<{ winner: string; loser: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const items = data?.data ?? [];
  const pairs = pairUp(items);

  const resolve = async (keepBoth: boolean) => {
    if (!resolving) return;
    if (keepBoth) {
      setResolving(null);
      toast("Kept both — marked resolved");
      return;
    }
    setBusy(true);
    try {
      await api.resolveConflict(resolving.winner, resolving.loser);
      toast("Conflict resolved");
      setResolving(null);
      const c = await api.conflicts();
      onCount(c.total);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Conflicts</h1>
        <p className="page-sub">Contradicting memories are flagged, never silently resolved.</p>
      </div>
      {loading ? (
        <Skeletons rows={4} />
      ) : error ? (
        <DbError error={error} onRetry={reload} />
      ) : pairs.length === 0 ? (
        <Empty
          icon={<AlertTriangle size={18} />}
          title="No conflicts"
          body="When two memories contradict, they will appear here for review."
        />
      ) : (
        pairs.map(([older, newer], i) => (
          <div className="conflict-box" key={i} style={{ marginBottom: 12 }}>
            <strong className="small">Conflict detected</strong>
            <div
              className="vs"
              style={{ flexDirection: "column", alignItems: "stretch", gap: 4, marginTop: 8 }}
            >
              <div className="vs-old">
                <div>{older.content}</div>
                <div className="small muted">Older memory · {formatDate(older.createdAt)}</div>
              </div>
              <span className="arrow-down" aria-hidden="true">
                <ArrowDown size={14} />
              </span>
              <div className="vs-new">
                <div>{newer.content}</div>
                <div className="small muted">Newer memory · {formatDate(newer.createdAt)}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <button
                className="btn sm"
                onClick={() => setResolving({ winner: older.id, loser: newer.id })}
              >
                Keep older
              </button>
              <button
                className="btn sm"
                onClick={() => setResolving({ winner: newer.id, loser: older.id })}
              >
                Keep newer
              </button>
              <button
                className="btn sm"
                onClick={() => setResolving({ winner: newer.id, loser: older.id })}
              >
                Keep both
              </button>
            </div>
          </div>
        ))
      )}
      {resolving && (
        <Confirm
          title="Resolve conflict?"
          body={
            busy
              ? "Resolving…"
              : "The losing memory is superseded (preserved in history), the winner stays active."
          }
          confirmLabel="Mark resolved"
          onCancel={() => setResolving(null)}
          onConfirm={() => void resolve(false)}
        />
      )}
    </div>
  );
}

function pairUp<T>(items: T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i + 1 < items.length; i += 2) out.push([items[i]!, items[i + 1]!]);
  if (items.length % 2 === 1 && items.length > 0)
    out.push([items[items.length - 1]!, items[items.length - 1]!]);
  return out;
}
