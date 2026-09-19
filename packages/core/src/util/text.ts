import { createHash } from "node:crypto";

/** Small English stopword list used for keyword extraction and similarity. */
export const STOPWORDS = new Set(
  "a an the and or but if then else when while of at by for with about against between into through during before after above below to from up down in out on off over under again further once here there why how all any both each few more most other some such no nor not only own same so than too very s t can will just don should now is are was were be been being have has had having do does did doing i me my we our you your he him his she her it its they them their what which who whom this that these those am as until because until would could shall may might must also into onto per via etc".split(
    /\s+/,
  ),
);

export function normalizeContent(content: string): string {
  return content
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!;:,]+$/g, "")
    .toLowerCase();
}

export function contentHash(content: string): string {
  return createHash("sha256").update(normalizeContent(content)).digest("hex").slice(0, 32);
}

/** Very small Porter-ish stemmer: enough for duplicate detection, not linguistics. */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length <= 3) return w;
  const rules: [RegExp, string][] = [
    [/ies$/, "y"],
    [/sses$/, "ss"],
    [/([^s])s$/, "$1"],
    [/(at|iz|is)ation$/, "$1e"],
    [/ations?$/, "ate"],
    [/ingly$/, ""],
    [/ing$/, ""],
    [/edly$/, ""],
    [/ed$/, ""],
    [/ly$/, ""],
    [/ness$/, ""],
    [/ment$/, ""],
    [/ers?$/, ""],
    [/ally$/, "al"],
  ];
  for (const [re, rep] of rules) {
    if (re.test(w)) {
      const next = w.replace(re, rep);
      if (next.length >= 3) {
        w = next;
        break;
      }
    }
  }
  return w.replace(/(.)\1$/, "$1");
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}_][\p{L}\p{N}_.\-/]*/gu) ?? [])
    .map((t) => t.replace(/^[.\-/]+|[.\-/]+$/g, ""))
    .filter(Boolean);
}

/** Significant, stemmed terms (no stopwords, length >= 2). */
export function keyTerms(text: string): string[] {
  const out: string[] = [];
  for (const tok of tokenize(text)) {
    if (STOPWORDS.has(tok)) continue;
    if (tok.length < 2) continue;
    out.push(stem(tok));
  }
  return out;
}

export function termSet(text: string): Set<string> {
  return new Set(keyTerms(text));
}

/**
 * Fuzzy term equality: identical stems, or one is a short-suffix extension of
 * the other ("use"/"used"/"using", "start"/"started"), never "pay"/"payroll".
 */
export function termsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.length - short.length <= 3 && long.startsWith(short);
}

function fuzzyIntersection(a: Set<string>, b: Set<string>): number {
  const remaining = new Set(b);
  let inter = 0;
  for (const t of a) {
    if (remaining.has(t)) {
      remaining.delete(t);
      inter++;
      continue;
    }
    for (const u of remaining) {
      if (termsMatch(t, u)) {
        remaining.delete(u);
        inter++;
        break;
      }
    }
  }
  return inter;
}

/** Sørensen–Dice coefficient over key-term sets (with fuzzy term matching). */
export function diceSimilarity(a: string, b: string): number {
  const sa = termSet(a);
  const sb = termSet(b);
  if (sa.size === 0 && sb.size === 0) return normalizeContent(a) === normalizeContent(b) ? 1 : 0;
  const inter = fuzzyIntersection(sa, sb);
  return (2 * inter) / (sa.size + sb.size);
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const inter = fuzzyIntersection(a, b);
  return inter / (a.size + b.size - inter);
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function truncate(text: string, max = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

export function titleCase(words: string[]): string {
  return words.map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(" ");
}

/** Split text into sentences, keeping code blocks out. */
export function splitSentences(text: string): string[] {
  const noCode = text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
  const parts = noCode
    .split(/(?<=[.!?])\s+(?=[A-Z"'(\-•*\d])|\n{2,}|\n(?=\s*[-*•]\s)|\n(?=\s*\d+[.)]\s)/)
    .map((s) =>
      s
        .replace(/^\s*[-*•]\s*/, "")
        .replace(/^\s*\d+[.)]\s*/, "")
        .trim(),
    )
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    for (const line of p.split(/\n/)) {
      const t = line.trim();
      if (t) out.push(t);
    }
  }
  return out;
}
