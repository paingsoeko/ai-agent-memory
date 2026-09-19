import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { MemoryError } from "./errors.js";
import type { MemoryScope } from "./types.js";

export interface RankingWeights {
  relevance: number;
  importance: number;
  confidence: number;
  recency: number;
  access: number;
  project: number;
  level: number;
}

export interface PromotionCriteria {
  /** Minimum evidence = (1 + merge count) + floor(accessCount / 3). */
  minEvidence: number;
  minImportance: number;
  minConfidence: number;
  /** Minimum age of the memory before promotion (ms). */
  minAgeMs: number;
  minAccessCount: number;
}

export interface AIMemoryConfig {
  storage: {
    type: "sqlite" | (string & {});
    path: string;
  };
  search: {
    keyword: boolean;
    semantic: boolean;
    candidateLimit: number;
    rrfK: number;
    weights: RankingWeights;
    /** Half-life in days for the recency signal. */
    recencyHalfLifeDays: number;
  };
  embeddings: {
    /** "none" | "hash" | "local" | "ollama" | "openai" | custom registered name */
    provider: string;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    dimensions?: number;
    batchSize: number;
    /** Embed new memories immediately (default true). */
    eager: boolean;
    options?: Record<string, unknown>;
  };
  memory: {
    defaultScope: MemoryScope;
    autoPromotion: boolean;
    autoScenes: boolean;
    autoDetectProject: boolean;
    dedup: {
      enabled: boolean;
      /** Lexical (Dice) similarity threshold for merging. */
      threshold: number;
      /** Cosine threshold when embeddings are available. */
      semanticThreshold: number;
    };
    conflicts: {
      policy: "supersede" | "flag" | "ignore";
    };
    promotion: PromotionCriteria;
    /** TTL for session-scoped (short-term) memories in ms. 0 = no expiry. */
    sessionTtlMs: number;
    ingest: {
      minConfidence: number;
      maxPerBatch: number;
    };
  };
  privacy: {
    telemetry: false;
    /** Allow embedding providers that send data over the network. */
    allowNetworkEmbeddings: boolean;
  };
  /** Active project name (from .ai-memory.json / env / options). */
  project?: string;
  /** Where config was loaded from (for diagnostics). */
  sources?: string[];
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K];
};

export const DEFAULT_CONFIG: AIMemoryConfig = {
  storage: { type: "sqlite", path: "~/.ai-memory/memory.db" },
  search: {
    keyword: true,
    semantic: false,
    candidateLimit: 50,
    rrfK: 60,
    weights: {
      relevance: 0.55,
      importance: 0.15,
      confidence: 0.08,
      recency: 0.08,
      access: 0.04,
      project: 0.07,
      level: 0.03,
    },
    recencyHalfLifeDays: 60,
  },
  embeddings: { provider: "none", batchSize: 32, eager: true },
  memory: {
    defaultScope: "project",
    autoPromotion: true,
    autoScenes: true,
    autoDetectProject: true,
    dedup: { enabled: true, threshold: 0.75, semanticThreshold: 0.92 },
    conflicts: { policy: "supersede" },
    promotion: {
      minEvidence: 3,
      minImportance: 0.6,
      minConfidence: 0.7,
      minAgeMs: 0,
      minAccessCount: 0,
    },
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
    ingest: { minConfidence: 0.6, maxPerBatch: 20 },
  },
  privacy: { telemetry: false, allowNetworkEmbeddings: false },
};

export function expandHome(p: string, home = homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return join(home, p.slice(2));
  return p;
}

export function userConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AI_MEMORY_CONFIG) return expandHome(env.AI_MEMORY_CONFIG);
  const base = env.XDG_CONFIG_HOME ? expandHome(env.XDG_CONFIG_HOME) : join(homedir(), ".config");
  return join(base, "ai-memory", "config.json");
}

export function defaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AI_MEMORY_DB_PATH) return expandHome(env.AI_MEMORY_DB_PATH);
  if (env.AI_MEMORY_HOME) return join(expandHome(env.AI_MEMORY_HOME), "memory.db");
  return join(homedir(), ".ai-memory", "memory.db");
}

/** Walk up from `cwd` to find a `.ai-memory.json` project config. */
export function findProjectConfig(cwd: string): string | null {
  let dir = resolve(cwd);
  for (;;) {
    const candidate = join(dir, ".ai-memory.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Walk up from `cwd` to find a git root; returns its basename as a project name. */
export function detectGitProject(cwd: string): string | null {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir.split(/[\\/]/).filter(Boolean).pop() ?? null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(base: T, ...overrides: (DeepPartial<T> | undefined)[]): T {
  const out: Record<string, unknown> = isPlainObject(base) ? { ...base } : {};
  for (const o of overrides) {
    if (!o) continue;
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined) continue;
      const cur = out[k];
      out[k] =
        isPlainObject(v) && isPlainObject(cur) ? deepMerge(cur, v as DeepPartial<typeof cur>) : v;
    }
  }
  return out as T;
}

function readJson(path: string): Record<string, unknown> {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) throw new Error("config root must be an object");
    return parsed;
  } catch (err) {
    throw new MemoryError(
      "CONFIG",
      `Could not read config file ${path}: ${(err as Error).message}`,
      "Fix the JSON syntax or delete the file to fall back to defaults.",
    );
  }
}

