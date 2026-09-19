import { ChevronDown, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MemoryDrawer, MemoryRow } from "../components/memory";
import {
  CheckItem,
  ConflictBanner,
  DbError,
  NoMemories,
  NoResults,
  Popover,
  Skeletons,
} from "../components/ui";
import { api, toParams, useFetch, type MemoryQuery } from "../lib/api";
import type { Memory } from "../lib/types";

const TYPES = [
  "fact",
  "decision",
  "architecture",
  "convention",
  "pattern",
  "bug_fix",
  "lesson",
  "preference",
  "persona",
];
const SCOPES = ["global", "user", "project", "workspace", "session"];
const STATUSES = ["active", "superseded", "conflicted", "archived"];
const SORTS = [
  { v: "updatedAt", label: "Recently updated" },
  { v: "createdAt", label: "Recently created" },
  { v: "importance", label: "Importance" },
  { v: "accessCount", label: "Most accessed" },
];

const PAGE_SIZE = 30;

interface Props {
  initialOpenId?: string | null;
  initialStatus?: string | null;
  projects: { id: string; name: string }[];
  onConflictCount: (n: number) => void;
}

export function Memories({ initialOpenId, initialStatus, projects, onConflictCount }: Props) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [mode, setMode] = useState<"keyword" | "semantic" | "hybrid">("hybrid");
  const [level, setLevel] = useState<string[]>([]);
  const [type, setType] = useState<string[]>([]);
  const [scope, setScope] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>(initialStatus ? [initialStatus] : []);
  const [project, setProject] = useState("");
  const [sort, setSort] = useState("updatedAt");
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [items, setItems] = useState<Memory[]>([]);
  const [total, setTotal] = useState(0);
  const offsetRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<{ message: string } | null>(null);
  const [focused, setFocused] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conflicts = useFetch(() => api.conflicts(), []);

  useEffect(() => {
    if (conflicts.data) onConflictCount(conflicts.data.total);
  }, [conflicts.data, onConflictCount]);
  useEffect(() => {
    setOpenId(initialOpenId ?? null);
  }, [initialOpenId]);
  useEffect(() => {
    if (initialStatus) setStatus([initialStatus]);
  }, [initialStatus]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(q.trim()), 220);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  const query: MemoryQuery = useMemo(
    () => ({
      q: debounced || undefined,
      mode: debounced ? mode : undefined,
      level: level.length ? level : undefined,
      type: type.length ? type : undefined,
      scope: scope.length ? scope : undefined,
      status: status.length ? status : undefined,
      project: project || undefined,
      all: project ? undefined : true,
      sort,
      order: "desc",
      limit: PAGE_SIZE,
      offset: 0,
    }),
    [debounced, mode, level, type, scope, status, project, sort],
  );

  const key = toParams(query);

  const load = useCallback(
    async (reset: boolean) => {
      const off = reset ? 0 : offsetRef.current;
      if (reset) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const page = await api.memories({ ...query, offset: off });
        setItems((prev) => (reset ? page.data : [...prev, ...page.data]));
        setTotal(page.total);
        offsetRef.current = off + page.data.length;
        if (reset) setFocused(0);
      } catch (e) {
        setError({ message: e instanceof Error ? e.message : String(e) });
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    // `key` is derived from every field of `query`; offset is read via ref.
    [key],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const clearAll = () => {
    setQ("");
    setDebounced("");
    setLevel([]);
    setType([]);
    setScope([]);
    setStatus([]);
    setProject("");
    setSort("updatedAt");
  };
  const hasFilters = q || level.length || type.length || scope.length || status.length || project;

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      setFocused((f) => Math.min(f + 1, items.length - 1));
    }
    if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      setFocused((f) => Math.max(f - 1, 0));
    }
    if (e.key === "Enter" && items[focused]) setOpenId(items[focused]!.id);
  };

  return (
    <div className="page wide">
      <div className="page-header">
        <h1 className="page-title">Memories</h1>
        <p className="page-sub" aria-live="polite">
          {loading
            ? "Loading…"
            : `${total.toLocaleString()} ${total === 1 ? "memory" : "memories"}`}
        </p>
      </div>

      <ConflictBanner count={conflicts.data?.total ?? 0} />

      <div className="toolbar" role="toolbar" aria-label="Search and filter memories">
        <div className="search-box">
          <Search size={15} />
          <input
            id="memory-search"
            className="input"
            placeholder="Search memories…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQ("");
            }}
            aria-label="Search memories"
            autoComplete="off"
          />
          {q && (
            <button
              className="icon-btn"
              style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}
              onClick={() => setQ("")}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="seg" role="group" aria-label="Memory level">
          {(["all", "core", "scene", "atomic", "raw"] as const).map((l) => (
            <button
              key={l}
              className={
                (l === "all" ? level.length === 0 : level.length === 1 && level[0] === l)
                  ? "active"
                  : ""
              }
              aria-pressed={l === "all" ? level.length === 0 : level.includes(l)}
              onClick={() => setLevel(l === "all" ? [] : [l])}
            >
              {l[0]!.toUpperCase() + l.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar" role="toolbar" aria-label="Filters">
        <Popover
          label={
            <>
              Project <ChevronDown size={13} />
            </>
          }
        >
          <Multi
            label="Project"
            options={projects.map((p) => p.name)}
            values={project ? [project] : []}
            onToggle={(v) => setProject(project === v ? "" : v)}
          />
        </Popover>
        <Popover
          label={
            <>
              Type <ChevronDown size={13} />
            </>
          }
        >
          <Multi
            label="Type"
            options={TYPES}
            values={type}
            onToggle={(v) => setType(toggle(type, v))}
          />
        </Popover>
        <Popover
          label={
            <>
              Scope <ChevronDown size={13} />
            </>
          }
        >
          <Multi
            label="Scope"
            options={SCOPES}
            values={scope}
            onToggle={(v) => setScope(toggle(scope, v))}
          />
        </Popover>
        <Popover
          label={
            <>
              Status <ChevronDown size={13} />
            </>
          }
        >
          <Multi
            label="Status"
            options={STATUSES}
            values={status}
            onToggle={(v) => setStatus(toggle(status, v))}
          />
        </Popover>
        <Popover
          label={
            <>
              Sort: {SORTS.find((s) => s.v === sort)?.label} <ChevronDown size={13} />
            </>
          }
          align="right"
        >
          {(close) => (
            <div>
              <div className="pop-label">Sort by</div>
              {SORTS.map((s) => (
                <button
                  key={s.v}
                  className="pop-item"
                  onClick={() => {
                    setSort(s.v);
                    close();
                  }}
                >
                  <span className="check">{sort === s.v ? "●" : ""}</span>
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </Popover>
        {debounced && (
          <span className="mode-hint">
            Search mode: <strong>{mode[0]!.toUpperCase() + mode.slice(1)}</strong> ·{" "}
            <button
              className="btn sm"
              style={{ padding: "2px 8px" }}
              onClick={() =>
                setMode(mode === "hybrid" ? "keyword" : mode === "keyword" ? "semantic" : "hybrid")
              }
              title="Cycle search mode"
            >
              switch
            </button>
          </span>
        )}
        {hasFilters ? (
          <button className="btn sm" onClick={clearAll}>
            Clear all
          </button>
        ) : null}
      </div>

      {loading ? (
        <Skeletons rows={8} />
      ) : error ? (
        <DbError error={error} onRetry={() => void load(true)} />
      ) : items.length === 0 ? (
        hasFilters ? (
          <NoResults onClear={clearAll} />
        ) : (
          <NoMemories />
        )
      ) : (
        <>
          <div className="list" role="list" aria-label="Memories" onKeyDown={onListKey}>
            <div className="list-head">
              <span>Memory</span>
              <span
                style={{ marginLeft: "auto" }}
                className="kbd"
                title="j/k to move, Enter to open"
              >
                j k ⏎
              </span>
            </div>
            {items.map((m, i) => (
              <div
                key={m.id}
                role="listitem"
                style={
                  i === focused
                    ? { outline: "2px solid var(--link)", outlineOffset: -2 }
                    : undefined
                }
              >
                <MemoryRow
                  memory={m}
                  selected={openId === m.id}
                  onOpen={(mm) => {
                    setFocused(i);
                    setOpenId(mm.id);
                  }}
                />
              </div>
            ))}
          </div>
          <div className="pagination">
            {items.length < total ? (
              <button className="btn" onClick={() => void load(false)} disabled={loadingMore}>
                {loadingMore
                  ? "Loading…"
                  : `Load more (${(total - items.length).toLocaleString()} remaining)`}
              </button>
            ) : (
              <span>Showing all {total.toLocaleString()} memories</span>
            )}
          </div>
        </>
      )}

      <MemoryDrawer
        id={openId}
        onClose={() => setOpenId(null)}
        onChanged={() => void load(true)}
        onOpen={(id) => setOpenId(id)}
      />
    </div>
  );
}

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function Multi({
  label,
  options,
  values,
  onToggle,
}: {
  label: string;
  options: string[];
  values: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div>
      <div className="pop-label">{label}</div>
      {options.map((o) => (
        <CheckItem key={o} checked={values.includes(o)} label={o} onToggle={() => onToggle(o)} />
      ))}
    </div>
  );
}
