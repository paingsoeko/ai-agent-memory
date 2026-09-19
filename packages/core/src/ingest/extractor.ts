import type { ExtractedCandidate, IngestMessage, MemoryExtractor, MemoryType } from "../types.js";
import { splitSentences } from "../util/text.js";
import { looksLikeSecret } from "./secrets.js";

interface Pattern {
  re: RegExp;
  type: MemoryType;
  confidence: number;
  importance: number;
  reason: string;
}

/** Explicit markers always win: "remember: ...", "decision: ...". */
const EXPLICIT: Pattern[] = [
  {
    re: /^(remember|memory|note to memory|memorize)\s*[:\-–]\s*/i,
    type: "fact",
    confidence: 0.95,
    importance: 0.8,
    reason: "explicit remember marker",
  },
  {
    re: /^(decision|decided|adr)\s*[:\-–]\s*/i,
    type: "decision",
    confidence: 0.95,
    importance: 0.85,
    reason: "explicit decision marker",
  },
  {
    re: /^(convention|rule)\s*[:\-–]\s*/i,
    type: "convention",
    confidence: 0.93,
    importance: 0.75,
    reason: "explicit convention marker",
  },
  {
    re: /^(constraint|requirement)\s*[:\-–]\s*/i,
    type: "constraint",
    confidence: 0.93,
    importance: 0.8,
    reason: "explicit constraint marker",
  },
  {
    re: /^(lesson|lesson learned|takeaway|gotcha|root cause)\s*[:\-–]\s*/i,
    type: "lesson",
    confidence: 0.92,
    importance: 0.75,
    reason: "explicit lesson marker",
  },
  {
    re: /^(preference|pref)\s*[:\-–]\s*/i,
    type: "preference",
    confidence: 0.93,
    importance: 0.7,
    reason: "explicit preference marker",
  },
  {
    re: /^(architecture|arch)\s*[:\-–]\s*/i,
    type: "architecture",
    confidence: 0.93,
    importance: 0.85,
    reason: "explicit architecture marker",
  },
];

