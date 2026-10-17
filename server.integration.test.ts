// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

// Exercise schema validation, JSON transport, real host KV limits and reloads.
describe("settings host integration", () => {
  it("serializes layout intents with pin saves and retains collections through reload", async () => {
    let host = createFakePluginHost({ pluginId: "radar-sidebar" });
    try {
      await host.bb.storage.kv.set("settings", { motion: false, pinnedProjects: { a: true, b: true } });
      await plugin(host.bb);
      const rpc = host.harness.behavior;
      await Promise.all([
        rpc.callRpc("changeProjectOrganisation", { kind: "create-collection", collectionId: "work", name: "Work", projectId: "a" }),
        rpc.callRpc("changeProjectOrganisation", { kind: "create-collection", collectionId: "personal", name: "Personal", projectId: "b" }),
        rpc.callRpc("setProjectPinned", { projectId: "c", pinned: true }),
      ]);
      await Promise.all([
        rpc.callRpc("changeProjectOrganisation", { kind: "move-pin", projectId: "c", beforeProjectId: "a" }),
        rpc.callRpc("changeProjectOrganisation", { kind: "collapse-collection", collectionId: "work", collapsed: true }),
        rpc.callRpc("changeProjectOrganisation", { kind: "rename-collection", collectionId: "personal", name: "Side projects" }),
      ]);
      const expected = { motion: false, pinnedProjects: { a: true, b: true, c: true }, revision: 6,
        projectOrganisation: { pinOrder: ["c", "a", "b"], collections: { work: { name: "Work", collapsed: true }, personal: { name: "Side projects", collapsed: false } }, projectCollections: { a: "work", b: "personal" } } };
      expect(await rpc.callRpc("getSettings")).toEqual(expected);
      host = await host.harness.lifecycle.reload(plugin);
      expect(await host.harness.behavior.callRpc("getSettings")).toEqual(expected);
      await expect(host.harness.behavior.callRpc("changeProjectOrganisation", { kind: "assign-collection", projectId: "a", collectionId: "missing" })).rejects.toThrow("no longer exists");
      await expect(host.harness.behavior.callRpc("changeProjectOrganisation", { kind: "rename-collection", collectionId: "work", name: "" })).rejects.toThrow("rpc input validation failed");
      expect(await host.harness.behavior.callRpc("getSettings")).toEqual(expected);
      const removed = await host.harness.behavior.callRpc("changeProjectOrganisation", { kind: "delete-collection", collectionId: "work" });
      expect(removed).toEqual({ ...expected, revision: 7, projectOrganisation: { ...expected.projectOrganisation, collections: { personal: expected.projectOrganisation.collections.personal }, projectCollections: { b: "personal" } } });
    } finally { await host.harness.lifecycle.dispose(); }
  });
  it("keeps concurrent project pins through reload and unpins only the chosen project", async () => {
    let host = createFakePluginHost({ pluginId: "radar-sidebar" });
    try {
      await host.bb.storage.kv.set("settings", { motion: false });
      await plugin(host.bb);
      await Promise.all([
        host.harness.behavior.callRpc("setProjectPinned", { projectId: "proj_a", pinned: true }),
        host.harness.behavior.callRpc("setProjectPinned", { projectId: "proj_b", pinned: true }),
      ]);
      const expected = { motion: false, pinnedProjects: { proj_a: true, proj_b: true }, projectOrganisation: { pinOrder: ["proj_a", "proj_b"], collections: {}, projectCollections: {} }, revision: 2 };
      expect(await host.harness.behavior.callRpc("getSettings")).toEqual(expected);
      host = await host.harness.lifecycle.reload(plugin);
      expect(await host.harness.behavior.callRpc("getSettings")).toEqual(expected);
      expect(await host.harness.behavior.callRpc("setProjectPinned", { projectId: "proj_a", pinned: false }))
        .toEqual({ ...expected, pinnedProjects: { proj_b: true }, projectOrganisation: { ...expected.projectOrganisation, pinOrder: ["proj_b"] }, revision: 3 });
      await expect(host.harness.behavior.callRpc("setProjectPinned", { projectId: "__proto__", pinned: true })).rejects.toThrow("rpc input validation failed");
      expect(await host.harness.behavior.callRpc("getSettings")).toEqual({ ...expected, pinnedProjects: { proj_b: true }, projectOrganisation: { ...expected.projectOrganisation, pinOrder: ["proj_b"] }, revision: 3 });
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("rejects excess pins without losing saved pins and still allows unpinning", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar" });
    try {
      const pinnedProjects = Object.fromEntries(Array.from({ length: 512 }, (_, i) => [`proj_${i}`, true]));
      await bb.storage.kv.set("settings", { pinnedProjects });
      await plugin(bb);
      await expect(harness.behavior.callRpc("setProjectPinned", { projectId: "extra", pinned: true })).rejects.toThrow("Too many pinned projects.");
      expect(await harness.behavior.callRpc("getSettings")).toEqual({ pinnedProjects, revision: 0 });
      const result = await harness.behavior.callRpc("setProjectPinned", { projectId: "proj_0", pinned: false }) as { pinnedProjects: Record<string, boolean>; revision: number };
      expect(Object.keys(result.pinnedProjects)).toHaveLength(511);
      expect(result.pinnedProjects.proj_0).toBeUndefined();
      expect(result.revision).toBe(1);
    } finally { await harness.lifecycle.dispose(); }
  });

  it("preserves legacy preferences, concurrent item edits and revisions through a reload", async () => {
    let host = createFakePluginHost({ pluginId: "radar-sidebar" });
    try {
      await host.bb.storage.kv.set("settings", { motion: false, pinnedProjects: { existing: true } });
      await plugin(host.bb);
      const rpc = host.harness.behavior;
      await Promise.all([
        rpc.callRpc("setProjectPinned", { projectId: "alpha", pinned: true }),
        rpc.callRpc("setProjectPinned", { projectId: "beta", pinned: true }),
        rpc.callRpc("setSetting", { key: "twoLineTitles", value: true }),
      ]);
      const expected = await rpc.callRpc("getSettings") as Record<string, unknown>;
      expect(expected).toMatchObject({
        motion: false, twoLineTitles: true,
        pinnedProjects: { existing: true, alpha: true, beta: true }, revision: 3,
      });
      host = await host.harness.lifecycle.reload(plugin);
      expect(await host.harness.behavior.callRpc("getSettings")).toEqual(expected);
      expect(await host.harness.behavior.callRpc("setProjectPinned", { projectId: "alpha", pinned: false }))
        .toMatchObject({ pinnedProjects: { existing: true, beta: true }, revision: 4 });
    } finally {
      await host.harness.lifecycle.dispose();
    }
  });

  it("rejects invalid item edits at the RPC boundary without changing stored choices", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar" });
    try {
      await plugin(bb);
      await expect(harness.behavior.callRpc("setProjectPinned", { projectId: "__proto__", pinned: true }))
        .rejects.toThrow("rpc input validation failed");
      await expect(harness.behavior.callRpc("setSetting", { key: "revision", value: 99 }))
        .rejects.toThrow("rpc input validation failed");
      expect(await harness.behavior.callRpc("getSettings")).toEqual({ revision: 0 });
      expect(harness.inspection.realtimeSignals).toEqual([]);
    } finally {
      await harness.lifecycle.dispose();
    }
  });

  it("keeps concurrent contributor toggles, rejects invalid identities and preserves them through reload", async () => {
    let host = createFakePluginHost({ pluginId: "radar-sidebar" });
    try {
      await plugin(host.bb);
      await Promise.all([
        host.harness.behavior.callRpc("setContributorEnabled", { pluginId: "teams", enabled: false }),
        host.harness.behavior.callRpc("setContributorEnabled", { pluginId: "sibyl", enabled: false }),
      ]);
      const expected = { revision: 2, disabledContributors: { teams: true, sibyl: true } };
      expect(await host.harness.behavior.callRpc("getSettings")).toEqual(expected);
      host = await host.harness.lifecycle.reload(plugin);
      expect(await host.harness.behavior.callRpc("getSettings")).toEqual(expected);
      await expect(host.harness.behavior.callRpc("setContributorEnabled", { pluginId: "__proto__", enabled: false })).rejects.toThrow("rpc input validation failed");
      await expect(host.harness.behavior.callRpc("setContributorEnabled", { pluginId: "teams", enabled: "false" })).rejects.toThrow("rpc input validation failed");
      expect(await host.harness.behavior.callRpc("setContributorEnabled", { pluginId: "teams", enabled: true })).toEqual({ revision: 3, disabledContributors: { sibyl: true } });
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("rejects excess contributor choices without dropping saved opt-outs and can still re-enable an owner", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar" });
    try {
      const disabledContributors = Object.fromEntries(Array.from({ length: 128 }, (_, i) => [`p-${i}`, true]));
      await bb.storage.kv.set("settings", { disabledContributors });
      await plugin(bb);
      await expect(harness.behavior.callRpc("setContributorEnabled", { pluginId: "extra", enabled: false })).rejects.toThrow("Too many saved contributor choices.");
      expect(await harness.behavior.callRpc("getSettings")).toEqual({ revision: 0, disabledContributors });
      const result = await harness.behavior.callRpc("setContributorEnabled", { pluginId: "p-0", enabled: true }) as { disabledContributors: Record<string, boolean>; revision: number };
      expect(result.revision).toBe(1);
      expect(Object.keys(result.disabledContributors)).toHaveLength(127);
      expect(result.disabledContributors["p-0"]).toBeUndefined();
    } finally { await harness.lifecycle.dispose(); }
  });

  it("keeps processing writes after the host rejects a change over its KV size limit", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar" });
    try {
      // Each value is valid on its own; together they pass the 256KB KV limit.
      const id = (prefix: string, i: number) => `${prefix}${i}`.padEnd(128, "x");
      const ids = Array.from({ length: 512 }, (_, i) => id("p", i));
      const pinnedProjects = Object.fromEntries(ids.map(project => [project, true]));
      const collections = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [id("c", i), { name: "n".repeat(64), collapsed: false }]));
      const tooLarge = {
        pinOrder: ids,
        collections,
        projectCollections: Object.fromEntries(ids.map((project, i) => [project, id("c", i % 64)])),
      };
      await bb.storage.kv.set("settings", { pinnedProjects });
      await plugin(bb);
      expect(JSON.stringify({ pinnedProjects, projectOrganisation: tooLarge }).length).toBeGreaterThan(256 * 1024);
      const results = await Promise.allSettled([
        harness.behavior.callRpc("setSetting", { key: "projectOrganisation", value: tooLarge }),
        harness.behavior.callRpc("setSetting", { key: "twoLineTitles", value: true }),
      ]);
      expect(results.map(result => result.status)).toEqual(["rejected", "fulfilled"]);
      expect(String((results[0] as PromiseRejectedResult).reason)).toMatch(/the limit is/);
      expect(await harness.behavior.callRpc("getSettings")).toEqual({ pinnedProjects, twoLineTitles: true, revision: 1 });
    } finally {
      await harness.lifecycle.dispose();
    }
  });
});
