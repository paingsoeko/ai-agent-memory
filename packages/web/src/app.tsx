import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { Shell } from "./components/shell";
import { ToastHost } from "./components/ui";
import { checkHealth, api } from "./lib/api";
import type { Route } from "./lib/types";
import { ConflictsPage } from "./pages/conflicts";
import { CoreMemory } from "./pages/core";
import { Memories } from "./pages/memories";
import { Skeletons } from "./components/ui";
import { Overview } from "./pages/overview";
import { ProjectDetail, Projects } from "./pages/projects";
import { SceneDetail, Scenes } from "./pages/scenes";
import { SearchPage } from "./pages/search";
import { SessionDetail, Sessions } from "./pages/sessions";
import { Settings } from "./pages/settings";
import { SourceDetail, Sources } from "./pages/sources";

// Heavy graph bundle loads on demand so list pages stay fast.
const MemoryNetwork = lazy(() =>
  import("./pages/network").then((m) => ({ default: m.MemoryNetwork })),
);

function parseHash(): { route: Route; params: URLSearchParams } {
  const raw = window.location.hash.replace(/^#/, "") || "/overview";
  const [path, query] = raw.split("?");
  const params = new URLSearchParams(query ?? "");
  const seg = (path ?? "/overview").split("/").filter(Boolean);

  if (seg[0] === "memories") return { route: { name: "memories" }, params };
  if (seg[0] === "network") return { route: { name: "network" }, params };
  if (seg[0] === "scenes") return { route: { name: "scenes" }, params };
  if (seg[0] === "scene" && seg[1])
    return { route: { name: "scene", id: decodeURIComponent(seg[1]) }, params };
  if (seg[0] === "core") return { route: { name: "core" }, params };
  if (seg[0] === "projects") return { route: { name: "projects" }, params };
  if (seg[0] === "project" && seg[1])
    return { route: { name: "project", id: decodeURIComponent(seg.slice(1).join("/")) }, params };
  if (seg[0] === "sessions") return { route: { name: "sessions" }, params };
  if (seg[0] === "session" && seg[1])
    return { route: { name: "session", id: decodeURIComponent(seg.slice(1).join("/")) }, params };
  if (seg[0] === "sources") return { route: { name: "sources" }, params };
  if (seg[0] === "source" && seg[1])
    return { route: { name: "source", id: decodeURIComponent(seg[1]) }, params };
  if (seg[0] === "search")
    return { route: { name: "search", q: params.get("q") ?? undefined }, params };
  if (seg[0] === "settings") return { route: { name: "settings" }, params };
  if (seg[0] === "conflicts")
    return {
      route: { name: "memories" },
      params: new URLSearchParams("status=conflicted&view=conflicts"),
    };
  return { route: { name: "overview" }, params };
}

export function App() {
  const [{ route, params }, setLoc] = useState(parseHash);
  const [conflictCount, setConflictCount] = useState(0);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => {
      setLoc(parseHash());
      if (!window.location.hash.includes("open=")) setOpenId(null);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    void checkHealth().then(() => {
      api
        .projects()
        .then(setProjects)
        .catch(() => {});
      api
        .conflicts()
        .then((c) => setConflictCount(c.total))
        .catch(() => {});
    });
  }, [route.name]);

  const openMemory = useCallback(
    (id: string) => {
      // If the ref looks like a scene, go there instead.
      if (id.startsWith("scene-")) {
        window.location.hash = `#/scene/${id}`;
        return;
      }
      if (route.name !== "memories") {
        window.location.hash = `#/memories?open=${encodeURIComponent(id)}`;
      }
      setOpenId(id);
    },
    [route.name],
  );

  // Keep drawer state in sync with ?open= param on memories route.
  const paramOpen = params.get("open");
  const paramStatus = params.get("status");

  return (
    <ToastHost>
      <Shell route={route} conflictCount={conflictCount}>
        {route.name === "overview" && (
          <Overview onOpenMemory={openMemory} onConflictCount={setConflictCount} />
        )}
        {route.name === "memories" && (
          <Memories
            key={`${paramOpen ?? ""}|${paramStatus ?? ""}`}
            initialOpenId={paramOpen ?? openId}
            initialStatus={
              paramStatus === "conflicted" || window.location.hash.includes("conflicts")
                ? "conflicted"
                : null
            }
            projects={projects}
            onConflictCount={setConflictCount}
          />
        )}
        {route.name === "scenes" && <Scenes />}
        {route.name === "network" && (
          <Suspense
            fallback={
              <div className="page">
                <Skeletons rows={4} />
              </div>
            }
          >
            <MemoryNetwork />
          </Suspense>
        )}
        {route.name === "scene" && <SceneDetail id={route.id} />}
        {route.name === "core" && <CoreMemory />}
        {route.name === "projects" && <Projects />}
        {route.name === "project" && <ProjectDetail id={route.id} />}
        {route.name === "sessions" && <Sessions />}
        {route.name === "session" && <SessionDetail id={route.id} />}
        {route.name === "sources" && <Sources />}
        {route.name === "source" && <SourceDetail id={route.id} />}
        {route.name === "search" && <SearchPage key={route.q ?? ""} initialQ={route.q} />}
        {route.name === "settings" && <Settings />}
        {params.get("view") === "conflicts" && <ConflictsOverlay onCount={setConflictCount} />}
      </Shell>
    </ToastHost>
  );
}

function ConflictsOverlay({ onCount }: { onCount: (n: number) => void }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!open) window.location.hash = "#/memories?status=conflicted";
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-wrap" style={{ alignItems: "center" }}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Resolve conflicts"
        style={{ width: "min(640px, 100%)" }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn sm" onClick={() => setOpen(false)}>
            Back to memories
          </button>
        </div>
        <ConflictsPage onCount={onCount} />
      </div>
    </div>
  );
}
