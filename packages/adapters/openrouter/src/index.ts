import {
  buildBootstrapInstructions,
  formatContextDefault,
  type AgentAdapter,
  type BootstrapOptions,
  type ConfigSnippet,
  type IngestMessage,
  type McpConfigOptions,
  type MemoryEngine,
} from "@ai-memory/core";

/**
 * OpenRouter (and any OpenAI-compatible chat API) integration for custom
 * agents. There is no CLI agent to configure, so this adapter provides
 * helpers to (1) build a system prompt with recalled memories and (2) ingest
 * a finished conversation, plus the embeddings config for OpenRouter.
 */
export const openrouterAdapter: AgentAdapter = {
  name: "openrouter",
  displayName: "OpenRouter / custom agents",
  instructionsFile: "SYSTEM_PROMPT.md",

  bootstrapInstructions(options: BootstrapOptions = {}) {
    return buildBootstrapInstructions("your agent", { transport: "cli", ...options });
  },

  mcpConfig(options: McpConfigOptions = {}): ConfigSnippet {
    const snippet = {
      embeddings: { provider: "openrouter", model: "openai/text-embedding-3-small" },
      search: { keyword: true, semantic: true },
      privacy: { allowNetworkEmbeddings: true },
      ...(options.project ? { project: options.project } : {}),
    };
    return {
      file: "~/.config/ai-memory/config.json",
      snippet,
      text: JSON.stringify(snippet, null, 2),
      description:
        "Optional: use OpenRouter for embeddings (requires OPENROUTER_API_KEY and explicit network opt-in). Memory text is sent to OpenRouter for embedding only.",
    };
  },

  formatContext(results, options) {
    return formatContextDefault(results, options);
  },
};

export interface MemoryPromptOptions {
  /** What the agent is about to do; used as the recall query. */
  task: string;
  systemPrompt?: string;
  limit?: number;
  project?: string;
}

/** Build a system prompt that includes recalled memories for the task. */
export async function buildSystemPromptWithMemory(
  engine: MemoryEngine,
  options: MemoryPromptOptions,
): Promise<string> {
  const results = await engine.recall({
    query: options.task,
    limit: options.limit ?? 10,
    projectId: options.project,
    includeCore: true,
  });
  const base = options.systemPrompt ?? "You are a helpful coding agent.";
  return `${base}\n\n${openrouterAdapter.formatContext(results)}\n\n${openrouterAdapter.bootstrapInstructions({ project: options.project })}`;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | { type: string; text?: string }[];
}

/** Convert OpenAI-style chat messages to ingest messages and store them. */
export async function ingestConversation(
  engine: MemoryEngine,
  messages: ChatMessage[],
  options: { sessionId?: string; agent?: string; project?: string } = {},
) {
  const converted: IngestMessage[] = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role,
      content:
        typeof m.content === "string" ? m.content : m.content.map((c) => c.text ?? "").join("\n"),
    }))
    .filter((m) => m.content.trim());
  return engine.ingest({
    messages: converted,
    sessionId: options.sessionId,
    agent: options.agent ?? "openrouter",
    projectId: options.project,
  });
}

export default openrouterAdapter;
