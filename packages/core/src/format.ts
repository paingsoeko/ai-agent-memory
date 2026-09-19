import type { Memory, MemoryResult } from "./types.js";

export interface FormatOptions {
  /** Max total characters (default 4000). */
  maxChars?: number;
  header?: string;
  /** Include ids so the agent can inspect/forget (default true). */
  includeIds?: boolean;
  includeScores?: boolean;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * Render memories as a compact markdown block suitable for injecting into an
 * agent's system prompt or context window. Agent-agnostic: plain markdown.
 */
export function formatMemoriesForPrompt(
  items: (MemoryResult | Memory)[],
  options: FormatOptions = {},
): string {
  const maxChars = options.maxChars ?? 4000;
  const header = options.header ?? "## Relevant memories";
  const lines: string[] = [header];
  let used = header.length;
  for (const item of items) {
    const mem = "memory" in item ? item.memory : item;
    const score = "score" in item ? item.score : undefined;
    const tags = [
      mem.type,
      mem.projectId ? `project:${mem.projectId}` : mem.scope,
      mem.level === "core" ? "core" : null,
    ].filter(Boolean);
    let line = `- [${tags.join(" | ")}] ${mem.content.replace(/\s+/g, " ").trim()}`;
    if (options.includeIds !== false) line += ` (id: ${shortId(mem.id)})`;
    if (options.includeScores && score !== undefined) line += ` [score ${score.toFixed(2)}]`;
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length === 1) lines.push("_(none)_");
  return lines.join("\n");
}
