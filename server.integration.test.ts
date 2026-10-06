// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

// Exercise schema validation, JSON transport, real host KV limits and reloads.
describe("settings host integration", () => {
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
