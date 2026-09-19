import type {
  Memory,
  MemoryInspection,
  MemoryResult,
  MemoryStats,
  RawEvent,
  SceneMemory,
} from "@local-ai-agent-memory/core";
import { shortId } from "@local-ai-agent-memory/core";

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));

export function memoryLine(m: Memory, score?: number): string {
  const bits = [m.type, m.projectId ? `project:${m.projectId}` : m.scope];
  if (m.level === "core") bits.push("core");
  if (m.status !== "active") bits.push(m.status);
  const prefix = score !== undefined ? `${score.toFixed(3)}  ` : "";
  return `${prefix}${shortId(m.id)}  [${bits.join(" | ")}]  ${m.content}`;
}

export function formatResults(results: MemoryResult[], verbose = false): string {
  if (results.length === 0) return "No memories found.";
  return results
    .map(
      (r) =>
        memoryLine(r.memory, r.score) +
        (verbose && r.explanation ? `\n         ↳ ${r.source}: ${r.explanation}` : ""),
    )
    .join("\n");
}

export function formatList(memories: Memory[]): string {
  if (memories.length === 0) return "No memories.";
  return memories.map((m) => memoryLine(m)).join("\n");
}

function kv(rows: [string, string | number | undefined | null][]): string {
  const width = Math.max(...rows.map(([k]) => k.length));
  return rows
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${pad(k, width)}  ${v}`)
    .join("\n");
}

export function formatEvent(e: RawEvent): string {
  return `${shortId(e.id)}  [${e.kind}${e.role ? "/" + e.role : ""}${e.agent ? " " + e.agent : ""}]  ${e.content.replace(/\s+/g, " ").slice(0, 160)}`;
}

export function formatInspection(i: MemoryInspection): string {
  const m = i.memory;
  const out: string[] = [];
  out.push(
    kv([
      ["Memory", m.id],
      ["Content", m.content],
      ["Type", m.type],
      ["Level", m.level],
      ["Scope", m.scope],
      ["Status", m.status],
      ["Project", m.projectId],
      ["Session", m.sessionId],
      ["Agent", m.agent],
      ["Confidence", m.confidence.toFixed(2)],
      ["Importance", m.importance.toFixed(2)],
      [
        "Accessed",
        `${m.accessCount}x${m.lastAccessedAt ? " (last " + m.lastAccessedAt.toISOString() + ")" : ""}`,
      ],
      ["Tags", m.tags.join(", ")],
      ["Sensitive", m.sensitive ? "yes" : undefined],
      ["Created", m.createdAt.toISOString()],
      ["Updated", m.updatedAt.toISOString()],
      ["Expires", m.expiresAt?.toISOString()],
      [
        "Supersedes",
        i.supersedes ? `${shortId(i.supersedes.id)}  ${i.supersedes.content}` : undefined,
      ],
      [
        "Superseded by",
        i.supersededBy ? `${shortId(i.supersededBy.id)}  ${i.supersededBy.content}` : undefined,
      ],
      [
        "Merged",
        Number(m.metadata.mergeCount ?? 0) > 0
          ? `${m.metadata.mergeCount} duplicate(s) merged`
          : undefined,
      ],
    ]),
  );
  out.push("", `Derived from (${i.sources.length} raw event${i.sources.length === 1 ? "" : "s"}):`);
  out.push(
    ...(i.sources.length
      ? i.sources.map((e) => "  " + formatEvent(e))
      : ["  (manual entry, no raw events)"]),
  );
  if (Array.isArray(m.metadata.aliases) && (m.metadata.aliases as string[]).length) {
    out.push("", "Also stated as:", ...(m.metadata.aliases as string[]).map((a) => `  - ${a}`));
  }
  out.push(
    "",
    `Scenes (${i.scenes.length}):`,
    ...(i.scenes.length
      ? i.scenes.map((s) => `  ${shortId(s.id)}  ${s.name} (${s.memoryIds.length} memories)`)
      : ["  (none)"]),
  );
  out.push(
    "",
    `Related memories (${i.related.length}):`,
    ...(i.related.length ? i.related.map((r) => "  " + memoryLine(r)) : ["  (none)"]),
  );
  if (i.history.length)
    out.push(
      "",
      "History:",
      ...i.history.map(
        (h) =>
          `  ${h.at}  ${h.action}${h.detail ? " — " + h.detail : ""}${h.relatedId ? " (" + shortId(h.relatedId) + ")" : ""}`,
      ),
    );
  return out.join("\n");
}

export function formatStats(s: MemoryStats): string {
  const dist = (o: Record<string, number>) =>
    Object.entries(o)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(", ") || "-";
  return kv([
    ["Database", s.dbPath],
    ["Size", s.dbSizeBytes !== undefined ? `${(s.dbSizeBytes / 1024).toFixed(1)} KiB` : undefined],
    ["Memories", s.memories],
    ["  by level", dist(s.byLevel)],
    ["  by status", dist(s.byStatus)],
    ["  by scope", dist(s.byScope)],
    ["  by type", dist(s.byType)],
    ["Raw events", s.events],
    ["Scenes", s.scenes],
    ["Projects", s.projects],
    ["Embeddings", s.embeddings],
  ]);
}

export function formatScene(s: SceneMemory, members?: Memory[]): string {
  const head = `${shortId(s.id)}  ${s.name}  (${s.memoryIds.length} memories${s.projectId ? ", project " + s.projectId : ""})`;
  if (!members) return head;
  return [
    head,
    s.summary ? "  " + s.summary.replace(/\n/g, "\n  ") : "",
    "",
    ...members.map((m) => "  " + memoryLine(m)),
  ].join("\n");
}

export { kv };
