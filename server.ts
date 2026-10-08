// bb-plugin-radar-sidebar — backend entry.
//
// The sidebar itself is frontend-only: thread state flows through the host's
// sidebar hooks and the public SDK. What the backend owns is the plugin's
// settings. They live in the plugin's own storage rather than BB's plugin
// settings, so BB draws no flat list of its own and the Settings section is
// the only place to change them. Only the choices someone changed are stored;
// a change is published so every open window and device picks it up.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { changeProjectOrganisation, EMPTY_PROJECT_ORGANISATION, orderedProjectPins } from "./lib/projectOrganisation";
import { isValidSettingValue, sanitizeSaved, type SavedSettings } from "./lib/settings";
import { parseSettingsSnapshot, SETTINGS_CHANNEL, SETTINGS_RPC, type SettingsSnapshot } from "./lib/settingsRpc";

const STORAGE_KEY = "settings";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const read = async (): Promise<SettingsSnapshot> => {
    const raw = await bb.storage.kv.get(STORAGE_KEY);
    return parseSettingsSnapshot(raw) ?? { ...sanitizeSaved(raw), revision: 0 };
  };

  // Changes read, merge and write in turn, so two quick toggles can't lose one.
  let queue: Promise<unknown> = Promise.resolve();

  const update = (apply: (current: SavedSettings) => SavedSettings): Promise<SettingsSnapshot> => {
    const next = queue.then(async () => {
      const current = await read();
      if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error("Settings revision exhausted.");
      const saved: SettingsSnapshot = { ...apply(current), revision: current.revision + 1 };
      // Choices and revision share one KV write, including on a reload.
      await bb.storage.kv.set(STORAGE_KEY, saved);
      bb.realtime.publish(SETTINGS_CHANNEL, saved);
      return saved;
    });
    queue = next.catch(() => undefined);
    return next;
  };

  bb.rpc.register(SETTINGS_RPC, {
    getSettings: read,
    setSetting: ({ key, value }) => update((current) => ({ ...current, [key]: value })),
    setProjectPinned: ({ projectId, pinned }) => update((current) => {
      const pinnedProjects = { ...current.pinnedProjects, [projectId]: pinned };
      if (!pinned) delete pinnedProjects[projectId];
      if (!isValidSettingValue("pinnedProjects", pinnedProjects)) throw new Error("Too many pinned projects.");
      const organisation = current.projectOrganisation ?? EMPTY_PROJECT_ORGANISATION;
      return { ...current, pinnedProjects, projectOrganisation: { ...organisation, pinOrder: orderedProjectPins(pinnedProjects, organisation.pinOrder) } };
    }),
    changeProjectOrganisation: (change) => update((current) => ({
      ...current,
      projectOrganisation: changeProjectOrganisation(current.projectOrganisation ?? EMPTY_PROJECT_ORGANISATION, current.pinnedProjects ?? {}, change),
    })),
    // Patch only this item against the latest map, inside the same write queue.
    setRailLiveStatus: ({ itemId, mode }) => update((current) => ({
      ...current, railLiveStatus: { ...current.railLiveStatus, [itemId]: mode },
    })),
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
