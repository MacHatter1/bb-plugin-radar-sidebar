import type { ExperimentalSidebarNavigationItem } from "@get-bb/plugin-sdk/app";

/**
 * BB's stock sidebar navigation persists the user's arrangement (order +
 * visible rows) in server-synced UI preferences:
 * `sidebar.pluginPanelOrder` (string[]) and `sidebar.visiblePluginPanels`
 * (string[] | null). This module replicates the stock merge algorithm
 * exactly, so the Radar nav shows inline exactly what the user set inline
 * in "Customize sidebar" — and More holds exactly the rest.
 *
 * Row keys mirror the stock `${pluginId}/${id}` scheme: built-ins live
 * under `__bb__/`, and the automations panel is special-cased to
 * `__bb__/automations`.
 */

export const STOCK_KEY_NEW_THREAD = "__bb__/new-thread";
export const STOCK_KEY_SEARCH_THREADS = "__bb__/search-threads";
export const STOCK_KEY_EXTENSIONS = "__bb__/extensions";
export const STOCK_KEY_SKILLS = "__bb__/skills";
export const STOCK_KEY_AUTOMATIONS = "__bb__/automations";

const LEADING_KEYS: readonly string[] = [
  STOCK_KEY_NEW_THREAD,
  STOCK_KEY_SEARCH_THREADS,
  STOCK_KEY_EXTENSIONS,
  STOCK_KEY_SKILLS,
  STOCK_KEY_AUTOMATIONS,
];

/** Rows hidden for fresh installs (stock default). */
export const STOCK_DEFAULT_HIDDEN: ReadonlySet<string> = new Set([
  STOCK_KEY_SEARCH_THREADS,
]);

export function stockKeyFor(
  item: ExperimentalSidebarNavigationItem,
): string {
  switch (item.action.kind) {
    case "new-thread":
      return STOCK_KEY_NEW_THREAD;
    case "search-threads":
      return STOCK_KEY_SEARCH_THREADS;
    case "open-extensions":
      return STOCK_KEY_EXTENSIONS;
    case "open-skills":
      return STOCK_KEY_SKILLS;
    case "open-plugin-panel":
      return item.action.pluginId === "automations"
        ? STOCK_KEY_AUTOMATIONS
        : `${item.action.pluginId}/${item.action.panelId}`;
    default:
      // New host actions already carry their canonical arrangement key.
      return item.id;
  }
}

/** Stock migration: insert Skills right after Plugins when missing. */
export function migratePreferences(
  order: readonly string[],
  visible: readonly string[] | null,
): { order: string[]; visibleKeys: string[] | null } {
  const nextOrder = [...order];
  const nextVisible = visible === null ? null : [...visible];
  const at = nextOrder.indexOf(STOCK_KEY_EXTENSIONS);
  if (at !== -1 && !nextOrder.includes(STOCK_KEY_SKILLS)) {
    nextOrder.splice(at + 1, 0, STOCK_KEY_SKILLS);
    if (
      nextVisible &&
      nextVisible.includes(STOCK_KEY_EXTENSIONS) &&
      !nextVisible.includes(STOCK_KEY_SKILLS)
    ) {
      nextVisible.splice(
        nextVisible.indexOf(STOCK_KEY_EXTENSIONS) + 1,
        0,
        STOCK_KEY_SKILLS,
      );
    }
  }
  return { order: nextOrder, visibleKeys: nextVisible };
}

export interface NavPlacement {
  /** Every current row in stock order. */
  ordered: ExperimentalSidebarNavigationItem[];
  /** The rows the user set visible, in stock order. */
  visible: ExperimentalSidebarNavigationItem[];
  /** Visible rows as keys, in stock order. */
  visibleKeys: string[];
  /** Stored order normalized with current rows (for writes). */
  normalizedOrder: string[];
  /** Deduped stored visible keys, or null when never customized. */
  normalizedVisibleKeys: string[] | null;
}

/** Stock order + visibility merge over the current rows. */
export function computePlacement(
  items: readonly ExperimentalSidebarNavigationItem[],
  storedOrder: readonly string[],
  storedVisible: readonly string[] | null,
): NavPlacement {
  const migrated = migratePreferences(storedOrder, storedVisible);
  const byKey = new Map(items.map((item) => [stockKeyFor(item), item]));
  const currentKeys = items.map(stockKeyFor);

  // Leading keys the stored order never saw go first (stock behavior).
  const orderInput = [
    ...LEADING_KEYS.filter((key) => !migrated.order.includes(key)),
    ...migrated.order,
  ];
  const seen = new Set<string>();
  const ordered: ExperimentalSidebarNavigationItem[] = [];
  const normalizedOrder: string[] = [];
  for (const key of orderInput) {
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedOrder.push(key);
    const item = byKey.get(key);
    if (item) ordered.push(item);
  }
  for (const item of items) {
    const key = stockKeyFor(item);
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedOrder.push(key);
    ordered.push(item);
  }

  // New rows the stored order never saw default to visible (unless
  // default-hidden), prepended to the stored visible keys.
  const fresh = currentKeys.filter(
    (key) =>
      !migrated.order.includes(key) && !STOCK_DEFAULT_HIDDEN.has(key),
  );
  const visibleInput =
    migrated.visibleKeys === null || fresh.length === 0
      ? migrated.visibleKeys
      : [...fresh, ...migrated.visibleKeys];
  const normalized =
    visibleInput === null
      ? null
      : [...new Set(visibleInput.filter((key) => key.length > 0))];
  const effective =
    normalized ??
    ordered
      .map(stockKeyFor)
      .filter((key) => !STOCK_DEFAULT_HIDDEN.has(key));
  const visibleSet = new Set(effective);
  return {
    ordered,
    visible: ordered.filter((item) => visibleSet.has(stockKeyFor(item))),
    visibleKeys: ordered
      .map(stockKeyFor)
      .filter((key) => visibleSet.has(key)),
    normalizedOrder,
    normalizedVisibleKeys: normalized,
  };
}

/** Stock visibility toggle over visible keys. */
export function toggleVisibleKey(
  currentVisibleKeys: readonly string[],
  key: string,
  show: boolean,
): string[] {
  const clean = [...new Set(currentVisibleKeys.filter((entry) => entry.length > 0))];
  if (show) {
    return clean.includes(key) ? clean : [...clean, key];
  }
  return clean.filter((entry) => entry !== key);
}

export function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}