const IMPLICIT: Pattern[] = [
  {
    re: /\b(we|i|the team|let's|let us)\s+(decided|agreed|chose|settled on|are going with|went with|will go with|standardi[sz]ed on)\b/i,
    type: "decision",
    confidence: 0.85,
    importance: 0.8,
    reason: "decision language",
  },
  {
    re: /\b(i|we)\s+(always|never|prefer|don't like|dislike|like to|want to|hate)\b/i,
    type: "preference",
    confidence: 0.8,
    importance: 0.65,
    reason: "preference language",
  },
  {
    re: /\b(always|never)\s+(use|run|write|put|commit|push|add|prefer|avoid)\b/i,
    type: "convention",
    confidence: 0.78,
    importance: 0.7,
    reason: "always/never rule",
  },
  {
    re: /\b(must|must not|should not|shouldn't|is required to|cannot|can't be)\b/i,
    type: "constraint",
    confidence: 0.72,
    importance: 0.7,
    reason: "constraint language",
  },
  {
    re: /\b(uses|is built with|is built on|runs on|is written in|is stored in|lives in|live in|is deployed (to|on)|is implemented (in|with)|is powered by|talks to)\b/i,
    type: "architecture",
    confidence: 0.75,
    importance: 0.75,
    reason: "architecture statement",
  },
  {
    re: /\b(convention|naming|by convention|the pattern is|we follow|style guide|formatted with|linted with)\b/i,
    type: "convention",
    confidence: 0.72,
    importance: 0.65,
    reason: "convention language",
  },
  {
    re: /\b(root cause|the fix was|fixed by|turned out|the bug was|caused by|was failing because)\b/i,
    type: "bug_fix",
    confidence: 0.75,
    importance: 0.7,
    reason: "bug fix language",
  },
  {
    re: /\b(lesson|learned that|gotcha|beware|keep in mind|important to note|note that)\b/i,
    type: "lesson",
    confidence: 0.7,
    importance: 0.65,
    reason: "lesson language",
  },
  {
    re: /\b(the (primary|main) (database|db|queue|cache|framework|language) is|is the (primary|main|default))\b/i,
    type: "architecture",
    confidence: 0.78,
    importance: 0.8,
    reason: "primary component statement",
  },
];

/** Sentences that are ephemeral chatter, not durable knowledge. */
const EPHEMERAL = [
  /^(ok|okay|sure|thanks|thank you|great|got it|yes|no|yep|nope|hmm|hi|hello|hey)\b/i,
  /^(let me|i'll|i will|i'm going to|i am going to|here('s| is)|now (i|let's)|first,? (i|let's)|next,? (i|let's))\b/i,
  /^(can you|could you|please|would you|what|why|how|where|when|who|is it|are there|do you|does)\b/i,
  /\?\s*$/,
  /\b(right now|at the moment|currently running|for now|this time|today|tonight|tomorrow)\b/i,
  /\b(running|executing|compiling|installing|checking|looking at|reading|opening)\b.*\b(now|\.\.\.)$/i,
  /^\s*[{[<]/,
  /\b(TODO|FIXME)\b/,
];

function scoreSentence(sentence: string, role: IngestMessage["role"]): Pattern | null {
  for (const p of EXPLICIT) if (p.re.test(sentence)) return p;
  for (const re of EPHEMERAL) if (re.test(sentence)) return null;
  let best: Pattern | null = null;
  for (const p of IMPLICIT) {
    if (p.re.test(sentence) && (!best || p.confidence > best.confidence)) best = p;
  }
  if (!best) return null;
  // Assistant statements are less authoritative than user statements.
  if (role === "assistant") best = { ...best, confidence: Math.max(0, best.confidence - 0.15) };
  if (role === "tool" || role === "system") return null;
  return best;
}

export interface HeuristicExtractorOptions {
  minLength: number;
  maxLength: number;
  maxPerMessage: number;
}

export const DEFAULT_EXTRACTOR_OPTIONS: HeuristicExtractorOptions = {
  minLength: 15,
  maxLength: 320,
  maxPerMessage: 5,
};

/**
 * Conservative, vendor-free extractor. It only keeps sentences that carry
 * explicit durable-knowledge markers or strong decision/preference/architecture
 * language, drops chatter, questions, code and anything that looks like a
 * secret. Agents with an LLM can supply a smarter extractor via `ingest({ extractor })`.
 */
export function createHeuristicExtractor(
  options: Partial<HeuristicExtractorOptions> = {},
): MemoryExtractor {
  const opts = { ...DEFAULT_EXTRACTOR_OPTIONS, ...options };
  return (messages) => {
    const out: ExtractedCandidate[] = [];
    messages.forEach((msg, messageIndex) => {
      if (msg.role === "tool" || msg.role === "system") return;
      if (
        msg.kind &&
        !["message", "note", "decision", "task_summary", "external"].includes(msg.kind)
      )
        return;
      let perMessage = 0;
      for (const raw of splitSentences(msg.content)) {
        if (perMessage >= opts.maxPerMessage) break;
        const sentence = raw.trim();
        if (sentence.length < opts.minLength || sentence.length > opts.maxLength) continue;
        if (looksLikeSecret(sentence)) continue;
        const p = scoreSentence(sentence, msg.role);
        if (!p) continue;
        let content = sentence.replace(p.re, (m) => (EXPLICIT.includes(p) ? "" : m)).trim();
        content = content.replace(/^[-–:\s]+/, "");
        if (content.length < opts.minLength) continue;
        content = content[0]!.toUpperCase() + content.slice(1);
        if (!/[.!]$/.test(content)) content += ".";
        out.push({
          content,
          type: p.type,
          confidence: p.confidence,
          importance: p.importance,
          messageIndex,
          reason: p.reason,
        });
        perMessage++;
      }
    });
    return out;
  };
}
