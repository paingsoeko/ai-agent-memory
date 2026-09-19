import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, createMemory, expandHome, loadConfig } from "../src/index.js";

describe("config", () => {
  it("applies precedence defaults < user < project < env < overrides", () => {
    const home = mkdtempSync(join(tmpdir(), "aim-cfg-"));
    const cfgDir = join(home, "ai-memory");
    mkdirSync(cfgDir);
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        storage: { path: join(home, "user.db") },
        memory: { defaultScope: "user" },
        search: { candidateLimit: 10 },
      }),
    );
    const proj = mkdtempSync(join(tmpdir(), "aim-proj-"));
    mkdirSync(join(proj, ".git"));
    writeFileSync(
      join(proj, ".ai-memory.json"),
      JSON.stringify({ project: "my-app", memory: { defaultScope: "project" } }),
    );
    const sub = join(proj, "packages", "x");
    mkdirSync(sub, { recursive: true });

    const cfg = loadConfig({
      cwd: sub,
      env: { XDG_CONFIG_HOME: home, AI_MEMORY_EMBEDDINGS_PROVIDER: "hash" },
      overrides: { search: { rrfK: 10 } },
    });
    expect(cfg.storage.path).toBe(join(home, "user.db"));
    expect(cfg.memory.defaultScope).toBe("project");
    expect(cfg.project).toBe("my-app");
    expect(cfg.search.candidateLimit).toBe(10);
    expect(cfg.search.rrfK).toBe(10);
    expect(cfg.embeddings.provider).toBe("hash");
    expect(cfg.sources).toContain(join(proj, ".ai-memory.json"));
    expect(cfg.privacy.telemetry).toBe(false);
    expect(DEFAULT_CONFIG.embeddings.provider).toBe("none");
  });

  it("detects the project from the git root name when no config exists", () => {
    const proj = mkdtempSync(join(tmpdir(), "my-repo-"));
    mkdirSync(join(proj, ".git"));
    const cfg = loadConfig({
      cwd: proj,
      env: { XDG_CONFIG_HOME: join(proj, "nocfg"), AI_MEMORY_DB_PATH: join(proj, "db.sqlite") },
    });
    expect(cfg.project).toBe(basename(proj));
    expect(cfg.storage.path).toBe(join(proj, "db.sqlite"));
    const off = loadConfig({
      cwd: proj,
      env: { XDG_CONFIG_HOME: join(proj, "nocfg") },
      overrides: { memory: { autoDetectProject: false } },
    });
    expect(off.project).toBeUndefined();
  });

  it("expands ~ and rejects invalid config", () => {
    expect(expandHome("~/x", "/home/u")).toBe("/home/u/x");
    expect(() =>
      loadConfig({ skipFiles: true, overrides: { memory: { defaultScope: "nope" as "user" } } }),
    ).toThrow(/defaultScope/);
    const dir = mkdtempSync(join(tmpdir(), "aim-bad-"));
    writeFileSync(join(dir, "config.json"), "{ not json");
    expect(() => loadConfig({ configPath: join(dir, "config.json"), cwd: dir, env: {} })).toThrow(
      /Could not read config/,
    );
  });

  it("refuses network embedding providers unless explicitly allowed", async () => {
    const provider = {
      name: "net",
      model: "net",
      requiresNetwork: true,
      embed: async () => [1],
      embedBatch: async () => [[1]],
    };
    await expect(
      createMemory({ path: ":memory:", skipConfigFiles: true, embeddings: provider }),
    ).rejects.toThrow(/allowNetworkEmbeddings/);
    const m = await createMemory({
      path: ":memory:",
      skipConfigFiles: true,
      embeddings: provider,
      privacy: { allowNetworkEmbeddings: true },
    });
    expect(m.privacy().network).toBe("embeddings-only");
    await m.close();
  });

  it("reports privacy posture", async () => {
    const m = await createMemory({ path: ":memory:", skipConfigFiles: true });
    expect(m.privacy()).toMatchObject({
      storage: "local",
      telemetry: "disabled",
      embeddings: "none",
      network: "disabled",
    });
    await m.close();
  });
});
