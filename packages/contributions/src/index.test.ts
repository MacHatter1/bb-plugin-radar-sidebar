// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  EXPERIMENTAL_RADAR_METHODS as METHODS,
  RADAR_BATCH_SIZE,
  experimental_registerRadarContributor,
  experimental_radarHrefSchema,
  experimental_radarRequestSchema,
  experimental_radarResponseSchema,
} from "./index";

describe("public Radar v1 contracts", () => {
  it("publishes discoverable methods and wire schemas through the real SDK harness", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "example" });
    try {
      experimental_registerRadarContributor(bb, {
        provide: ({ threadIds }) => ({ version: 1, threads: threadIds.map((threadId) => ({
          threadId, badges: [{ id: "team", label: "Team", tone: "info" }], actions: [],
        })) }),
        run: () => ({ message: "Updated" }),
      });
      expect(harness.inspection.registrations.experimental_publishedRpcMethods.map((method) => method.method)).toEqual([
        METHODS.contributions, METHODS.action,
      ]);
      const result = await harness.behavior.callRpc(METHODS.contributions, { threadIds: ["t1"] });
      expect(result).toEqual({ version: 1, threads: [{ threadId: "t1", badges: [{ id: "team", label: "Team", tone: "info" }], actions: [] }] });
      await expect(harness.behavior.callRpc(METHODS.action, { threadId: "t1", actionId: "refresh", unexpected: true })).rejects.toThrow("rpc input validation failed");
    } finally { await harness.lifecycle.dispose(); }
  });

  it("rejects invalid server responses before they cross the wire", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "example" });
    try {
      experimental_registerRadarContributor(bb, {
        provide: () => ({ version: 2, threads: [] } as never),
        run: () => ({ message: "x".repeat(241) }),
      });
      await expect(harness.behavior.callRpc(METHODS.contributions, { threadIds: ["t1"] })).rejects.toThrow("rpc output validation failed");
      await expect(harness.behavior.callRpc(METHODS.action, { threadId: "t1", actionId: "refresh" })).rejects.toThrow("rpc output validation failed");
    } finally { await harness.lifecycle.dispose(); }
  });

  it("bounds input batches and rejects duplicates, unknown fields and empty ids", () => {
    expect(experimental_radarRequestSchema.safeParse({ threadIds: Array.from({ length: RADAR_BATCH_SIZE + 1 }, (_, i) => `t${i}`) }).success).toBe(false);
    expect(experimental_radarRequestSchema.safeParse({ threadIds: ["t1", "t1"] }).success).toBe(false);
    expect(experimental_radarRequestSchema.safeParse({ threadIds: [""] }).success).toBe(false);
    expect(experimental_radarRequestSchema.safeParse({ threadIds: [], hidden: true }).success).toBe(false);
  });

  it("rejects duplicate contribution ids and excessive badges", () => {
    const thread = { threadId: "t1", badges: [{ id: "x", label: "X" }, { id: "x", label: "X" }], actions: [] };
    expect(experimental_radarResponseSchema.safeParse({ version: 1, threads: [thread] }).success).toBe(false);
    thread.badges = Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, label: "X" }));
    expect(experimental_radarResponseSchema.safeParse({ version: 1, threads: [thread] }).success).toBe(false);
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "//example.com", "/settings", "/plugins/example/board\\evil", "https://example.com\n", "/plugins/example/board/../../another/board", "/plugins/example/board/%2e%2e/%2e%2e/another/board"])("rejects unsafe or unsupported link %s", (href) => {
    expect(experimental_radarHrefSchema.safeParse(href).success).toBe(false);
  });

  it.each(["https://example.com/a", "http://localhost:3000", "/plugins/example/board", "/plugins/example/board/task-1?view=x"])("accepts supported link %s", (href) => {
    expect(experimental_radarHrefSchema.safeParse(href).success).toBe(true);
  });
});
