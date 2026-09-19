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
 * Claude Code integration: MCP server registration (.mcp.json or
 * `claude mcp add`), CLAUDE.md bootstrap text, and hooks that recall core
 * memories on SessionStart and ingest the transcript on Stop.
 */
export const claudeAdapter: AgentAdapter = {
  name: "claude",
  displayName: "Claude Code",
  instructionsFile: "CLAUDE.md",

  bootstrapInstructions(options: BootstrapOptions = {}) {
    return buildBootstrapInstructions("Claude Code", options);
  },

  mcpConfig(options: McpConfigOptions = {}): ConfigSnippet {
    const { command, args, env } = defaultMcpCommand(options);
    const snippet = {
      mcpServers: { "ai-memory": { command, args, ...(Object.keys(env).length ? { env } : {}) } },
    };
    const cli = `claude mcp add ai-memory${options.project ? ` -e AI_MEMORY_PROJECT=${options.project}` : ""} -- ${command} ${args.join(" ")}`;
    return {
      file: ".mcp.json",
      snippet,
      text: `${JSON.stringify(snippet, null, 2)}\n\n# or, from the terminal:\n${cli}`,
      description:
        "Registers the ai-memory MCP server with Claude Code (project-scoped .mcp.json, or user-scoped via the CLI).",
    };
  },

  hooks(options: McpConfigOptions = {}): ConfigSnippet[] {
    const project = options.project ? ` --project ${options.project}` : "";
    const sessionStart = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: `aam recall "project overview, conventions and recent decisions" --core --limit 12${project} 2>/dev/null || true`,
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: `aam ingest --from-hook --agent claude${project} --json >/dev/null 2>&1 || true`,
              },
            ],
          },
        ],
      },
    };
    return [
      {
        file: ".claude/settings.json",
        snippet: sessionStart,
        text: JSON.stringify(sessionStart, null, 2),
        description:
          "SessionStart prints relevant/core memories into the session context; Stop ingests the transcript (raw events + conservative extraction).",
      },
    ];
  },

  formatContext(results, options) {
    return formatContextDefault(results, options);
  },
};

export default claudeAdapter;
