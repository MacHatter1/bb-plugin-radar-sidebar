import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import {
  DEFAULT_SETTINGS,
  isValidSettingValue,
  sanitizeSaved,
  type SavedSettings,
  type RailLiveStatus,
  type SettingKey,
  type SettingValues,
} from "@/lib/settings";
import { parseSettingsSnapshot, SETTINGS_CHANNEL, SETTINGS_RPC, type SettingsSnapshot } from "@/lib/settingsRpc";
import { changeProjectOrganisation, EMPTY_PROJECT_ORGANISATION, orderedProjectPins, projectOrganisationChangeSchema, type ProjectOrganisationChange } from "@/lib/projectOrganisation";

/** Authoritative server choices, with pending local edits layered on top.
 * Revisions order fetches, pushes and save replies across windows. Local
 * writes run in intent order, even if network requests would arrive reordered. */
const CACHE_KEY = "radar-sidebar:settings:v1";

function readCache(): SavedSettings {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? sanitizeSaved(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

let confirmed: SavedSettings = readCache();
let saved: SavedSettings = confirmed;
let snapshot: SettingValues = { ...DEFAULT_SETTINGS, ...saved };
let revision = -1;
const listeners = new Set<() => void>();
type Rpc = ReturnType<typeof useRpc<typeof SETTINGS_RPC>>;
type PendingWrite = {
  apply: (base: SavedSettings) => SavedSettings;
  request: () => Promise<SettingsSnapshot>;
  resolve: (ok: boolean) => void;
};
const pending: PendingWrite[] = [];
let writing = false;
let loaded = false;
let loading: Promise<void> | null = null;
let refreshQueued = false;
let readers = 0;
let connection: ReturnType<typeof useRealtimeConnectionState> | null = null;
/** Invalidates callbacks from a test reset (or a future store teardown). */
let generation = 0;

function sameSaved(a: SavedSettings, b: SavedSettings): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<SettingKey>;
  for (const key of keys) {
    if (a[key] === b[key]) continue;
    if (key === "projectOrganisation") {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
      continue;
    }
    if (key !== "railLiveStatus" && key !== "pinnedProjects") return false;
    const left = a[key];
    const right = b[key];
    if (!left || !right) return false;
    const ids = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const id of ids) if (left[id] !== right[id]) return false;
  }
  return true;
}

function publish(): void {
  // Only acknowledged choices survive a reload; never cache speculative edits.
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(confirmed));
  } catch {
    // The cache only speeds up the first paint.
  }
  const next = pending.reduce((base, write) => write.apply(base), confirmed);
  if (sameSaved(saved, next)) return;
  saved = next;
  snapshot = { ...DEFAULT_SETTINGS, ...saved };
  for (const listener of listeners) listener();
}

