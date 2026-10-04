import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import {
  DEFAULT_SETTINGS,
  isValidSettingValue,
  sanitizeSaved,
  type SavedSettings,
  type SettingKey,
  type SettingValues,
} from "@/lib/settings";
import { SETTINGS_CHANNEL, SETTINGS_RPC } from "@/lib/settingsRpc";

/**
 * The plugin's settings. The server keeps them (shared by every device); this
 * store is the frontend's copy, which the list, the rail and the Settings
 * section all read. It paints at once from the last values this browser saw,
 * then follows the server: a fetch on load, a push when another window or
 * device changes one. Only the choices someone changed are held, so a new
 * default reaches everyone who never touched that setting.
 */

/** The last values the server gave this browser, so the first paint is right. */
const CACHE_KEY = "radar-sidebar:settings:v1";

function readCache(): SavedSettings {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? sanitizeSaved(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

let saved: SavedSettings = readCache();
let snapshot: SettingValues = { ...DEFAULT_SETTINGS, ...saved };
const listeners = new Set<() => void>();
/** Saves under way. Pushes and fetches wait: the save's reply is the latest word. */
let writesInFlight = 0;
let loaded = false;
let loading: Promise<void> | null = null;

function sameSaved(a: SavedSettings, b: SavedSettings): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<SettingKey>;
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

function publish(next: SavedSettings): void {
  if (sameSaved(saved, next)) return;
  saved = next;
  // A new object each time, so useSyncExternalStore sees the change.
  snapshot = { ...DEFAULT_SETTINGS, ...saved };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(saved));
  } catch {
    // The cache only speeds up the first paint.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type Rpc = ReturnType<typeof useRpc<typeof SETTINGS_RPC>>;

/** Fetch the saved choices once per page load; `force` fetches again. */
function load(rpc: Rpc, force: boolean): void {
  if ((loaded && !force) || loading) return;
  loading = rpc
    .call("getSettings")
    .then((remote) => {
      loaded = true;
      if (writesInFlight === 0) publish(sanitizeSaved(remote));
    })
    .catch(() => {
      // Offline or the server is busy: carry on with what we have.
    })
    .finally(() => {
      loading = null;
    });
}

/** Keep this window in step with the server for as long as a reader is mounted. */
function useSettingsSync(refresh: boolean): void {
  const rpc = useRpc<typeof SETTINGS_RPC>();
  useEffect(() => {
    load(rpc, refresh);
  }, [rpc, refresh]);
  useRealtime(SETTINGS_CHANNEL, (payload) => {
    if (writesInFlight === 0) publish(sanitizeSaved(payload));
  });
}

/** Every setting's current value; defaults fill in whatever isn't saved. */
export function useSettingValues(options?: { refresh?: boolean }): SettingValues {
  useSettingsSync(options?.refresh === true);
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => DEFAULT_SETTINGS,
  );
}

/**
 * Save one setting. The change shows at once; resolves false, with the old
 * value back, if the server could not keep it.
 */
export function useSetSetting(): <K extends SettingKey>(
  key: K,
  value: SettingValues[K],
) => Promise<boolean> {
  const rpc = useRpc<typeof SETTINGS_RPC>();
  return useCallback(
    async (key, value) => {
      if (!isValidSettingValue(key, value)) return false;
      if (snapshot[key] === value) return true;
      const before = saved[key];
      writesInFlight += 1;
      publish({ ...saved, [key]: value });
      try {
        publish(sanitizeSaved(await rpc.call("setSetting", { key, value })));
        return true;
      } catch {
        const restored = { ...saved };
        if (before === undefined) delete restored[key];
        else (restored as Record<string, unknown>)[key] = before;
        publish(restored);
        return false;
      } finally {
        writesInFlight -= 1;
      }
    },
    [rpc],
  );
}

/** Test hook: start from the defaults with nothing fetched or cached. */
export function resetSettings(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // Ignore.
  }
  writesInFlight = 0;
  loaded = false;
  loading = null;
  saved = {};
  snapshot = { ...DEFAULT_SETTINGS };
  for (const listener of listeners) listener();
}

/** Test hook: set values as if the server had just reported them. */
export function seedSettings(values: Record<string, unknown>): void {
  publish({ ...saved, ...sanitizeSaved(values) });
}
