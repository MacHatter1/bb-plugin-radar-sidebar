import { describe, expect, it, vi } from "vitest";
import plugin from "./server";

type Handlers = {
  getSettings: () => Promise<unknown>;
  setSetting: (input: { key: string; value: unknown }) => Promise<unknown>;
  setRailLiveStatus: (input: { itemId: string; mode: "off" | "badge" | "icon" }) => Promise<unknown>;
};

async function load(initial?: unknown) {
  const store = new Map<string, unknown>(initial === undefined ? [] : [["settings", initial]]);
  const publish = vi.fn();
  let handlers!: Handlers;
  const bb = {
    log: { info: vi.fn() },
    onDispose: vi.fn(),
    storage: { kv: {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: unknown) => { await Promise.resolve(); store.set(key, value); },
    } },
    realtime: { publish },
    rpc: { register: (_contract: unknown, registered: Handlers) => { handlers = registered; } },
  };
  await plugin(bb as never);
  return { handlers, store, publish };
}

describe("settings server", () => {
  it("defines no BB settings, so BB draws no list of its own", async () => {
    const bb = { log: { info: vi.fn() }, onDispose: vi.fn(), rpc: { register: vi.fn() }, settings: { define: vi.fn() } };
    await plugin(bb as never);
    expect(bb.settings.define).not.toHaveBeenCalled();
  });

  it("reports nothing saved at first", async () => {
    expect(await (await load()).handlers.getSettings()).toEqual({ revision: 0 });
  });

  it("ignores anything unknown that is in storage", async () => {
    const { handlers } = await load({ railNav: true, ghost: 1, motion: "no" });
    expect(await handlers.getSettings()).toEqual({ railNav: true, revision: 0 });
  });

  it("keeps a change, returns the full set and publishes it", async () => {
    const { handlers, store, publish } = await load({ railNav: true });
    expect(await handlers.setSetting({ key: "wideRail", value: true })).toEqual({ railNav: true, wideRail: true, revision: 1 });
    expect(store.get("settings")).toEqual({ railNav: true, wideRail: true, revision: 1 });
    expect(publish).toHaveBeenCalledWith("settings", { railNav: true, wideRail: true, revision: 1 });
  });

  it("does not lose a change when two arrive together", async () => {
    const { handlers, store } = await load();
    await Promise.all([
      handlers.setSetting({ key: "railNav", value: true }),
      handlers.setSetting({ key: "motion", value: false }),
    ]);
    expect(store.get("settings")).toEqual({ railNav: true, motion: false, revision: 2 });
  });

  it("keeps independent accessory edits from clients with the same old snapshot", async () => {
    const { handlers } = await load({ railLiveStatus: { "existing/nav": "badge" } });
    await Promise.all([
      handlers.setRailLiveStatus({ itemId: "alpha/a", mode: "badge" }),
      handlers.setRailLiveStatus({ itemId: "beta/b", mode: "icon" }),
    ]);
    expect(await handlers.getSettings()).toEqual({
      railLiveStatus: { "existing/nav": "badge", "alpha/a": "badge", "beta/b": "icon" }, revision: 2,
    });
    await handlers.setRailLiveStatus({ itemId: "alpha/a", mode: "off" });
    expect(await handlers.getSettings()).toEqual({
      railLiveStatus: { "existing/nav": "badge", "alpha/a": "off", "beta/b": "icon" }, revision: 3,
    });
  });

  it("versions settings monotonically across writes and preserves the revision after reload", async () => {
    const { handlers, store } = await load({ railNav: true });
    const first = await handlers.setSetting({ key: "motion", value: false });
    const second = await handlers.setSetting({ key: "defaultDensity", value: "compact" });
    expect(first).toEqual({ railNav: true, motion: false, revision: 1 });
    expect(second).toEqual({ railNav: true, motion: false, defaultDensity: "compact", revision: 2 });
    expect(await (await load(store.get("settings"))).handlers.getSettings()).toEqual(second);
  });
});