function receive(raw: unknown): boolean {
  const remote = parseSettingsSnapshot(raw);
  if (!remote) return false;
  if (remote.revision < revision || (remote.revision === revision && revision > 0)) return true;
  revision = remote.revision;
  confirmed = sanitizeSaved(remote);
  loaded = true;
  publish();
  return true;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** One pump for both setting toggles and atomic accessory edits. Failed
 * writes drop only their own overlay, never a newer edit of the same key. */
async function pump(): Promise<void> {
  if (writing || pending.length === 0) return;
  writing = true;
  const currentGeneration = generation;
  while (pending.length > 0 && generation === currentGeneration) {
    const write = pending[0]!;
    let ok = false;
    try {
      const remote = await write.request();
      if (generation !== currentGeneration) return;
      ok = receive(remote);
    } catch {
      // Leave the last server snapshot intact; removing this overlay rolls back.
    }
    if (generation !== currentGeneration) return;
    pending.shift();
    publish();
    write.resolve(ok);
  }
  if (generation === currentGeneration) writing = false;
}

function enqueue(
  apply: PendingWrite["apply"],
  request: PendingWrite["request"],
): Promise<boolean> {
  const result = new Promise<boolean>((resolve) => {
    pending.push({ apply, request, resolve });
    publish();
  });
  void pump();
  return result;
}

/** A refresh requested during an older fetch runs after it, so a reconnect
 * cannot be satisfied by a request made before the missed server changes. */
function load(rpc: Rpc, force: boolean): void {
  if (loading) {
    if (force) refreshQueued = true;
    return;
  }
  if (loaded && !force) return;
  const currentGeneration = generation;
  loading = rpc.call("getSettings")
    .then((remote) => {
      if (generation === currentGeneration) receive(remote);
    })
    .catch(() => {
      // Offline: keep the last values and retry on reconnect or the next mount.
    })
    .finally(() => {
      if (generation !== currentGeneration) return;
      loading = null;
      if (refreshQueued) {
        refreshQueued = false;
        load(rpc, true);
      }
    });
}

function useSettingsSync(refresh: boolean): void {
  const rpc = useRpc<typeof SETTINGS_RPC>();
  const state = useRealtimeConnectionState();
  useEffect(() => {
    // No readers means pushes may have been missed while a different sidebar
    // provider was selected. The first reader always reconciles on returning.
    const firstReader = readers++ === 0;
    load(rpc, refresh || (firstReader && (loaded || loading !== null)));
    return () => {
      if (--readers === 0) connection = null;
    };
  }, [rpc, refresh]);
  useEffect(() => {
    // All readers share one connection. Only its first observer refetches.
    const previous = connection;
    connection = state;
    if (state === "connected" && previous !== null && previous !== "connected") load(rpc, true);
  }, [rpc, state]);
  useRealtime(SETTINGS_CHANNEL, (payload) => { receive(payload); });
}

export function useSettingValues(options?: { refresh?: boolean }): SettingValues {
  useSettingsSync(options?.refresh === true);
  return useSyncExternalStore(subscribe, () => snapshot, () => DEFAULT_SETTINGS);
}

/** Save one choice optimistically; false means this write could not be kept. */
export function useSetSetting(): <K extends SettingKey>(
  key: K,
  value: SettingValues[K],
) => Promise<boolean> {
  const rpc = useRpc<typeof SETTINGS_RPC>();
  return useCallback(async (key, value) => {
    if (!isValidSettingValue(key, value)) return false;
    if (pending.length === 0 && snapshot[key] === value) return true;
    return enqueue(
      (base) => ({ ...base, [key]: value }),
      () => rpc.call("setSetting", { key, value }),
    );
  }, [rpc]);
}

/** Patch one accessory instead of submitting a potentially stale whole map. */
export function useSetRailLiveStatus(): (itemId: string, mode: RailLiveStatus) => Promise<boolean> {
  const rpc = useRpc<typeof SETTINGS_RPC>();
  return useCallback(async (itemId, mode) => {
    if (!isValidSettingValue("railLiveStatus", { [itemId]: mode })) return false;
    return enqueue(
      (base) => ({ ...base, railLiveStatus: { ...base.railLiveStatus, [itemId]: mode } }),
      () => rpc.call("setRailLiveStatus", { itemId, mode }),
    );
  }, [rpc]);
}

/** Patch one project pin without overwriting another window's pins. */
export function useSetProjectPinned(): (projectId: string, pinned: boolean) => Promise<boolean> {
  const rpc = useRpc<typeof SETTINGS_RPC>();
  return useCallback(async (projectId, pinned) => {
    if (!isValidSettingValue("pinnedProjects", { [projectId]: pinned })) return false;
    return enqueue(
      (base) => {
        const pinnedProjects = { ...base.pinnedProjects, [projectId]: pinned };
        if (!pinned) delete pinnedProjects[projectId];
        const organisation = base.projectOrganisation ?? EMPTY_PROJECT_ORGANISATION;
        return { ...base, pinnedProjects, projectOrganisation: { ...organisation, pinOrder: orderedProjectPins(pinnedProjects, organisation.pinOrder) } };
      },
      () => rpc.call("setProjectPinned", { projectId, pinned }),
    );
  }, [rpc]);
}

/** Rebase a single layout intent over remote changes while its save is pending. */
export function useChangeProjectOrganisation(): (change: ProjectOrganisationChange) => Promise<boolean> {
  const rpc = useRpc<typeof SETTINGS_RPC>();
  return useCallback(async (change) => {
    const parsed = projectOrganisationChangeSchema.safeParse(change);
    if (!parsed.success) return false;
    return enqueue(
      (base) => {
        try {
          return { ...base, projectOrganisation: changeProjectOrganisation(base.projectOrganisation ?? EMPTY_PROJECT_ORGANISATION, base.pinnedProjects ?? {}, parsed.data) };
        } catch { return base; }
      },
      () => rpc.call("changeProjectOrganisation", parsed.data),
    );
  }, [rpc]);
}

/** Test hook: start from the defaults; ignore any old in-flight callbacks. */
export function resetSettings(): void {
  generation += 1;
  for (const write of pending) write.resolve(false);
  pending.length = 0;
  writing = false;
  loaded = false;
  loading = null;
  refreshQueued = false;
  revision = -1;
  confirmed = {};
  saved = {};
  snapshot = { ...DEFAULT_SETTINGS };
  try { localStorage.removeItem(CACHE_KEY); } catch { /* Ignore. */ }
  for (const listener of listeners) listener();
}

/** Test hook: seed choices without pretending they have a server revision. */
export function seedSettings(values: Record<string, unknown>): void {
  confirmed = { ...confirmed, ...sanitizeSaved(values) };
  publish();
}
