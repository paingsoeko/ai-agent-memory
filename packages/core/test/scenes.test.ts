import { describe, expect, it } from "vitest";
import { mem } from "./helpers.js";

describe("scenes (L2)", () => {
  it("attaches explicit scenes and clusters related memories automatically", async () => {
    const m = await mem({ project: "p" });
    const a = await m.remember({
      content: "Laravel starts Temporal payroll workflows.",
      scene: "Payroll Architecture",
    });
    expect((await m.listScenes()).map((s) => s.name)).toEqual(["Payroll Architecture"]);
    await m.remember({ content: "Node.js workers execute Temporal payroll workflows." });
    await m.remember({ content: "Temporal payroll workflows retry failed activities." });
    const scenes = await m.listScenes();
    const payroll = scenes.find((s) => s.name === "Payroll Architecture")!;
    expect(payroll.memoryIds.length).toBeGreaterThanOrEqual(2);
    expect(payroll.summary).toContain("memories about Payroll Architecture");
    const insp = await m.inspect(a.memory.id);
    expect(insp.scenes[0]!.name).toBe("Payroll Architecture");
    expect(insp.related.length).toBeGreaterThan(0);
    await m.close();
  });

  it("creates a new scene from unclustered siblings", async () => {
    const m = await mem({ project: "p" });
    await m.remember({ content: "Authentication tokens are issued by the auth service." });
    await m.remember({ content: "Authentication tokens expire after one hour." });
    const r = await m.remember({
      content: "The auth service rotates authentication tokens daily.",
    });
    const scenes = await m.listScenes();
    expect(scenes.length).toBe(1);
    expect(scenes[0]!.memoryIds).toContain(r.memory.id);
    expect(scenes[0]!.name.toLowerCase()).toMatch(/authentication|token/);
    const updated = await m.updateScene(scenes[0]!.id, { summary: "Custom summary from an LLM." });
    expect(updated.summary).toBe("Custom summary from an LLM.");
    await m.consolidate();
    expect((await m.getScene(scenes[0]!.id)).summary).toBe("Custom summary from an LLM.");
    await m.close();
  });

  it("does not create scenes across projects", async () => {
    const m = await mem();
    await m.remember({
      content: "Authentication tokens are issued by the auth service.",
      projectId: "a",
    });
    await m.remember({ content: "Authentication tokens expire after one hour.", projectId: "a" });
    await m.remember({
      content: "Authentication tokens are validated by the gateway.",
      projectId: "b",
    });
    const a = await m.listScenes({ projectId: "a" });
    expect(a.every((s) => s.projectId === "a")).toBe(true);
    expect(await m.listScenes({ projectId: "b" })).toHaveLength(0);
    await m.close();
  });
});
