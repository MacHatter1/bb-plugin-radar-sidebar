// The plugin's settings, defined once. The plugin keeps them itself (see
// server.ts and components/radar/settingsStore.ts) rather than in BB's plugin
// settings, so BB draws no flat list of its own and the Settings section is
// the only place to change them. This file holds their labels, defaults and
// grouping; the server, the store and the section all read it, so they cannot
// drift. Plain TypeScript.
import {
  DEFAULT_SWIPE_LEFT,
  DEFAULT_SWIPE_RIGHT,
  SWIPE_ACTION_OPTION_LABELS,
} from "./swipe";
import { EMPTY_PROJECT_ORGANISATION, projectOrganisationSchema, type ProjectOrganisation } from "./projectOrganisation";

type SettingDescriptor =
  | { type: "project-organisation"; label: string; description: string; default: ProjectOrganisation }
  | { type: "project-pin-map"; label: string; description: string; default: Record<string, boolean> }
  | { type: "contributor-map"; label: string; description: string; default: Record<string, boolean> }
  | { type: "boolean"; label: string; description: string; default: boolean }
  | {
      type: "select";
      label: string;
      description: string;
      options: readonly string[];
      default: string;
    };

export const SETTINGS = {
  // Shared by the optional project-rail section. Keep them on clients without
  // that extension too, so an existing arrangement survives settings writes.
  projectOrganisation: {
    type: "project-organisation",
    label: "Project organisation",
    description: "Saved pin order, collections and their collapsed state.",
    default: EMPTY_PROJECT_ORGANISATION,
  },
  pinnedProjects: {
    type: "project-pin-map",
    label: "Pinned projects",
    description: "Projects kept at the top of the project list.",
    default: {},
  },
  disabledContributors: {
    type: "contributor-map",
    label: "Plugin contributions",
    description: "Disable individual plugins’ thread badges and context-menu actions without disabling the plugin itself.",
    default: {},
  },
  defaultDensity: {
    type: "select",
    label: "Default row density",
    description:
      "Used until you change density with the header toggle, which is remembered per client.",
    options: ["comfortable", "compact"],
    default: "comfortable",
  },
  twoLineTitles: {
    type: "boolean",
    label: "Two-line titles",
    description:
      "Let long thread titles wrap onto a second line before truncating. Applies in both densities.",
    default: false,
  },
  loudUnread: {
    type: "boolean",
    label: "Loud unread rows",
    description:
      "Tinted wash and accent bar on finished-but-unseen threads. Off keeps the check icon and unread pip only.",
    default: true,
  },
  adaptiveCollapse: {
    type: "boolean",
    label: "Collapse quiet rows",
    description:
      "Fold read-idle threads down to title, project and time so rows that matter stand out.",
    default: true,
  },
  motion: {
    type: "boolean",
    label: "Attention pulse",
    description:
      "Breathe a soft glow on rows that need input or have failed. Turns off automatically under prefers-reduced-motion.",
    default: true,
  },
  celebrate: {
    type: "boolean",
    label: "Completion pop",
    description: "Pop the check badge once when a thread finishes.",
    default: true,
  },
  hoverCard: {
    type: "boolean",
    label: "Hover peek card",
    description:
      "Show a preview card with goal, model, branch, PR and context usage when pausing on a thread.",
    default: true,
  },
  swipeActions: {
    type: "boolean",
    label: "Swipe actions",
    description:
      "Swipe a thread left or right to act on it: one finger on a touch screen, two fingers on a trackpad. A mouse's clicks, drags and Shift+wheel are unaffected.",
    default: true,
  },
  swipeRight: {
    type: "select",
    label: "Swipe right",
    description: "What swiping a thread to the right does.",
    options: SWIPE_ACTION_OPTION_LABELS,
    default: DEFAULT_SWIPE_RIGHT,
  },
  swipeLeft: {
    type: "select",
    label: "Swipe left",
    description: "What swiping a thread to the left does.",
    options: SWIPE_ACTION_OPTION_LABELS,
    default: DEFAULT_SWIPE_LEFT,
  },
} satisfies Record<string, SettingDescriptor>;

export type SettingKey = keyof typeof SETTINGS;

/** The value each setting holds: a switch is a boolean, a select is its option text. */
export type SettingValues = {
  [K in SettingKey]: (typeof SETTINGS)[K] extends { type: "project-organisation" }
    ? ProjectOrganisation
    : (typeof SETTINGS)[K] extends { type: "boolean" }
    ? boolean
    : (typeof SETTINGS)[K] extends { type: "contributor-map" | "project-pin-map" }
      ? Record<string, boolean>
      : string;
};

