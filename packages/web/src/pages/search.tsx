import { Search as SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { MemoryDrawer, MemoryRow } from "../components/memory";
import { DbError, Empty, Skeletons } from "../components/ui";
import { api } from "../lib/api";
import type { SearchResult } from "../lib/types";

export function SearchPage({ initialQ }: { initialQ?: string }) {
  const [q, setQ] = useState(initialQ ?? "");
  const [mode, setMode] = useState<"keyword" | "semantic" | "hybrid">("hybrid");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [activeMode, setActiveMode] = useState("hybrid");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const run = async (query: string, m: string) => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.search(query.trim(), m);
      setResults(r.data);
      setTotal(r.total);
      setActiveMode(r.mode);
      setSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialQ) void run(initialQ, "hybrid");
  }, [initialQ]);

  return (
    <div className="page wide">
      <div className="page-header">
        <h1 className="page-title">Search</h1>
        <p className="page-sub">
          Keyword, semantic and hybrid search across all memory. <span className="kbd">⌘K</span>{" "}
          works everywhere.
        </p>
      </div>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          void run(q, mode);
        }}
        role="search"
      >
        <div className="search-box">
          <SearchIcon size={15} />
          <input
            className="input"
            placeholder="Search memories… e.g. how does payroll tracing work?"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search query"
            autoComplete="off"
          />
        </div>
        <div className="seg" role="group" aria-label="Search mode">
          {(["keyword", "semantic", "hybrid"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={mode === m ? "active" : ""}
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m);
                if (q.trim()) void run(q, m);
              }}
            >
              {m[0]!.toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <button className="btn primary" type="submit" disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>
      {searched && !loading && (
        <p className="mode-hint" aria-live="polite">
          Search mode: <strong>{activeMode[0]!.toUpperCase() + activeMode.slice(1)}</strong> ·{" "}
          {total} result{total === 1 ? "" : "s"}
        </p>
      )}

      <div style={{ marginTop: 12 }}>
        {loading ? (
          <Skeletons rows={6} />
        ) : error ? (
          <DbError error={{ message: error }} onRetry={() => void run(q, mode)} />
        ) : !searched ? (
          <Empty
            icon={<SearchIcon size={18} />}
            title="Search your memory"
            body="Ask about decisions, architecture, conventions — anything your agents remembered."
            action={
              <button
                className="btn"
                onClick={() => {
                  setQ("payroll temporal");
                  void run("payroll temporal", mode);
                }}
              >
                Try “payroll temporal”
              </button>
            }
          />
        ) : results.length === 0 ? (
          <Empty
            icon={<SearchIcon size={18} />}
            title="No matches"
            body="Try different terms, another mode, or fewer filters."
          />
        ) : (
          <div className="list" aria-label="Search results">
            {results.map((r) => (
              <div key={r.memory.id}>
                <MemoryRow
                  memory={r.memory}
                  selected={openId === r.memory.id}
                  matched={r.matched}
                  onOpen={(m) => setOpenId(m.id)}
                />
                <ResultWhy result={r} />
              </div>
            ))}
          </div>
        )}
      </div>
      <MemoryDrawer
        id={openId}
        onClose={() => setOpenId(null)}
        onChanged={() => {}}
        onOpen={setOpenId}
      />
    </div>
  );
}

function ResultWhy({ result }: { result: SearchResult }) {
  return (
    <div className="small muted" style={{ padding: "0 16px 10px", marginTop: -4 }}>
      {result.source === "semantic" || result.source === "hybrid" ? (
        <span>Semantic match · {result.score.toFixed(2)} </span>
      ) : (
        <span>Keyword match · {result.score.toFixed(2)} </span>
      )}
      {result.matched && result.matched.length > 0 && (
        <span>· Matched: {result.matched.join(", ")}</span>
      )}
      {result.explanation && <span> · {result.explanation}</span>}
    </div>
  );
}
