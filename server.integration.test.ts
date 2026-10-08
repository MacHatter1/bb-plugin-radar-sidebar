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
      await host.bb.storage.kv.set("settings", { motion: false, railLiveStatus: { "existing/nav": "badge" } });
      await plugin(host.bb);
      const rpc = host.harness.behavior;
      await Promise.all([
        rpc.callRpc("setRailLiveStatus", { itemId: "alpha/a", mode: "badge" }),
        rpc.callRpc("setRailLiveStatus", { itemId: "beta/b", mode: "icon" }),
        rpc.callRpc("setSetting", { key: "railNav", value: true }),
      ]);
      const expected = {
        motion: false, railNav: true,
        railLiveStatus: { "existing/nav": "badge", "alpha/a": "badge", "beta/b": "icon" }, revision: 3,
      };
      expect(await rpc.callRpc("getSettings")).toEqual(expected);
      host = await host.harness.lifecycle.reload(plugin);
      expect(await host.harness.behavior.callRpc("getSettings")).toEqual(expected);
      expect(await host.harness.behavior.callRpc("setRailLiveStatus", { itemId: "alpha/a", mode: "off" }))
        .toEqual({ ...expected, railLiveStatus: { ...expected.railLiveStatus, "alpha/a": "off" }, revision: 4 });
    } finally {
      await host.harness.lifecycle.dispose();
    }
  });

  it("rejects invalid item edits at the RPC boundary without changing stored choices", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar" });
    try {
      await plugin(bb);
      await expect(harness.behavior.callRpc("setRailLiveStatus", { itemId: "__proto__", mode: "icon" }))
        .rejects.toThrow("rpc input validation failed");
      await expect(harness.behavior.callRpc("setSetting", { key: "revision", value: 99 }))
        .rejects.toThrow("rpc input validation failed");
      expect(await harness.behavior.callRpc("getSettings")).toEqual({ revision: 0 });
      expect(harness.inspection.realtimeSignals).toEqual([]);
    } finally {
      await harness.lifecycle.dispose();
    }
  });

  it("keeps processing writes after the host rejects a change over its KV size limit", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar" });
    try {
      await plugin(bb);
      const tooLarge = Object.fromEntries(Array.from({ length: 2_000 }, (_, i) => [`nav/${i}/${"x".repeat(150)}`, "badge"]));
      const results = await Promise.allSettled([
        harness.behavior.callRpc("setSetting", { key: "railLiveStatus", value: tooLarge }),
        harness.behavior.callRpc("setSetting", { key: "railNav", value: true }),
      ]);
      expect(results.map(result => result.status)).toEqual(["rejected", "fulfilled"]);
      expect(await harness.behavior.callRpc("getSettings")).toEqual({ railNav: true, revision: 1 });
    } finally {
      await harness.lifecycle.dispose();
    }
  });
});
