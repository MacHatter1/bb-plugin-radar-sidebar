// bb-plugin-radar-sidebar — backend entry.
//
// The sidebar itself is frontend-only: thread state flows through the host's
// sidebar hooks and the public SDK. What the backend owns is the plugin's
// settings. They live in the plugin's own storage rather than BB's plugin
// settings, so BB draws no flat list of its own and the Settings section is
// the only place to change them. Only the choices someone changed are stored;
// a change is published so every open window and device picks it up.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { sanitizeSaved, type SavedSettings } from "./lib/settings";
import { SETTINGS_CHANNEL, SETTINGS_RPC } from "./lib/settingsRpc";

const STORAGE_KEY = "settings";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const read = async (): Promise<SavedSettings> =>
    sanitizeSaved(await bb.storage.kv.get(STORAGE_KEY));

  // Changes read, merge and write in turn, so two quick toggles can't lose one.
  let queue: Promise<unknown> = Promise.resolve();

  bb.rpc.register(SETTINGS_RPC, {
    getSettings: read,
    setSetting: ({ key, value }) => {
      const next = queue.then(async () => {
        const saved: SavedSettings = { ...(await read()), [key]: value };
        await bb.storage.kv.set(STORAGE_KEY, saved);
        bb.realtime.publish(SETTINGS_CHANNEL, saved);
        return saved;
      });
      queue = next.catch(() => undefined);
      return next;
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