function envOverrides(env: NodeJS.ProcessEnv): DeepPartial<AIMemoryConfig> {
  const o: DeepPartial<AIMemoryConfig> = {};
  if (env.AI_MEMORY_DB_PATH || env.AI_MEMORY_HOME) o.storage = { path: defaultDbPath(env) };
  if (env.AI_MEMORY_PROJECT) o.project = env.AI_MEMORY_PROJECT;
  const emb: DeepPartial<AIMemoryConfig["embeddings"]> = {};
  if (env.AI_MEMORY_EMBEDDINGS_PROVIDER) emb.provider = env.AI_MEMORY_EMBEDDINGS_PROVIDER;
  if (env.AI_MEMORY_EMBEDDINGS_MODEL) emb.model = env.AI_MEMORY_EMBEDDINGS_MODEL;
  if (env.AI_MEMORY_EMBEDDINGS_BASE_URL) emb.baseUrl = env.AI_MEMORY_EMBEDDINGS_BASE_URL;
  if (env.AI_MEMORY_EMBEDDINGS_API_KEY) emb.apiKey = env.AI_MEMORY_EMBEDDINGS_API_KEY;
  if (Object.keys(emb).length) o.embeddings = emb;
  if (env.AI_MEMORY_SEMANTIC_SEARCH)
    o.search = {
      semantic: env.AI_MEMORY_SEMANTIC_SEARCH === "1" || env.AI_MEMORY_SEMANTIC_SEARCH === "true",
    };
  if (env.AI_MEMORY_ALLOW_NETWORK_EMBEDDINGS) {
    o.privacy = {
      allowNetworkEmbeddings: ["1", "true"].includes(env.AI_MEMORY_ALLOW_NETWORK_EMBEDDINGS),
    };
  }
  if (env.AI_MEMORY_DEFAULT_SCOPE)
    o.memory = { defaultScope: env.AI_MEMORY_DEFAULT_SCOPE as MemoryScope };
  return o;
}

export interface LoadConfigOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Explicit config file (overrides the user config path). */
  configPath?: string;
  /** Programmatic overrides (highest priority). */
  overrides?: DeepPartial<AIMemoryConfig>;
  /** Skip reading config files entirely (tests). */
  skipFiles?: boolean;
}

/**
 * Resolve the effective configuration.
 * Priority (low -> high): defaults < user config < project `.ai-memory.json` < env < overrides.
 */
export function loadConfig(options: LoadConfigOptions = {}): AIMemoryConfig {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const sources: string[] = ["defaults"];
  const layers: DeepPartial<AIMemoryConfig>[] = [];

  if (!options.skipFiles) {
    const userPath = options.configPath ? expandHome(options.configPath) : userConfigPath(env);
    if (existsSync(userPath)) {
      layers.push(readJson(userPath) as DeepPartial<AIMemoryConfig>);
      sources.push(userPath);
    }
    const projectPath = findProjectConfig(cwd);
    if (projectPath) {
      const pj = readJson(projectPath) as DeepPartial<AIMemoryConfig> & { project?: string };
      layers.push(pj);
      sources.push(projectPath);
      if (pj.storage?.path && !isAbsolute(expandHome(pj.storage.path))) {
        // Relative storage paths in project config resolve against the project root.
        pj.storage.path = resolve(dirname(projectPath), pj.storage.path);
      }
    }
  }
  layers.push(envOverrides(env));
  if (options.overrides) layers.push(options.overrides);

  const cfg = deepMerge(DEFAULT_CONFIG, ...layers);
  cfg.storage.path =
    cfg.storage.path === ":memory:" ? ":memory:" : resolve(expandHome(cfg.storage.path));
  cfg.privacy.telemetry = false;
  if (!cfg.project && cfg.memory.autoDetectProject && !options.skipFiles) {
    const detected = detectGitProject(cwd);
    if (detected) {
      cfg.project = detected;
      sources.push(`git:${detected}`);
    }
  }
  cfg.sources = sources;
  validateConfig(cfg);
  return cfg;
}

export function validateConfig(cfg: AIMemoryConfig): void {
  const scopes = ["global", "user", "project", "workspace", "session"];
  if (!scopes.includes(cfg.memory.defaultScope)) {
    throw new MemoryError(
      "CONFIG",
      `Invalid memory.defaultScope "${cfg.memory.defaultScope}"`,
      `Use one of: ${scopes.join(", ")}`,
    );
  }
  if (!["supersede", "flag", "ignore"].includes(cfg.memory.conflicts.policy)) {
    throw new MemoryError(
      "CONFIG",
      `Invalid memory.conflicts.policy "${cfg.memory.conflicts.policy}"`,
      "Use supersede, flag or ignore.",
    );
  }
  if (!cfg.storage.path) throw new MemoryError("CONFIG", "storage.path is required");
}
