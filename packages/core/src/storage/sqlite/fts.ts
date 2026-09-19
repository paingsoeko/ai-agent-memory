import { STOPWORDS, tokenize } from "../../util/text.js";

/**
 * Build an FTS5 MATCH expression from a free-text query.
 * - Tokens are quoted (safe against FTS syntax), stopwords removed.
 * - Tokens with >= 4 chars also get prefix matching (`term*`) for fuzziness.
 * - Tokens are OR-ed so partial matches still rank (bm25 rewards more hits).
 * Returns null when the query has no usable tokens.
 */
export function buildFtsQuery(query: string): string | null {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const raw of tokenize(query)) {
    const tok = raw.replace(/"/g, "");
    if (!tok || tok.length < 2 || STOPWORDS.has(tok) || seen.has(tok)) continue;
    seen.add(tok);
    const quoted = `"${tok}"`;
    parts.push(tok.length >= 4 ? `(${quoted} OR ${quoted}*)` : quoted);
    if (parts.length >= 24) break;
  }
  if (parts.length === 0) return null;
  return parts.join(" OR ");
}
