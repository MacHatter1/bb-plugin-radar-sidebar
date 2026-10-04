// The RPC the settings travel over: the frontend asks the plugin's server for
// the saved choices and sends each change. Hand-rolled Standard Schema
// validators keep the contract free of a validation library.
import type { StandardSchemaV1 } from "@get-bb/plugin-sdk";
import {
  SETTINGS,
  isValidSettingValue,
  sanitizeSaved,
  type SavedSettings,
  type SettingKey,
  type SettingValues,
} from "./settings";

/** The realtime channel the server publishes the full saved set on. */
export const SETTINGS_CHANNEL = "settings";

type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

function schema<T>(check: (value: unknown) => Checked<T>): StandardSchemaV1<T, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "radar-sidebar",
      validate: (value) => {
        const checked = check(value);
        return checked.ok
          ? { value: checked.value }
          : { issues: [{ message: checked.message }] };
      },
    },
  };
}

export interface SettingChange {
  key: SettingKey;
  value: SettingValues[SettingKey];
}

const noInput = schema<null>((value) =>
  value === null || value === undefined
    ? { ok: true, value: null }
    : { ok: false, message: "Takes no input." },
);

const change = schema<SettingChange>((value) => {
  const { key, value: next } = (value ?? {}) as Record<string, unknown>;
  if (typeof key !== "string" || !Object.hasOwn(SETTINGS, key)) {
    return { ok: false, message: "Unknown setting." };
  }
  return isValidSettingValue(key as SettingKey, next)
    ? { ok: true, value: { key, value: next } as SettingChange }
    : { ok: false, message: `Not a value ${key} can take.` };
});

const saved = schema<SavedSettings>((value) => ({
  ok: true,
  value: sanitizeSaved(value),
}));

export const SETTINGS_RPC = {
  getSettings: { input: noInput, output: saved },
  setSetting: { input: change, output: saved },
} as const;
