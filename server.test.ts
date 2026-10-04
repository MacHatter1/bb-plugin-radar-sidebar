import { describe, expect, it, vi } from "vitest";
import plugin from "./server";

type Handlers = {
  getSettings: () => Promise<unknown>;
  setSetting: (input: { key: string; value: string | boolean }) => Promise<unknown>;
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
    expect(await (await load()).handlers.getSettings()).toEqual({});
  });

  it("ignores anything unknown that is in storage", async () => {
    const { handlers } = await load({ railNav: true, ghost: 1, motion: "no" });
    expect(await handlers.getSettings()).toEqual({ railNav: true });
  });

  it("keeps a change, returns the full set and publishes it", async () => {
    const { handlers, store, publish } = await load({ railNav: true });
    expect(await handlers.setSetting({ key: "wideRail", value: true })).toEqual({ railNav: true, wideRail: true });
    expect(store.get("settings")).toEqual({ railNav: true, wideRail: true });
    expect(publish).toHaveBeenCalledWith("settings", { railNav: true, wideRail: true });
  });

  it("does not lose a change when two arrive together", async () => {
    const { handlers, store } = await load();
    await Promise.all([
      handlers.setSetting({ key: "railNav", value: true }),
      handlers.setSetting({ key: "motion", value: false }),
    ]);
    expect(store.get("settings")).toEqual({ railNav: true, motion: false });
  });
});
