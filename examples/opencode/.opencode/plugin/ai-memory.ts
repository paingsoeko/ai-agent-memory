/* eslint-disable @typescript-eslint/no-explicit-any */
// OpenCode plugin: ingest the session into ai-memory whenever it goes idle.
// The plugin API is evolving; this targets the `event` hook and Bun's `$` helper.
export const AiMemoryPlugin = async ({ client, $ }: { client: any; $: any }) => ({
  event: async ({ event }: { event: { type: string; properties?: { sessionID?: string } } }) => {
    if (event.type !== "session.idle") return;
    const sessionID = event.properties?.sessionID;
    if (!sessionID) return;
    const res = await client.session.messages({ path: { id: sessionID } });
    const messages = (res.data ?? [])
      .map((m: any) => ({
        role: m.info.role,
        content: m.parts
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join("\n"),
      }))
      .filter((m: any) => m.content);
    await $`aam ingest --agent opencode --session ${sessionID} --json`
      .stdin(JSON.stringify(messages))
      .quiet()
      .nothrow();
  },
});
