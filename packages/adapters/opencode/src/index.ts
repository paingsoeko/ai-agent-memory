import {
  buildBootstrapInstructions,
  defaultMcpCommand,
  formatContextDefault,
  type AgentAdapter,
  type BootstrapOptions,
  type ConfigSnippet,
  type McpConfigOptions,
} from "@local-ai-agent-memory/core";

/**
 * OpenCode integration: `opencode.json` MCP entry, AGENTS.md bootstrap text and
 * an example plugin that ingests the session when it goes idle.
 */
export const opencodeAdapter: AgentAdapter = {
  name: "opencode",
  displayName: "OpenCode",
  instructionsFile: "AGENTS.md",

  bootstrapInstructions(options: BootstrapOptions = {}) {
    return buildBootstrapInstructions("OpenCode", options);
  },

  mcpConfig(options: McpConfigOptions = {}): ConfigSnippet {
    const { command, args, env } = defaultMcpCommand(options);
    const snippet = {
      $schema: "https://opencode.ai/config.json",
      mcp: {
        "ai-memory": {
          type: "local",
          command: [command, ...args],
          enabled: true,
          ...(Object.keys(env).length ? { environment: env } : {}),
        },
      },
    };
    return {
      file: "opencode.json",
      snippet,
      text: JSON.stringify(snippet, null, 2),
      description:
        "Registers the ai-memory MCP server with OpenCode (project opencode.json or ~/.config/opencode/opencode.json).",
    };
  },

  hooks(options: McpConfigOptions = {}): ConfigSnippet[] {
    const project = options.project ? `, "--project", "${options.project}"` : "";
    const plugin = `// .opencode/plugin/ai-memory.ts — ingest the session into ai-memory when it goes idle
export const AiMemoryPlugin = async ({ client, $ }) => ({
  event: async ({ event }) => {
    if (event.type !== "session.idle") return;
    const sessionID = event.properties?.sessionID;
    if (!sessionID) return;
    const res = await client.session.messages({ path: { id: sessionID } });
    const messages = (res.data ?? []).map((m) => ({
      role: m.info.role,
      content: m.parts.filter((p) => p.type === "text").map((p) => p.text).join("\\n"),
    })).filter((m) => m.content);
    await $\`aam ingest --agent opencode --session \${sessionID} --json${project}\`.stdin(JSON.stringify(messages)).quiet().nothrow();
  },
});
`;
    return [
      {
        file: ".opencode/plugin/ai-memory.ts",
        snippet: null,
        text: plugin,
        description:
          "OpenCode plugin: on session.idle, pipe the session messages into `aam ingest`.",
      },
    ];
  },

  formatContext(results, options) {
    return formatContextDefault(results, options);
  },
};

export default opencodeAdapter;
