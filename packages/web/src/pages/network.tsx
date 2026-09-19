import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Crosshair, Minus, Plus, Scan } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditMemoryModal, MemoryDrawer } from "../components/memory";
import { Confirm, Empty, useToast } from "../components/ui";
import { api } from "../lib/api";
import { formatDate, pct } from "../lib/format";
import {
  layoutGraph,
  matchedPaths,
  neighborhood,
  retrievalPath,
  type GraphEdge,
  type GraphLevel,
  type GraphNode,
  type MemoryGraph,
} from "../lib/graph";
import type { Memory } from "../lib/types";

type NeuronData = {
  node: GraphNode;
  dim: boolean;
  onPath: boolean;
};

const LEVEL_LABEL: Record<GraphLevel, string> = {
  L0: "L0 Raw",
  L1: "L1 Atomic",
  L2: "L2 Scene",
  L3: "L3 Core",
};

function useTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

const HEX: Record<"light" | "dark", Record<GraphLevel, string>> = {
  light: { L0: "#b7b7c0", L1: "#6f6f79", L2: "#2e2e35", L3: "#131316" },
  dark: { L0: "#4b4b54", L1: "#9b9ba6", L2: "#d6d6dc", L3: "#f2f2f4" },
};

const NeuronNode = memo(function NeuronNode({ data, selected }: NodeProps<Node<NeuronData>>) {
  const n = data.node;
  const cls = [
    "mneuron",
    n.level.toLowerCase(),
    n.matched ? "matched" : "",
    data.onPath ? "on-path" : "",
    n.status === "conflicted" ? "status-conflicted" : "",
    n.status === "superseded" ? "status-superseded" : "",
    data.dim ? "dim" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const style = {
    "--neuron-c":
      HEX[document.documentElement.dataset.theme === "dark" ? "dark" : "light"][n.level],
    "--neuron-bg": n.level === "L3" || n.level === "L2" ? "var(--bg-elevated)" : "transparent",
  } as React.CSSProperties;
  return (
    <div
      className={cls}
      style={style}
      role="img"
      aria-label={`${LEVEL_LABEL[n.level]}: ${n.label}. ${n.connectionCount} connections.`}
      title={`${n.label}`}
    >
      {n.level === "L2" && (n.memberCount ?? 0) > 0 && <span className="cnt">{n.memberCount}</span>}
      {selected ? <span className="sr-only">(selected)</span> : null}
    </div>
  );
});

const nodeTypes = { neuron: NeuronNode };

function edgeVisual(e: GraphEdge, theme: "light" | "dark") {
  const strong = theme === "dark" ? "#6d6d78" : "#8f8f99";
  const faint = theme === "dark" ? "#2b2b31" : "#d4d4d9";
  const warn = theme === "dark" ? "#fbbf24" : "#b45309";
  if (e.type === "contradicts")
    return { stroke: warn, width: 1.6, dashed: "5 4" as const, label: "contradicts" };
  if (e.type === "supersedes")
    return { stroke: strong, width: 1.6, dashed: "3 3" as const, label: "supersedes" };
  if (e.strength >= 0.75)
    return { stroke: strong, width: 2.6, dashed: undefined, label: e.type.replace(/_/g, " ") };
  if (e.strength >= 0.55)
    return { stroke: strong, width: 1.6, dashed: undefined, label: e.type.replace(/_/g, " ") };
  return { stroke: faint, width: 1, dashed: undefined, label: e.type.replace(/_/g, " ") };
}

const LEVELS: { v: string; label: string }[] = [
  { v: "all", label: "All" },
  { v: "L0", label: "L0" },
  { v: "L1", label: "L1" },
  { v: "L2", label: "L2" },
  { v: "L3", label: "L3" },
];

export function MemoryNetwork() {
  return (
    <ReactFlowProvider>
      <NetworkInner />
    </ReactFlowProvider>
  );
}

function NetworkInner() {
  const theme = useTheme();
  const toast = useToast();
  const rf = useReactFlow();
  const [level, setLevel] = useState("all");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [graph, setGraph] = useState<MemoryGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ node: GraphNode; x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ node: GraphNode; x: number; y: number } | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; action: "archive" | "delete" } | null>(
    null,
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(query.trim()), 280);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const g = await api.graph({ level, query: debounced || undefined });
      setGraph(g);
      setSelectedId(null);
      setFocusId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [level, debounced]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(null);
        setHover(null);
        if (selectedId || focusId) {
          setSelectedId(null);
          setFocusId(null);
        }
        return;
      }
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key.toLowerCase() === "f") rf.fitView({ padding: 0.18 });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedId, focusId, rf]);

  const byId = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);

  // Retrieval path: from search matches, else from the selected node.
  const paths = useMemo(() => {
    if (!graph) return { nodes: new Set<string>(), edges: new Set<string>() };
    if (debounced && graph.nodes.some((n) => n.matched)) return matchedPaths(graph);
    if (selectedId && byId.has(selectedId)) {
      const p = retrievalPath(graph.nodes, graph.edges, selectedId);
      return { nodes: p.nodes, edges: p.edges };
    }
    return { nodes: new Set<string>(), edges: new Set<string>() };
  }, [graph, debounced, selectedId, byId]);

  const focusSet = useMemo(() => {
    const f = focusId ?? selectedId;
    if (!graph || !f || !byId.has(f)) return null;
    return neighborhood(graph.edges, f, 2);
  }, [graph, focusId, selectedId, byId]);

  const positions = useMemo(
    () => (graph ? layoutGraph(graph.nodes, graph.edges) : new Map()),
    [graph],
  );

  const flowNodes: Node<NeuronData>[] = useMemo(
    () =>
      (graph?.nodes ?? []).map((n) => {
        const p = positions.get(n.id) ?? { x: 0, y: 0 };
        const dim = focusSet ? !focusSet.has(n.id) : false;
        return {
          id: n.id,
          type: "neuron",
          position: p,
          data: { node: n, dim, onPath: paths.edges.size > 0 && paths.nodes.has(n.id) },
          selected: selectedId === n.id,
        };
      }),
    [graph, positions, focusSet, paths, selectedId],
  );

  const flowEdges: Edge[] = useMemo(() => {
    const incident = new Set<string>();
    if (selectedId) {
      for (const e of graph?.edges ?? []) {
        if (e.source === selectedId || e.target === selectedId) incident.add(e.id);
      }
    }
    return (graph?.edges ?? []).map((e) => {
      const v = edgeVisual(e, theme);
      const inPath = paths.edges.has(e.id);
      const dim = focusSet ? !(focusSet.has(e.source) && focusSet.has(e.target)) : false;
      const labeled = inPath || incident.has(e.id);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        ...(labeled ? { label: v.label } : {}),
        labelStyle: { fontSize: 10, fill: "var(--text-secondary)" },
        labelBgStyle: { fill: "var(--bg-elevated)", fillOpacity: 0.9 },
        style: {
          stroke: inPath ? (theme === "dark" ? "#a8a8b3" : "#2e2e35") : v.stroke,
          strokeWidth: inPath ? 2.4 : v.width,
          ...(v.dashed ? { strokeDasharray: v.dashed } : {}),
        },
        className: `${dim ? "dimmed" : ""} ${inPath ? "flow" : ""}`.trim(),
        data: { label: v.label, type: e.type },
      };
    });
  }, [graph, theme, paths, focusSet, selectedId]);

  // Refit whenever the dataset changes (no animation: calm by default).
  useEffect(() => {
    if (graph) setTimeout(() => rf.fitView({ padding: 0.18 }), 30);
  }, [graph, rf]);

  const selected = selectedId ? byId.get(selectedId) : undefined;

  const openNode = useCallback((n: GraphNode) => {
    if (n.kind === "scene") window.location.hash = `#/scene/${n.refId}`;
    else if (n.kind === "event") window.location.hash = `#/source/${n.refId}`;
    else setDrawerId(n.refId);
  }, []);

  const focusNode = useCallback(
    (id: string) => {
      setFocusId(id);
      setSelectedId(id);
      // Center on the 1-hop neighborhood without animation.
      const adj = neighborhood(graph?.edges ?? [], id, 1);
      const pts = [...adj]
        .map((nid) => positions.get(nid))
        .filter((p): p is { x: number; y: number } => !!p);
      if (pts.length) {
        const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
        const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
        setTimeout(() => rf.setCenter(cx, cy, { zoom: Math.max(rf.getZoom(), 0.9) }), 30);
      }
    },
    [graph, positions, rf],
  );

  const doArchive = async (id: string, archive: boolean) => {
    await api.remove(id, archive);
    toast(archive ? "Memory archived" : "Memory deleted");
    setConfirming(null);
    setDrawerId(null);
    void load();
  };

  const pathCaption = useMemo(() => {
    if (!graph || paths.edges.size === 0) return null;
    const ordered = graph.nodes
      .filter((n) => paths.nodes.has(n.id))
      .sort((a, b) => Number(b.level.slice(1)) - Number(a.level.slice(1)));
    const top = ordered[0];
    if (!top) return null;
    const chain = ["L3", "L2", "L1", "L0"]
      .map((lv) => ordered.find((n) => n.level === lv)?.label)
      .filter(Boolean) as string[];
    return { top, chain };
  }, [graph, paths]);

  return (
    <div className="network-wrap" ref={wrapRef}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeClick={(_e, node) => {
          setSelectedId(node.id);
          setMenu(null);
        }}
        onNodeDoubleClick={(_e, node) => focusNode(node.id)}
        onNodeContextMenu={(e, node) => {
          e.preventDefault();
          const rect = wrapRef.current?.getBoundingClientRect();
          setMenu({
            node: (node.data as NeuronData).node,
            x: e.clientX - (rect?.left ?? 0),
            y: e.clientY - (rect?.top ?? 0),
          });
        }}
        onNodeMouseEnter={(e, node) => {
          const rect = wrapRef.current?.getBoundingClientRect();
          setHover({
            node: (node.data as NeuronData).node,
            x: e.clientX - (rect?.left ?? 0),
            y: e.clientY - (rect?.top ?? 0),
          });
        }}
        onNodeMouseLeave={() => setHover(null)}
        onPaneClick={() => {
          setMenu(null);
          setSelectedId(null);
          setFocusId(null);
        }}
        nodesConnectable={false}
        zoomOnDoubleClick={false}
        minZoom={0.25}
        maxZoom={2.5}
        proOptions={{ hideAttribution: false }}
        aria-label="Memory neuron network. Tab to reach nodes, Enter to select."
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={26}
          size={1.2}
          color="var(--memory-edge)"
        />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) =>
            HEX[theme][
              ((n.data as NeuronData | undefined)?.node.level ?? "L1") as keyof (typeof HEX)["dark"]
            ]
          }
          maskColor={theme === "dark" ? "rgba(12,12,14,0.72)" : "rgba(251,251,252,0.72)"}
          aria-label="Network minimap"
        />
      </ReactFlow>

      {/* Stats overlay */}
      <div className="net-panel net-stats" aria-label="Network statistics">
        <h2>Memory Network</h2>
        {graph ? (
          <>
            <div className="row-line">
              <span>
                {graph.nodes.length} nodes · {graph.edges.length} connections
              </span>
            </div>
            <div className="row-line">
              <span>L0 {graph.totals.L0.toLocaleString()}</span>
              <span>L1 {graph.totals.L1.toLocaleString()}</span>
            </div>
            <div className="row-line">
              <span>L2 {graph.totals.L2.toLocaleString()}</span>
              <span>L3 {graph.totals.L3.toLocaleString()}</span>
            </div>
            {graph.stats.strongestCore && (
              <div style={{ marginTop: 6 }}>
                <span className="muted">Strongest core · </span>
                <button
                  className="linklike"
                  onClick={() => focusNode(graph.stats.strongestCore!.id)}
                >
                  {graph.stats.strongestCore.label.slice(0, 42)}
                </button>
              </div>
            )}
            {graph.stats.mostConnected && (
              <div>
                <span className="muted">Most connected · </span>
                <button
                  className="linklike"
                  onClick={() => focusNode(graph.stats.mostConnected!.id)}
                >
                  {graph.stats.mostConnected.label.slice(0, 42)} (
                  {graph.stats.mostConnected.connections})
                </button>
              </div>
            )}
          </>
        ) : (
          <span className="muted">{loading ? "Loading network…" : "No data"}</span>
        )}
      </div>

      {/* Search + layer filter */}
      <div
        className="net-panel net-tools"
        role="toolbar"
        aria-label="Network search and layer filter"
      >
        <input
          className="input"
          placeholder="Search network…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
          aria-label="Search network"
          autoComplete="off"
        />
        <div className="seg" role="group" aria-label="Layer filter">
          {LEVELS.map((l) => (
            <button
              key={l.v}
              className={level === l.v ? "active" : ""}
              aria-pressed={level === l.v}
              onClick={() => setLevel(l.v)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="net-panel net-legend" aria-label="Layer legend">
        {(["L0", "L1", "L2", "L3"] as const).map((lv) => (
          <span className="li" key={lv}>
            <span
              className="dot"
              style={{ background: HEX[theme][lv], opacity: lv === "L0" ? 0.7 : 1 }}
            />
            {LEVEL_LABEL[lv]}
          </span>
        ))}
        <span className="li">
          <span
            className="dot"
            style={{
              background: "transparent",
              border: "1.5px dashed var(--warning)",
              borderRadius: "50%",
            }}
          />
          Conflict
        </span>
      </div>

      {/* Controls */}
      <div className="net-panel net-controls" role="toolbar" aria-label="Graph controls">
        <button
          className="icon-btn"
          onClick={() => rf.zoomIn()}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <Plus size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={() => rf.zoomOut()}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <Minus size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={() => rf.fitView({ padding: 0.18 })}
          aria-label="Fit graph"
          title="Fit (F)"
        >
          <Scan size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={() =>
            selectedId ? focusNode(selectedId) : (setSelectedId(null), setFocusId(null))
          }
          aria-label="Focus selection"
          title="Focus selection / clear"
        >
          <Crosshair size={15} />
        </button>
      </div>

      {/* Retrieval path caption */}
      {pathCaption && (
        <div className="net-panel net-path" aria-live="polite">
          <strong>Recall path</strong>
          <span className="muted">“{pathCaption.top.label.slice(0, 60)}”</span>
          {pathCaption.chain.length > 1 && (
            <span className="muted">· {pathCaption.chain.join(" → ")}</span>
          )}
        </div>
      )}

      {/* Hover card */}
      {hover && !menu && (
        <div
          className="net-panel"
          style={{
            left: Math.min(hover.x + 16, (wrapRef.current?.clientWidth ?? 400) - 260),
            top: Math.min(hover.y + 14, (wrapRef.current?.clientHeight ?? 400) - 150),
            maxWidth: 250,
            pointerEvents: "none",
          }}
          role="tooltip"
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{hover.node.label}</div>
          <div className="row-line" style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="muted">{LEVEL_LABEL[hover.node.level]}</span>
            <span className="muted">{hover.node.type.replace(/_/g, " ")}</span>
          </div>
          <div className="row-line" style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="muted">Confidence {pct(hover.node.confidence)}</span>
            <span className="muted">{hover.node.connectionCount} connections</span>
          </div>
          <div className="net-hint" style={{ marginTop: 4 }}>
            Click to inspect · double-click to focus
          </div>
        </div>
      )}

      {/* Context menu */}
      {menu && (
        <ContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onInspect={() => {
            openNode(menu.node);
            setMenu(null);
          }}
          onFocus={() => {
            focusNode(menu.node.id);
            setMenu(null);
          }}
          onEdit={() => {
            setEditingId(menu.node.kind === "memory" ? menu.node.refId : null);
            setMenu(null);
          }}
          onArchive={(archive) => {
            if (menu.node.kind === "memory")
              setConfirming({ id: menu.node.refId, action: archive ? "archive" : "delete" });
            setMenu(null);
          }}
        />
      )}

      {loading && !graph && (
        <div className="net-panel" style={{ top: 64, left: 12 }} role="status">
          <span className="muted">Loading network…</span>
        </div>
      )}
      {error && (
        <div className="net-panel" style={{ top: 64, left: 12, maxWidth: 320 }} role="alert">
          <strong>Unable to load network</strong>
          <p className="small muted">{error}</p>
          <button className="btn sm" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {graph && graph.nodes.length === 0 && !loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div style={{ pointerEvents: "auto", maxWidth: 380 }}>
            <Empty
              title={debounced ? "No matching nodes" : "Network is empty"}
              body={
                debounced
                  ? "Try a different query or layer."
                  : "Store memories or ingest a session to grow the network."
              }
              action={
                <a className="btn" href="#/memories">
                  Open memory list
                </a>
              }
            />
          </div>
        </div>
      )}

      <MemoryDrawer
        id={drawerId}
        onClose={() => setDrawerId(null)}
        onChanged={() => void load()}
        onOpen={(id) => setDrawerId(id)}
      />
      {editingId && (
        <EditMemoryLoader
          id={editingId}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            void load();
          }}
        />
      )}
      {confirming && (
        <Confirm
          title={confirming.action === "archive" ? "Archive memory?" : "Delete memory?"}
          body={
            confirming.action === "archive"
              ? "The memory will be hidden from future retrieval but kept in the database."
              : "This will remove the memory from future retrieval."
          }
          note="Its original source will remain unless explicitly deleted."
          confirmLabel={confirming.action === "archive" ? "Archive" : "Delete"}
          danger={confirming.action === "delete"}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void doArchive(confirming.id, confirming.action === "archive")}
        />
      )}
      {selected && (
        <span className="sr-only" aria-live="polite">
          Selected {selected.label}
        </span>
      )}
    </div>
  );
}

