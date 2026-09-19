import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMemory, type MemoryEngine } from "@ai-memory/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMcpServer } from "../src/index.js";

let engine: MemoryEngine;
let client: Client;

async function call<T = Record<string, unknown>>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ text: string; data: T; isError: boolean }> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    structuredContent?: T;
    isError?: boolean;
  };
  return {
    text: res.content[0]?.text ?? "",
    data: res.structuredContent as T,
    isError: Boolean(res.isError),
  };
}

beforeEach(async () => {
  engine = await createMemory({ path: ":memory:", skipConfigFiles: true, project: "my-app" });
  const server = createMcpServer(engine);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(ct);
});

afterEach(async () => {
  await client.close();
  await engine.close();
});

describe("@ai-memory/mcp", () => {
  it("lists all memory tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    for (const n of [
      "memory_search",
      "memory_recall",
      "memory_remember",
      "memory_update",
      "memory_forget",
      "memory_inspect",
      "memory_list",
      "memory_ingest",
      "memory_status",
    ]) {
      expect(names).toContain(n);
    }
    expect(tools.find((t) => t.name === "memory_remember")?.inputSchema).toHaveProperty(
      "properties.content",
    );
  });

  it("memory_remember + memory_search + memory_recall", async () => {
    const r = await call<{ action: string; memory: { id: string; projectId: string } }>(
      "memory_remember",
      { content: "Payroll generation uses Temporal workflows.", type: "architecture" },
    );
    expect(r.isError).toBe(false);
    expect(r.data.action).toBe("created");
    expect(r.data.memory.projectId).toBe("my-app");
    const s = await call<{ items: { content: string; score: number }[] }>("memory_search", {
      query: "Temporal trace propagation",
      project: "my-app",
    });
    expect(s.data.items[0]!.content).toContain("Temporal");
    expect(s.text).toContain("## Search results");
    const rc = await call<{ items: { id: string }[] }>("memory_recall", {
      query: "how does payroll generation work?",
    });
    expect(rc.data.items[0]!.id).toBe(r.data.memory.id);
    expect(rc.text).toContain("## Relevant memories");
    expect(rc.text).toContain("project:my-app");
    expect((await engine.get(r.data.memory.id)).accessCount).toBe(1);
  });

  it("memory_update, memory_inspect, memory_list, memory_forget", async () => {
    const r = await call<{ memory: { id: string } }>("memory_remember", {
      content: "Use PostgreSQL JSONB for policy metadata.",
      type: "architecture",
    });
    const id = r.data.memory.id;
    const u = await call<{ importance: number; tags: string[] }>("memory_update", {
      id: id.slice(0, 8),
      importance: 0.95,
      tags: ["db"],
    });
    expect(u.data.importance).toBe(0.95);
    const i = await call<{ memory: { id: string }; history: { action: string }[] }>(
      "memory_inspect",
      { id },
    );
    expect(i.data.memory.id).toBe(id);
    expect(i.data.history.map((h) => h.action)).toEqual(["created", "updated"]);
    const l = await call<{ items: { id: string }[] }>("memory_list", { type: "architecture" });
    expect(l.data.items.map((m) => m.id)).toEqual([id]);
    const f = await call<{ id: string; archived: boolean }>("memory_forget", { id });
    expect(f.data.archived).toBe(false);
    const gone = await call("memory_inspect", { id });
    expect(gone.isError).toBe(true);
    expect(gone.text).toContain("NOT_FOUND");
  });

  it("memory_ingest extracts durable knowledge with provenance and memory_status reports", async () => {
    const r = await call<{ events: number; stored: { content: string; id: string }[] }>(
      "memory_ingest",
      {
        messages: [
          { role: "user", content: "We decided to use Temporal for payroll generation." },
          { role: "assistant", content: "Sounds good, let me start." },
        ],
        sessionId: "s1",
        agent: "codex",
      },
    );
    expect(r.data.events).toBe(2);
    expect(r.data.stored[0]!.content).toContain("Temporal");
    const insp = await call<{ sources: unknown[]; memory: { agent: string } }>("memory_inspect", {
      id: r.data.stored[0]!.id,
    });
    expect(insp.data.sources).toHaveLength(1);
    expect(insp.data.memory.agent).toBe("codex");
    const st = await call<{ memories: number; project: string; privacy: { telemetry: string } }>(
      "memory_status",
    );
    expect(st.data.memories).toBe(1);
    expect(st.data.project).toBe("my-app");
    expect(st.data.privacy.telemetry).toBe("disabled");
  });

  it("rejects invalid arguments and never leaks other projects", async () => {
    await call("memory_remember", { content: "Secret project fact.", project: "other" });
    const l = await call<{ items: unknown[] }>("memory_list", {});
    expect(l.data.items).toHaveLength(0);
    const bad = await client
      .callTool({ name: "memory_remember", arguments: { content: "" } })
      .catch((e: Error) => e);
    const badIsError = bad instanceof Error || (bad as { isError?: boolean }).isError === true;
    expect(badIsError).toBe(true);
  });
});