/** Every setting at its shipped default. */
export const DEFAULT_SETTINGS = Object.fromEntries(
  Object.entries(SETTINGS).map(([key, descriptor]) => [key, descriptor.default]),
) as SettingValues;

/** The settings someone changed; the rest are at their defaults. */
export type SavedSettings = Partial<{ [K in SettingKey]: SettingValues[K] }>;

/** Whether `value` is something this setting can hold. */
export function isValidSettingValue(key: SettingKey, value: unknown): boolean {
  const descriptor: SettingDescriptor = SETTINGS[key];
  if (descriptor.type === "project-organisation") return projectOrganisationSchema.safeParse(value).success;
  if (descriptor.type === "project-pin-map") {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
      && Object.keys(value).length <= 512
      && Object.entries(value).every(([id, pinned]) => id.length > 0 && id.length <= 128
        && !["__proto__", "constructor", "prototype"].includes(id) && typeof pinned === "boolean");
  }
  if (descriptor.type === "contributor-map") {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
      && Object.keys(value).length <= 128
      && Object.entries(value).every(([id, disabled]) => /^[a-z0-9-]{1,128}$/.test(id)
        && !["__proto__", "constructor", "prototype"].includes(id) && typeof disabled === "boolean");
  }
  return descriptor.type === "boolean"
    ? typeof value === "boolean"
    : typeof value === "string" && descriptor.options.includes(value);
}

/** How the Settings section groups the settings, in display order. A setting
 *  with `requires` is greyed out until that boolean setting is on. */
export const SETTING_GROUPS: readonly {
  id: "rows" | "attention" | "swipe";
  title: string;
  description: string;
  keys: readonly SettingKey[];
}[] = [
  {
    id: "rows",
    title: "Thread rows",
    description: "How each thread reads in the list.",
    keys: ["defaultDensity", "twoLineTitles", "loudUnread", "adaptiveCollapse"],
  },
  {
    id: "attention",
    title: "Attention and feedback",
    description: "What moves or pops up when a thread needs you.",
    keys: ["motion", "celebrate", "hoverCard"],
  },
  {
    id: "swipe",
    title: "Swipe actions",
    description: "Act on a thread without opening its menu.",
    keys: ["swipeActions", "swipeRight", "swipeLeft"],
  },
];

/** Settings that only apply once another boolean setting is on. */
export const SETTING_REQUIRES: Partial<Record<SettingKey, SettingKey>> = {
  swipeRight: "swipeActions",
  swipeLeft: "swipeActions",
};

/** One short line per setting for the Settings section; the descriptor's
 *  longer description stays on hover and in BB's generated list. */
export const SETTING_HINTS: Record<SettingKey, string> = {
  projectOrganisation: "Pin order and collections for your projects.",
  pinnedProjects: "Projects kept at the top.",
  disabledContributors: "Badges and menu actions supplied by other plugins.",
  defaultDensity: "Starting row size. The header toggle overrides it per client.",
  twoLineTitles: "Wrap long titles onto a second line.",
  loudUnread: "Tint and accent finished threads you haven't seen.",
  adaptiveCollapse: "Fold read, idle threads down to title and time.",
  motion: "A breathing glow on rows that need input or failed.",
  celebrate: "Pop the check once when a thread finishes.",
  hoverCard: "A peek card with goal, model, branch and PR on hover.",
  swipeActions: "Swipe rows to act: touch, or two fingers on a trackpad.",
  swipeRight: "What a swipe to the right does.",
  swipeLeft: "What a swipe to the left does.",
};

/** Keep only known settings holding a value they can take. */
export function sanitizeSaved(raw: unknown): SavedSettings {
  const saved: Record<string, unknown> = {};
  if (raw === null || typeof raw !== "object") return saved as SavedSettings;
  for (const key of Object.keys(SETTINGS) as SettingKey[]) {
    const value = (raw as Record<string, unknown>)[key];
    if (key === "projectOrganisation") {
      const parsed = projectOrganisationSchema.safeParse(value);
      if (parsed.success) saved[key] = parsed.data;
      continue;
    }
    if (isValidSettingValue(key, value)) saved[key] = key === "disabledContributors" || key === "pinnedProjects"
      ? { ...(value as Record<string, unknown>) }
      : value;
  }
  return saved as SavedSettings;
}