function ContextMenu({
  menu,
  onClose,
  onInspect,
  onFocus,
  onEdit,
  onArchive,
}: {
  menu: { node: GraphNode; x: number; y: number };
  onClose: () => void;
  onInspect: () => void;
  onFocus: () => void;
  onEdit: () => void;
  onArchive: (archive: boolean) => void;
}) {
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".net-menu")) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const isMemory = menu.node.kind === "memory";
  const item = (label: string, fn: () => void, danger = false) => (
    <button
      key={label}
      className="pop-item"
      style={danger ? { color: "var(--danger)" } : undefined}
      onClick={fn}
      role="menuitem"
    >
      {label}
    </button>
  );
  return (
    <div
      className="net-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      aria-label={`Actions for ${menu.node.label}`}
    >
      {item(
        menu.node.kind === "scene"
          ? "Open scene"
          : menu.node.kind === "event"
            ? "Open source"
            : "Inspect",
        onInspect,
      )}
      {item("View related (focus)", onFocus)}
      {isMemory && item("Edit", onEdit)}
      {isMemory && item("Archive", () => onArchive(true))}
      {isMemory && item("Delete", () => onArchive(false), true)}
      <div className="net-hint" style={{ padding: "4px 9px" }}>
        {LEVEL_LABEL[menu.node.level]} · {menu.node.connectionCount} connections ·{" "}
        {formatDate(menu.node.updatedAt)}
      </div>
    </div>
  );
}

function EditMemoryLoader({
  id,
  onClose,
  onSaved,
}: {
  id: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [memory, setMemory] = useState<Memory | null>(null);
  useEffect(() => {
    api
      .inspect(id)
      .then((insp) => setMemory(insp.memory))
      .catch(() => setMemory(null));
  }, [id]);
  if (!memory) return null;
  return <EditMemoryModal memory={memory} onClose={onClose} onSaved={onSaved} />;
}
