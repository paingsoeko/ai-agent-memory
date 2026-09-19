import {
  buildBootstrapInstructions,
  defaultMcpCommand,
  formatContextDefault,
  type AgentAdapter,
  type BootstrapOptions,
  type ConfigSnippet,
  type McpConfigOptions,
} from "@local-ai-agent-memory/core";

function tomlString(s: string): string {
  return JSON.stringify(s);
}

/**
 * OpenAI Codex CLI integration: `~/.codex/config.toml` MCP server entry,
 * AGENTS.md bootstrap text, and the `notify` hook that ingests each completed turn.
 */
export const codexAdapter: AgentAdapter = {
  name: "codex",
  displayName: "OpenAI Codex CLI",
  instructionsFile: "AGENTS.md",

  bootstrapInstructions(options: BootstrapOptions = {}) {
    return buildBootstrapInstructions("Codex", options);
  },

  mcpConfig(options: McpConfigOptions = {}): ConfigSnippet {
    const { command, args, env } = defaultMcpCommand(options);
    const lines = [
      `[mcp_servers.ai-memory]`,
      `command = ${tomlString(command)}`,
      `args = [${args.map(tomlString).join(", ")}]`,
    ];
    if (Object.keys(env).length) {
      lines.push(
        ``,
        `[mcp_servers.ai-memory.env]`,
        ...Object.entries(env).map(([k, v]) => `${k} = ${tomlString(v)}`),
      );
    }
    const text = lines.join("\n");
    return {
      file: "~/.codex/config.toml",
      snippet: null,
      text,
      description:
        "Registers the ai-memory MCP server with Codex. Alternatively: `codex mcp add ai-memory -- npx -y @local-ai-agent-memory/mcp`.",
    };
  },

  hooks(options: McpConfigOptions = {}): ConfigSnippet[] {
    const args = ["aam", "ingest", "--from-hook", "--agent", "codex", "--json"];
    if (options.project) args.push("--project", options.project);
    return [
      {
        file: "~/.codex/config.toml",
        snippet: null,
        text: `notify = [${args.map(tomlString).join(", ")}]`,
        description:
          "Codex calls `notify` with a JSON payload after each turn; ai-memory ingests the turn's messages as raw events and extracts durable knowledge.",
      },
    ];
  },

  formatContext(results, options) {
    return formatContextDefault(results, options);
  },
};

export default codexAdapter;
