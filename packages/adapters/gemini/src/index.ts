import {
  buildBootstrapInstructions,
  defaultMcpCommand,
  formatContextDefault,
  type AgentAdapter,
  type BootstrapOptions,
  type ConfigSnippet,
  type McpConfigOptions,
} from "@ai-agent-memory/core";

/**
 * Gemini CLI integration: `~/.gemini/settings.json` (or project `.gemini/settings.json`)
 * MCP server entry and GEMINI.md bootstrap text.
 */
export const geminiAdapter: AgentAdapter = {
  name: "gemini",
  displayName: "Gemini CLI",
  instructionsFile: "GEMINI.md",

  bootstrapInstructions(options: BootstrapOptions = {}) {
    return buildBootstrapInstructions("Gemini CLI", options);
  },

  mcpConfig(options: McpConfigOptions = {}): ConfigSnippet {
    const { command, args, env } = defaultMcpCommand(options);
    const snippet = {
      mcpServers: {
        "ai-memory": {
          command,
          args,
          ...(Object.keys(env).length ? { env } : {}),
          timeout: 30000,
          trust: false,
        },
      },
    };
    return {
      file: ".gemini/settings.json",
      snippet,
      text: JSON.stringify(snippet, null, 2),
      description:
        "Registers the ai-memory MCP server with Gemini CLI (project-level .gemini/settings.json or ~/.gemini/settings.json).",
    };
  },

  hooks(options: McpConfigOptions = {}): ConfigSnippet[] {
    const project = options.project ? ` --project ${options.project}` : "";
    return [
      {
        file: ".gemini/commands/memory.toml",
        snippet: null,
        text: `description = "Recall relevant memories for the current task"\nprompt = "Run the shell command !{aam recall \\"{{args}}\\" --limit 10${project}} and use the output as context for the task: {{args}}"`,
        description: "A custom /memory <task> command that shells out to the CLI (no MCP needed).",
      },
    ];
  },

  formatContext(results, options) {
    return formatContextDefault(results, options);
  },
};

export default geminiAdapter;
