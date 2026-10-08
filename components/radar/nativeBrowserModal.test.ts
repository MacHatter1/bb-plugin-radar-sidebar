import { describe, expect, it, vi } from "vitest";
import { pauseNativeBrowsers, type NativeBrowserBridge, type NativeModalSdk } from "./nativeBrowserModal";

const target = { hostId: "local", instanceId: "this-window", generation: "g1" };
function tab(tabId: string, threadId: string, presentation: "reveal" | "hidden") {
  return { tabId, threadId, presentation, url: "https://example.com", title: "Example", profile: { kind: "personal" as const }, control: null };
}
function setup(tabs = [tab("visible", "thread", "reveal"), tab("inactive", "thread", "hidden")]) {
  const bridge = { getTarget: vi.fn<NativeBrowserBridge["getTarget"]>(async () => target), setVisibleWithoutFocus: vi.fn() } satisfies NativeBrowserBridge;
  const sdk = { experimental_desktopBrowsers: { listTabs: vi.fn<NativeModalSdk["experimental_desktopBrowsers"]["listTabs"]>(async () => ({ tabs })) } } satisfies NativeModalSdk;
  return { bridge, sdk };
}

describe("Radar modal native-browser lifecycle", () => {
  it("hides only previously visible views in this desktop window and restores without focus", async () => {
    const { sdk, bridge } = setup();
    const modal = pauseNativeBrowsers(sdk, bridge, ["thread", "thread"], () => true);
    await modal.ready;
    expect(sdk.experimental_desktopBrowsers.listTabs).toHaveBeenCalledExactlyOnceWith({ ...target, threadId: "thread" });
    expect(bridge.setVisibleWithoutFocus.mock.calls).toEqual([[{ tabId: "visible", visible: false }]]);
    modal.dispose();
    expect(bridge.setVisibleWithoutFocus.mock.calls).toEqual([[{ tabId: "visible", visible: false }], [{ tabId: "visible", visible: true }]]);
    modal.dispose();
    expect(bridge.setVisibleWithoutFocus).toHaveBeenCalledTimes(2);
  });

  it("handles visible browser views in multiple thread splits", async () => {
    const { sdk, bridge } = setup();
    sdk.experimental_desktopBrowsers.listTabs.mockImplementation(async ({ threadId }) => ({ tabs: [tab(`browser-${threadId}`, threadId, "reveal")] }));
    const modal = pauseNativeBrowsers(sdk, bridge, ["left", "right"], () => true);
    await modal.ready;
    expect(bridge.setVisibleWithoutFocus.mock.calls).toEqual([[{ tabId: "browser-left", visible: false }], [{ tabId: "browser-right", visible: false }]]);
    modal.dispose();
    expect(bridge.setVisibleWithoutFocus.mock.calls.slice(2)).toEqual([[{ tabId: "browser-left", visible: true }], [{ tabId: "browser-right", visible: true }]]);
  });

  it("never hides a browser after the modal has already closed", async () => {
    const { sdk, bridge } = setup();
    let resolve!: (value: Awaited<ReturnType<NativeModalSdk["experimental_desktopBrowsers"]["listTabs"]>>) => void;
    sdk.experimental_desktopBrowsers.listTabs.mockImplementation(() => new Promise(done => { resolve = done; }));
    const modal = pauseNativeBrowsers(sdk, bridge, ["thread"], () => true);
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    modal.dispose();
    resolve({ tabs: [tab("visible", "thread", "reveal")] });
    await modal.ready;
    expect(bridge.setVisibleWithoutFocus).not.toHaveBeenCalled();
  });

  it("does not resurrect the old thread's browser after navigation", async () => {
    const { sdk, bridge } = setup();
    let stillHere = true;
    const modal = pauseNativeBrowsers(sdk, bridge, ["thread"], () => stillHere);
    await modal.ready;
    stillHere = false;
    modal.dispose();
    expect(bridge.setVisibleWithoutFocus.mock.calls).toEqual([[{ tabId: "visible", visible: false }]]);
  });

  it("leaves native views alone when there is no desktop browser target", async () => {
    const { sdk, bridge } = setup();
    bridge.getTarget.mockResolvedValue(null);
    const modal = pauseNativeBrowsers(sdk, bridge, ["thread"], () => true);
    await modal.ready;
    modal.dispose();
    expect(sdk.experimental_desktopBrowsers.listTabs).not.toHaveBeenCalled();
    expect(bridge.setVisibleWithoutFocus).not.toHaveBeenCalled();
  });

  it("leaves views alone if discovery fails", async () => {
    const { sdk, bridge } = setup();
    sdk.experimental_desktopBrowsers.listTabs.mockRejectedValue(new Error("offline"));
    const modal = pauseNativeBrowsers(sdk, bridge, ["thread"], () => true);
    await expect(modal.ready).rejects.toThrow("offline");
    modal.dispose();
    expect(bridge.setVisibleWithoutFocus).not.toHaveBeenCalled();
  });
});
