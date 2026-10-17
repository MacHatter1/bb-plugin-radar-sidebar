import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { RadarContributionsClient, CONTRIBUTION_REFRESH_MS, CONTRIBUTION_TIMEOUT_MS } from "./contributions";
import { EXPERIMENTAL_RADAR_METHODS as METHODS, RADAR_BATCH_SIZE, type RadarResponse } from "../packages/contributions/src/index";

const clients: RadarContributionsClient[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.dispose(); vi.useRealTimers(); });
const published = (pluginId: string, displayName = pluginId) => ({ pluginId, displayName, method: METHODS.contributions });
function response(ids: readonly string[], label = "Team") : RadarResponse {
  return { version: 1, threads: ids.map((threadId) => ({ threadId,
    badges: [{ id: "team", label, icon: "Users", tone: "info" }],
    actions: [{ kind: "rpc", id: "refresh", label: "Refresh team" }],
  })) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup(options: {
  discover?: () => Promise<unknown[]>;
  call?: (args: { pluginId: string; method: string; input: { threadIds?: string[]; threadId?: string; actionId?: string }; signal: AbortSignal }) => Promise<unknown>;
  ids?: string[];
  disabled?: Record<string, boolean>;
} = {}) {
  const discover = vi.fn(options.discover ?? (async () => [published("teams", "Teams")]));
  const call = vi.fn(options.call ?? (async ({ method, input }) => method === METHODS.action ? { message: "Refreshed" } : response(input.threadIds!)));
  const sdk = { plugins: { experimental_discoverRpc: discover, callRpc: call } } as unknown as Pick<PluginBrowserBbSdk, "plugins">;
  const client = new RadarContributionsClient(sdk);
  clients.push(client);
  client.setInput(options.ids ?? ["t1"], options.disabled ?? {});
  client.start();
  return { client, discover, call };
}

describe("Radar contribution client", () => {
  it("discovers the versioned seam and namespaces each contribution with its real owner", async () => {
    const { client, discover, call } = setup();
    await client.refresh();
    expect(discover).toHaveBeenCalledWith({ method: METHODS.contributions });
    expect(call).toHaveBeenCalledOnce();
    expect(call.mock.calls[0]![0]).toMatchObject({ pluginId: "teams", method: METHODS.contributions, input: { threadIds: ["t1"] } });
    expect(client.getSnapshot().rows.get("t1")?.badges[0]).toMatchObject({ key: "teams/team", pluginName: "Teams" });
  });

  it("batches a large list and bounds simultaneous calls", async () => {
    let active = 0;
    let maximum = 0;
    const ids = Array.from({ length: RADAR_BATCH_SIZE * 5 + 1 }, (_, i) => `t${i}`);
    const { client, call } = setup({ ids, call: async ({ input }) => {
      maximum = Math.max(maximum, ++active);
      await Promise.resolve();
      active--;
      return response(input.threadIds!);
    } });
    await client.refresh();
    expect(call).toHaveBeenCalledTimes(6);
    expect(maximum).toBeLessThanOrEqual(4);
    expect(client.getSnapshot().rows.size).toBe(ids.length);
    expect(call.mock.calls.every(([args]) => args.input.threadIds!.length <= RADAR_BATCH_SIZE)).toBe(true);
  });

  it("deduplicates in-flight refreshes and preserves unchanged row identities", async () => {
    const { client, call } = setup();
    const first = client.refresh();
    expect(client.refresh()).toBe(first);
    await first;
    const snapshot = client.getSnapshot();
    const listener = vi.fn();
    const unsubscribe = client.subscribe(listener);
    await client.refresh();
    expect(client.getSnapshot()).toBe(snapshot);
    expect(listener).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("sorts by order, plugin id and contribution id independently of discovery or completion order", async () => {
    const { client } = setup({ discover: async () => [published("zeta"), published("alpha")],
      call: async ({ pluginId, input }) => {
        const result = response(input.threadIds!);
        result.threads[0]!.badges = [{ id: "z", label: "Z" }, { id: "a", label: "A" }, { id: "urgent", label: "Urgent", order: -1 }];
        if (pluginId === "alpha") await Promise.resolve();
        return result;
      } });
    await client.refresh();
    expect(client.getSnapshot().rows.get("t1")!.badges.map((badge) => badge.key)).toEqual([
      "alpha/urgent", "zeta/urgent", "alpha/a", "alpha/z", "zeta/a", "zeta/z",
    ]);
  });

  it("isolates malformed, unsupported-version, unrequested and duplicate responses", async () => {
    const malformed = [
      { version: 2, threads: [] },
      { version: 1, threads: [{ threadId: "t1", badges: [{ id: "x", label: "X", component: "unsafe" }], actions: [] }] },
      response(["not-requested"]),
      response(["t1", "t1"]),
    ];
    for (const bad of malformed) {
      const { client } = setup({ discover: async () => [published("good"), published("bad")],
        call: async ({ pluginId, input }) => pluginId === "bad" ? bad : response(input.threadIds!) });
      await client.refresh();
      expect(client.getSnapshot().rows.get("t1")!.badges.map((badge) => badge.pluginId)).toEqual(["good"]);
      expect(client.getSnapshot().contributors.find((provider) => provider.pluginId === "bad")?.error).toBeTruthy();
    }
  });

  it("debounces repeated scope changes without delaying removal of old rows", async () => {
    vi.useFakeTimers();
    const { client, call } = setup();
    await client.refresh();
    client.setInput(["t2"], {});
    client.setInput(["t3"], {});
    expect(client.getSnapshot().rows.has("t1")).toBe(false);
    expect(call).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(151);
    expect(call).toHaveBeenCalledTimes(2);
    expect([...client.getSnapshot().rows.keys()]).toEqual(["t3"]);
  });

  it("times out a transport that ignores cancellation without suppressing a healthy contributor", async () => {
    vi.useFakeTimers();
    const { client } = setup({ discover: async () => [published("slow"), published("good")],
      call: async ({ pluginId, input }) => pluginId === "slow" ? new Promise(() => {}) : response(input.threadIds!) });
    const refreshed = client.refresh();
    await vi.advanceTimersByTimeAsync(CONTRIBUTION_TIMEOUT_MS + 1);
    await refreshed;
    expect(client.getSnapshot().rows.get("t1")!.badges.map((badge) => badge.pluginId)).toEqual(["good"]);
    expect(client.getSnapshot().contributors.find((provider) => provider.pluginId === "slow")?.error).toContain("in time");
  });

  it("removes disabled contributions immediately and ignores late replies", async () => {
    const late = deferred<unknown>();
    let slow = false;
    const { client, call } = setup({ call: async ({ input }) => slow ? late.promise : response(input.threadIds!) });
    await client.refresh();
    slow = true;
    const stale = client.refresh();
    await Promise.resolve();
    client.setInput(["t1"], { teams: true });
    expect(client.getSnapshot().rows.get("t1")?.badges).toEqual([]);
    await client.refresh();
    late.resolve(response(["t1"], "Stale"));
    await stale;
    expect(client.getSnapshot().rows.size).toBe(0);
    expect(client.getSnapshot().contributors[0]?.enabled).toBe(false);
    const count = call.mock.calls.length;
    await client.refresh();
    expect(call).toHaveBeenCalledTimes(count);
  });

  it("reconciles removals and reloads on the polling interval", async () => {
    vi.useFakeTimers();
    let installed = true;
    const { client, call } = setup({ discover: async () => installed ? [published("teams")] : [] });
    await client.refresh();
    installed = false;
    await vi.advanceTimersByTimeAsync(CONTRIBUTION_REFRESH_MS);
    expect(client.getSnapshot().rows.size).toBe(0);
    expect(client.getSnapshot().contributors).toEqual([]);
    installed = true;
    await vi.advanceTimersByTimeAsync(CONTRIBUTION_REFRESH_MS);
    expect(client.getSnapshot().rows.has("t1")).toBe(true);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("cancels old-scope work and only reads the currently visible threads", async () => {
    const late = deferred<unknown>();
    const { client } = setup({ call: async ({ input }) => input.threadIds![0] === "t1" ? late.promise : response(input.threadIds!) });
    const stale = client.refresh();
    await Promise.resolve();
    client.setInput(["t2"], {});
    await client.refresh();
    late.resolve(response(["t1"]));
    await stale;
    expect([...client.getSnapshot().rows.keys()]).toEqual(["t2"]);
  });

  it("clears cached data on discovery failure and safely handles older BB", async () => {
    let supported = true;
    const { client } = setup({ discover: async () => { if (!supported) throw new Error("unsupported"); return [published("teams")]; } });
    await client.refresh();
    supported = false;
    await client.refresh();
    expect(client.getSnapshot().status).toBe("unavailable");
    expect(client.getSnapshot().rows.size).toBe(0);
  });

  it("disposes timers and ignores responses after unmount, and can restart under Strict Mode", async () => {
    vi.useFakeTimers();
    const late = deferred<unknown[]>();
    const { client, discover } = setup({ discover: () => late.promise });
    const pending = client.refresh();
    await Promise.resolve();
    client.dispose();
    late.resolve([published("teams")]);
    await pending;
    await vi.advanceTimersByTimeAsync(CONTRIBUTION_REFRESH_MS * 2);
    expect(discover).toHaveBeenCalledOnce();
    expect(client.getSnapshot().rows.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    client.start();
    await client.refresh();
    expect(client.getSnapshot().rows.has("t1")).toBe(true);
  });

  it("limits contributors and only accepts links into their own BB panels", async () => {
    const { client } = setup({ discover: async () => Array.from({ length: 40 }, (_, i) => published(`p-${i}`)),
      call: async ({ pluginId, input }) => {
        const result = response(input.threadIds!);
        result.threads[0]!.actions = [
          { kind: "link", id: "own", label: "Own", href: `/plugins/${pluginId}/board` },
          { kind: "link", id: "other", label: "Other", href: "/plugins/another/board" },
          { kind: "link", id: "external", label: "External", href: "https://example.com" },
        ];
        return result;
      } });
    await client.refresh();
    expect(client.getSnapshot().contributors).toHaveLength(32);
    expect(client.getSnapshot().rows.get("t1")!.actions.every((action) => action.id !== "other")).toBe(true);
  });

  it("invokes only registered actions, deduplicates double activation and refreshes afterwards", async () => {
    const run = deferred<unknown>();
    const { client, call } = setup({ call: async ({ method, input }) => method === METHODS.action ? run.promise : response(input.threadIds!) });
    await client.refresh();
    await expect(client.execute("t1", "unknown/action")).rejects.toThrow("no longer available");
    const first = client.execute("t1", "teams/refresh");
    expect(client.execute("t1", "teams/refresh")).toBe(first);
    await Promise.resolve();
    expect(call.mock.calls.filter(([args]) => args.method === METHODS.action)).toHaveLength(1);
    expect(call.mock.calls.at(-1)![0]).toMatchObject({ pluginId: "teams", input: { threadId: "t1", actionId: "refresh" } });
    run.resolve({ message: "Refreshed" });
    expect(await first).toEqual({ message: "Refreshed" });
    await client.refresh();
    client.setInput(["t1"], { teams: true });
    await expect(client.execute("t1", "teams/refresh")).rejects.toThrow("no longer available");
  });

  it("does not retry timed-out mutating actions", async () => {
    vi.useFakeTimers();
    const { client, call } = setup({ call: async ({ method, input }) => method === METHODS.action ? new Promise(() => {}) : response(input.threadIds!) });
    await client.refresh();
    const result = client.execute("t1", "teams/refresh");
    const rejection = expect(result).rejects.toThrow("in time");
    await vi.advanceTimersByTimeAsync(10_001);
    await rejection;
    expect(call.mock.calls.filter(([args]) => args.method === METHODS.action)).toHaveLength(1);
  });
});
