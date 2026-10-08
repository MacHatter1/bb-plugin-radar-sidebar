import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

export type NativeModalSdk = { experimental_desktopBrowsers: Pick<PluginBrowserBbSdk["experimental_desktopBrowsers"], "listTabs"> };
export type NativeBrowserBridge = {
  getTarget(): Promise<unknown>;
  setVisibleWithoutFocus(request: { tabId: string; visible: boolean }): void;
  onState?(listener: () => void): () => void;
};
const targetSchema = z.object({ hostId: z.string().min(1).max(256), instanceId: z.string().min(1).max(256), generation: z.string().min(1).max(256) });

export function desktopBrowserBridge(): NativeBrowserBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as Window & { bbDesktop?: { browser?: Partial<NativeBrowserBridge> } }).bbDesktop?.browser;
  const getTarget = bridge?.getTarget;
  const setVisible = bridge?.setVisibleWithoutFocus;
  const onState = bridge?.onState;
  if (typeof getTarget !== "function" || typeof setVisible !== "function") return null;
  return {
    getTarget: () => getTarget.call(bridge),
    setVisibleWithoutFocus: request => setVisible.call(bridge, request),
    ...(typeof onState === "function" ? { onState: (listener: () => void) => onState.call(bridge, listener) } : {}),
  };
}

/** Pause only views the viewing desktop reports as visible; preserve inactive tabs. */
export function pauseNativeBrowsers(sdk: NativeModalSdk, bridge: NativeBrowserBridge, threadIds: readonly string[], mayRestore: (threadId: string) => boolean) {
  let active = true;
  let target: z.infer<typeof targetSchema> | null = null;
  let unsubscribe: (() => void) | undefined;
  const scopes = [...new Set(threadIds)];
  const hidden = new Map<string, string>();
  let scanning: Promise<void> | null = null;
  let rescan = false;
  const scan = (): Promise<void> => {
    if (!active || !target) return Promise.resolve();
    if (scanning) { rescan = true; return scanning; }
    const desktopTarget = target;
    scanning = (async () => {
      do {
        rescan = false;
        const results = await Promise.all(scopes.map(async threadId => ({ threadId, ...await sdk.experimental_desktopBrowsers.listTabs({ ...desktopTarget, threadId }) })));
        if (!active) return;
        for (const { threadId, tabs } of results) {
          for (const tab of tabs) {
            if (tab.threadId !== threadId || tab.presentation !== "reveal") continue;
            hidden.set(tab.tabId, threadId);
            bridge.setVisibleWithoutFocus({ tabId: tab.tabId, visible: false });
          }
        }
      } while (active && rescan);
    })();
    void scanning.then(() => { scanning = null; }, () => { scanning = null; });
    return scanning;
  };
  const ready = (async () => {
    if (scopes.length === 0) return;
    const value = await bridge.getTarget();
    if (!active || value === null) return;
    target = targetSchema.parse(value);
    unsubscribe = bridge.onState?.(() => { void scan().catch(() => {}); });
    await scan();
  })();
  return {
    ready,
    dispose() {
      if (!active) return;
      active = false;
      unsubscribe?.();
      for (const [tabId, threadId] of hidden) {
        if (mayRestore(threadId)) bridge.setVisibleWithoutFocus({ tabId, visible: true });
      }
      hidden.clear();
    },
  };
}
