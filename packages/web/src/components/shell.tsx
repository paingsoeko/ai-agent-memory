import {
  BookOpen,
  Boxes,
  Clock3,
  Compass,
  Database,
  FolderGit2,
  Layers,
  Moon,
  Network,
  Search,
  Settings,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, isDemo } from "../lib/api";
import type { Route } from "../lib/types";

const NAV: {
  section?: string;
  name: string;
  route: Route["name"];
  icon: React.ReactNode;
  kbd?: string;
}[] = [
  { name: "Overview", route: "overview", icon: <Compass size={15} /> },
  {
    section: "Memory",
    name: "Memories",
    route: "memories",
    icon: <BookOpen size={15} />,
    kbd: "⌘/",
  },
  { name: "Memory Network", route: "network", icon: <Network size={15} /> },
  { name: "Scenes", route: "scenes", icon: <Layers size={15} /> },
  { name: "Core Memory", route: "core", icon: <Boxes size={15} /> },
  { section: "Context", name: "Projects", route: "projects", icon: <FolderGit2 size={15} /> },
  { name: "Sessions", route: "sessions", icon: <Clock3 size={15} /> },
  { name: "Sources", route: "sources", icon: <Database size={15} /> },
  { section: "System", name: "Search", route: "search", icon: <Search size={15} />, kbd: "⌘K" },
  { name: "Settings", route: "settings", icon: <Settings size={15} /> },
];

export function Shell({
  route,
  conflictCount,
  children,
}: {
  route: Route;
  conflictCount: number;
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");

  const toggleTheme = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("ai-memory-theme", next);
    setDark(!dark);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
      if (mod && e.key === "/") {
        e.preventDefault();
        window.location.hash = "#/memories";
        setTimeout(() => document.getElementById("memory-search")?.focus(), 60);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setNavOpen(false);
  }, [route]);

  let lastSection = "";
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <button
          className="icon-btn drawer-toggle"
          aria-label="Toggle navigation"
          onClick={() => setNavOpen((o) => !o)}
        >
          <SlidersHorizontal size={16} />
        </button>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1L11 4v4L6 11 1 8V4L6 1z" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="6" cy="6" r="1.4" fill="currentColor" />
            </svg>
          </span>
          AI Memory
        </div>
        <div className="topbar-search">
          <button
            className="search-trigger"
            onClick={() => setPaletteOpen(true)}
            aria-label="Global search (Command K)"
          >
            <Search size={14} />
            <span className="hint-text">Search memories, scenes…</span>
            <span className="kbd" aria-hidden="true">
              ⌘K
            </span>
          </button>
          <button
            className="icon-btn bordered"
            onClick={toggleTheme}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            title={dark ? "Light mode (t)" : "Dark mode (t)"}
          >
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <a className="icon-btn bordered" href="#/settings" aria-label="Settings" title="Settings">
            <Settings size={15} />
          </a>
        </div>
      </header>
      <div className="app-body">
        <nav className={`sidebar ${navOpen ? "open" : ""}`} aria-label="Primary">
          {NAV.map((item) => {
            const head =
              item.section && item.section !== lastSection ? (
                <div className="nav-section" key={`s-${item.section}`}>
                  {((lastSection = item.section), item.section)}
                </div>
              ) : null;
            const active =
              route.name === item.route || (item.route === "memories" && route.name === "core");
            return (
              <React.Fragment key={item.route + item.name}>
                {head}
                <a
                  className={`nav-item ${active ? "active" : ""}`}
                  href={`#/${item.route}`}
                  aria-current={active ? "page" : undefined}
                  title={item.kbd ? `${item.name} (${item.kbd})` : item.name}
                >
                  {item.icon}
                  {item.name}
                  {item.route === "memories" && conflictCount > 0 && (
                    <span className="count">{conflictCount}</span>
                  )}
                </a>
              </React.Fragment>
            );
          })}
          <div className="sidebar-foot">
            <div
              className="privacy-chip"
              title="Local-only mode: memory never leaves this device unless embeddings are explicitly enabled."
            >
              <span className="privacy-dot" aria-hidden="true" />
              Local-only{isDemo() ? " · demo" : ""}
            </div>
          </div>
        </nav>
        <main className="main" id="main" tabIndex={-1}>
          {children}
        </main>
      </div>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

/* ---------------- Command palette ---------------- */

function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<
    { group: string; title: string; sub: string; href: string }[]
  >([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const [search, scenes, projects] = await Promise.all([
          api.search(q.trim()).catch(() => ({ data: [], total: 0, mode: "hybrid" })),
          api.scenes().catch(() => []),
          api.projects().catch(() => []),
        ]);
        const out: typeof results = [];
        for (const r of search.data.slice(0, 5)) {
          out.push({
            group: "Memories",
            title: r.memory.content.slice(0, 90),
            sub: `${r.memory.type} · ${r.memory.level} · ${(r.score ?? 0).toFixed(2)}`,
            href: `#/memories?open=${r.memory.id}`,
          });
        }
        for (const s of scenes
          .filter((s) => s.name.toLowerCase().includes(q.toLowerCase()))
          .slice(0, 3)) {
          out.push({
            group: "Scenes",
            title: s.name,
            sub: `${s.memoryIds.length} memories`,
            href: `#/scene/${s.id}`,
          });
        }
        for (const p of projects
          .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
          .slice(0, 3)) {
          out.push({
            group: "Projects",
            title: p.name,
            sub: `${p.memoryCount ?? 0} memories`,
            href: `#/project/${encodeURIComponent(p.id)}`,
          });
        }
        setResults(out);
        setActive(0);
      } catch {
        /* keep previous */
      }
    }, 180);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  const groups = useMemo(() => {
    const order = ["Memories", "Scenes", "Projects"];
    return order
      .map((g) => ({ g, items: results.map((r, i) => ({ ...r, i })).filter((r) => r.group === g) }))
      .filter((x) => x.items.length);
  }, [results]);

  const flat = results;
  const go = (href: string) => {
    window.location.hash = href;
    onClose();
  };

  return (
    <div
      className="modal-wrap"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        style={{ padding: 12 }}
      >
        <div className="search-box">
          <Search size={15} />
          <input
            ref={inputRef}
            id="global-search"
            className="input"
            placeholder="Search memories, scenes, projects, sessions…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, flat.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              }
              if (e.key === "Enter" && flat[active]) go(flat[active]!.href);
            }}
            aria-label="Global search"
          />
        </div>
        <div className="palette-results" role="listbox" aria-label="Search results">
          {q.trim() === "" && (
            <p className="small muted" style={{ padding: "10px 6px" }}>
              Type to search across memories, scenes, projects and sessions. Press{" "}
              <span className="kbd">esc</span> to close.
            </p>
          )}
          {q.trim() !== "" && results.length === 0 && (
            <p className="small muted" style={{ padding: "10px 6px" }}>
              No matches yet — keep typing.
            </p>
          )}
          {groups.map(({ g, items }) => (
            <div key={g}>
              <div className="palette-group">{g}</div>
              {items.map(({ i, title, sub, href }) => (
                <button
                  key={i}
                  className={`palette-item ${i === active ? "active" : ""}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(href)}
                >
                  <span className="t">{title}</span>
                  <span className="s">{sub}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
        {q.trim() && (
          <div
            style={{ padding: "8px 4px 2px", borderTop: "1px solid var(--border)", marginTop: 8 }}
          >
            <button className="btn sm" onClick={() => go(`#/search?q=${encodeURIComponent(q)}`)}>
              Open full search for “{q.slice(0, 40)}”
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
