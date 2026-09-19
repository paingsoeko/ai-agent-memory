import { ShieldCheck } from "lucide-react";
import { DbBadge, Skeletons } from "../components/ui";
import { api, isDemo, useFetch } from "../lib/api";
import { formatBytes } from "../lib/format";

export function Settings() {
  const privacy = useFetch(() => api.privacy(), []);
  const config = useFetch(() => api.config(), []);
  const stats = useFetch(() => api.stats(), []);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-sub">Storage, search, embeddings, privacy and integrations.</p>
      </div>

      <section className="section" style={{ marginTop: 0 }} aria-labelledby="s-storage">
        <h2 className="section-title" id="s-storage">
          Storage
        </h2>
        {stats.loading ? (
          <Skeletons rows={2} />
        ) : (
          <div className="card">
            <div className="card-row">
              <span className="muted">Database</span>
              <DbBadge />
            </div>
            <div className="card-row" style={{ marginTop: 6 }}>
              <span className="muted">Size</span>
              <span className="small">
                {formatBytes((stats.data as { dbSizeBytes?: number } | null)?.dbSizeBytes)} ·{" "}
                {(stats.data?.memories ?? 0).toLocaleString()} memories ·{" "}
                {(stats.data?.events ?? 0).toLocaleString()} events
              </span>
            </div>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="s-search">
        <h2 className="section-title" id="s-search">
          Search
        </h2>
        <div className="card">
          {config.loading ? (
            <p className="muted small">Loading…</p>
          ) : (
            <SettingRows
              rows={[
                ["Keyword search", bool((config.data as Config)?.search?.keyword)],
                ["Semantic search", bool((config.data as Config)?.search?.semantic)],
                [
                  "Hybrid search",
                  (config.data as Config)?.search?.mode === "hybrid" ||
                  (config.data as Config)?.search?.semantic
                    ? "On"
                    : "Off",
                ],
              ]}
            />
          )}
        </div>
      </section>

      <section className="section" aria-labelledby="s-emb">
        <h2 className="section-title" id="s-emb">
          Embeddings
        </h2>
        <div className="card">
          {config.loading ? (
            <p className="muted small">Loading…</p>
          ) : (
            <SettingRows
              rows={[
                ["Provider", String((config.data as Config)?.embeddings?.provider ?? "none")],
                ["Model", String((config.data as Config)?.embeddings?.model ?? "—")],
                [
                  "Network",
                  (config.data as Config)?.embeddings?.network === "required"
                    ? "Remote (opt-in)"
                    : "Local",
                ],
              ]}
            />
          )}
        </div>
      </section>

      <section className="section" aria-labelledby="s-privacy">
        <h2 className="section-title" id="s-privacy">
          Privacy
        </h2>
        <div
          className="card"
          style={{ borderColor: "color-mix(in srgb, var(--success) 40%, transparent)" }}
        >
          <p
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              margin: "0 0 8px",
              fontWeight: 650,
            }}
          >
            <ShieldCheck size={15} /> Local-only mode — your memory stays on this device.
          </p>
          {privacy.loading ? (
            <p className="muted small">Loading…</p>
          ) : (
            <SettingRows
              rows={[
                ["Telemetry", String((privacy.data as Privacy)?.telemetry ?? "disabled")],
                ["Cloud sync", String((privacy.data as Privacy)?.cloudSync ?? "disabled")],
                ["Network access", String((privacy.data as Privacy)?.network ?? "disabled")],
                [
                  "Encryption",
                  String((privacy.data as Privacy)?.encryption ?? "none (SQLite file)"),
                ],
              ]}
            />
          )}
        </div>
      </section>

      <section className="section" aria-labelledby="s-int">
        <h2 className="section-title" id="s-int">
          Integrations
        </h2>
        <div className="card">
          <SettingRows
            rows={[
              ["MCP", isDemo() ? "demo" : "available via `aam mcp`"],
              ["Claude Code", "claude mcp add ai-memory"],
              ["Codex", "~/.codex/config.toml"],
              ["Gemini CLI", "~/.gemini/settings.json"],
              ["OpenCode", "opencode.json → mcp"],
            ]}
          />
          <p className="small muted" style={{ marginBottom: 0 }}>
            Run <span className="kbd">aam mcp</span> in a terminal for the exact configuration
            snippet.
          </p>
        </div>
      </section>

      <div className="footer-note">
        <ShieldCheck size={13} />
        Your memory. Your machine. Your agents. Your data.
      </div>
    </div>
  );
}

interface Config {
  search?: { keyword?: boolean; semantic?: boolean; mode?: string };
  embeddings?: { provider?: string; model?: string; network?: string };
}
interface Privacy {
  telemetry?: string;
  cloudSync?: string;
  network?: string;
  encryption?: string;
}

function bool(v: unknown): string {
  return v ? "On" : "Off";
}

function SettingRows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="kv" style={{ margin: 0 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
