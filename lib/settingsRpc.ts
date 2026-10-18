// The RPC the settings travel over: the frontend asks the plugin's server for
// the saved choices and sends each change. Hand-rolled Standard Schema
// validators share the same validation as the saved settings.
import type { StandardSchemaV1 } from "@get-bb/plugin-sdk";
import { projectOrganisationChangeSchema, type ProjectOrganisationChange } from "./projectOrganisation";
import {
  SETTINGS,
  isValidSettingValue,
  sanitizeSaved,
  type SavedSettings,
  type SettingKey,
  type SettingValues,
} from "./settings";

/** Full saved choices plus a monotonically increasing server revision. */
export type SettingsSnapshot = SavedSettings & { revision: number };

/** Legacy snapshots have no revision; their choices remain readable at revision 0. */
export function parseSettingsSnapshot(raw: unknown): SettingsSnapshot | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const revision = (raw as Record<string, unknown>).revision;
  if (revision !== undefined &&
      (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0)) return null;
  return { ...sanitizeSaved(raw), revision: revision === undefined ? 0 : revision as number };
}

/** The realtime channel the server publishes versioned saved choices on. */
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

export type ProjectPinChange = { projectId: string; pinned: boolean };
const projectPinChange = schema<ProjectPinChange>((input) => {
  const projectId = (input as ProjectPinChange | null)?.projectId;
  const pinned = (input as ProjectPinChange | null)?.pinned;
  if (typeof projectId !== "string" || !isValidSettingValue("pinnedProjects", { [projectId]: pinned })) {
    return { ok: false, message: "Invalid project or pin choice." };
  }
  return { ok: true, value: { projectId, pinned: pinned as boolean } };
});

export type ContributorEnabledChange = { pluginId: string; enabled: boolean };
const contributorChange = schema<ContributorEnabledChange>((input) => {
  const pluginId = (input as ContributorEnabledChange | null)?.pluginId;
  const enabled = (input as ContributorEnabledChange | null)?.enabled;
  if (typeof pluginId !== "string" || typeof enabled !== "boolean" || !isValidSettingValue("disabledContributors", { [pluginId]: enabled })) {
    return { ok: false, message: "Invalid contributor or enabled choice." };
  }
  return { ok: true, value: { pluginId, enabled } };
});

const noInput = schema<null>((value) =>
  value === null || value === undefined
    ? { ok: true, value: null }
    : { ok: false, message: "Takes no input." },
);

const organisationChange = schema<ProjectOrganisationChange>((value) => {
  const parsed = projectOrganisationChangeSchema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, message: "Invalid project organisation change." };
});

const change = schema<SettingChange>((value) => {
  const { key, value: next } = (value ?? {}) as Record<string, unknown>;
  if (typeof key !== "string" || !Object.hasOwn(SETTINGS, key)) {
    return { ok: false, message: "Unknown setting." };
  }
  return isValidSettingValue(key as SettingKey, next)
    ? { ok: true, value: { key, value: next } as SettingChange }
    : { ok: false, message: `Not a value ${key} can take.` };
});

const saved = schema<SettingsSnapshot>((value) => {
  const snapshot = parseSettingsSnapshot(value);
  return snapshot
    ? { ok: true, value: snapshot }
    : { ok: false, message: "Invalid settings snapshot." };
});

export const SETTINGS_RPC = {
  getSettings: { input: noInput, output: saved },
  setSetting: { input: change, output: saved },
  setProjectPinned: { input: projectPinChange, output: saved },
  changeProjectOrganisation: { input: organisationChange, output: saved },
  setContributorEnabled: { input: contributorChange, output: saved },
} as const;
