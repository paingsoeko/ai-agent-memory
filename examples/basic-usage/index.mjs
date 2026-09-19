// Example project: a tiny "team knowledge" script using the programmatic API.
// Run with `pnpm --filter example-basic-usage start` after `pnpm build`.
import { createMemory } from "@ai-agent-memory/core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "ai-memory-example-"));
const memory = await createMemory({
  path: join(dir, "memory.db"),
  project: "my-app",
  skipConfigFiles: true,
});

// 1. Remember durable knowledge. Paraphrases merge, conflicts supersede.
for (const content of [
  "Payroll generation uses Temporal workflows.",
  "Payroll uses Temporal.",
  "Temporal is used for payroll generation.",
]) {
  const r = await memory.remember({
    content,
    type: "architecture",
    importance: 0.9,
    confidence: 0.9,
  });
  console.log(
    `${r.action.padEnd(9)} ${r.memory.id.slice(0, 8)}  level=${r.memory.level}  ${r.memory.content}`,
  );
}
const old = await memory.remember({ content: "Database = MySQL", type: "architecture" });
const fresh = await memory.remember({ content: "Database = PostgreSQL", type: "architecture" });
console.log(`\n${fresh.action}: "${fresh.memory.content}" supersedes "${old.memory.content}"`);

// 2. A user preference at user scope (visible in every project).
await memory.remember({
  content: "I prefer PostgreSQL JSONB for flexible metadata.",
  type: "preference",
  scope: "user",
});

// 3. Automatic ingestion of a conversation.
const ingest = await memory.ingest({
  agent: "example",
  messages: [
    {
      role: "user",
      content:
        "Can you check the tracing setup? We decided that all distributed tracing uses W3C traceparent.",
    },
    { role: "assistant", content: "Sure, let me look at it now." },
  ],
});
console.log(
  `\ningest: ${ingest.events.length} events, ${ingest.results.length} memories extracted`,
);

// 4. Recall for a task.
console.log("\nrecall('how does payroll generation work?'):");
for (const r of await memory.recall({ query: "how does payroll generation work?", limit: 5 })) {
  console.log(
    `  ${r.score.toFixed(3)}  [${r.memory.type}${r.memory.level === "core" ? " | core" : ""}]  ${r.memory.content}`,
  );
  console.log(`         ↳ ${r.explanation}`);
}

// 5. Provenance.
const insp = await memory.inspect(fresh.memory.id);
console.log(
  `\ninspect(${fresh.memory.id.slice(0, 8)}): supersedes="${insp.supersedes?.content}", history=${insp.history.map((h) => h.action).join(" → ")}`,
);

console.log("\nprivacy:", memory.privacy());
await memory.close();
