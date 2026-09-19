import { jaccardSimilarity, keyTerms, termSet } from "../util/text.js";

export interface Statement {
  subject: string;
  predicate: string;
  object: string;
  objectTerms: Set<string>;
}

const PREDICATES = [
  "is stored in",
  "is built with",
  "is written in",
  "is deployed to",
  "is deployed on",
  "should be",
  "must be",
  "defaults to",
  "runs on",
  "lives in",
  "live in",
  "belongs to",
  "uses",
  "use",
  "using",
  "prefers",
  "prefer",
  "requires",
  "require",
  "is",
  "are",
  "was",
  "were",
  "equals",
];

const PREDICATE_NORMALIZE: Record<string, string> = {
  is: "is",
  are: "is",
  was: "is",
  were: "is",
  equals: "is",
  "=": "is",
  ":": "is",
  "->": "is",
  "→": "is",
  uses: "use",
  use: "use",
  using: "use",
  prefers: "prefer",
  prefer: "prefer",
  requires: "require",
  require: "require",
  "live in": "lives in",
  "lives in": "lives in",
  "is deployed on": "is deployed to",
  "is deployed to": "is deployed to",
  "should be": "is",
  "must be": "is",
  "defaults to": "is",
};

const predicateRe = new RegExp(
  `^(.{1,80}?)\\s+(${PREDICATES.map((p) => p.replace(/\s+/g, "\\s+")).join("|")})\\s+(.{1,200})$`,
  "i",
);
const symbolRe = /^(.{1,80}?)\s*(=|:|->|→)\s*(.{1,200})$/;

/**
 * Parse "Subject <predicate> Object" statements. Heuristic on purpose: it only
 * needs to catch the common "X uses Y" / "X = Y" shapes that make up most
 * architecture decisions and preferences.
 */
export function parseStatement(content: string): Statement | null {
  const text = content
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!]+$/, "");
  const m = symbolRe.exec(text) ?? predicateRe.exec(text);
  if (!m) return null;
  const rawSubject = m[1]!.trim();
  const rawPred = m[2]!.trim().toLowerCase();
  const rawObject = m[3]!.trim();
  const subjectTerms = keyTerms(rawSubject);
  const subject = subjectTerms.length ? subjectTerms.join(" ") : rawSubject.toLowerCase();
  const predicate = PREDICATE_NORMALIZE[rawPred] ?? rawPred;
  const objectTerms = termSet(rawObject);
  if (objectTerms.size === 0) return null;
  return { subject, predicate, object: rawObject, objectTerms };
}

/**
 * True when both statements make a claim about the same subject/predicate but
 * with (mostly) different objects: "DB is MySQL" vs "DB is PostgreSQL".
 */
export function statementsConflict(a: string, b: string): boolean {
  const sa = parseStatement(a);
  const sb = parseStatement(b);
  if (!sa || !sb) return false;
  if (sa.subject !== sb.subject || sa.predicate !== sb.predicate) return false;
  const overlap = jaccardSimilarity(sa.objectTerms, sb.objectTerms);
  return overlap < 0.2;
}

/** Negation pairs: "X uses Y" vs "X does not use Y". */
export function negationConflict(a: string, b: string): boolean {
  const neg = /\b(not|never|no longer|don't|doesn't|do not|does not|isn't|aren't)\b/i;
  const an = neg.test(a);
  const bn = neg.test(b);
  if (an === bn) return false;
  const strip = (s: string) => new Set(keyTerms(s.replace(neg, " ")));
  const sim = jaccardSimilarity(strip(a), strip(b));
  return sim >= 0.6;
}
