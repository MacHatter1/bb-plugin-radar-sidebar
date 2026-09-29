import { describe, expect, it } from "vitest";
import type { ExperimentalSidebarNavigationItem } from "@get-bb/plugin-sdk/app";
import {
  STOCK_KEY_EXTENSIONS,
  STOCK_KEY_NEW_THREAD,
  STOCK_KEY_SEARCH_THREADS,
  STOCK_KEY_SKILLS,
  computePlacement,
  migratePreferences,
  stockKeyFor,
  toggleVisibleKey,
} from "./navVisibility";

function item(
  overrides: Partial<ExperimentalSidebarNavigationItem> & {
    id: string;
    action: ExperimentalSidebarNavigationItem["action"];
  },
): ExperimentalSidebarNavigationItem {
  return {
    label: overrides.id,
    icon:
      overrides.action.kind === "open-plugin-panel"
        ? { kind: "plugin", pluginId: overrides.action.pluginId, icon: "Zap" }
        : { kind: "host", name: "extensions" },
    isDisabled: false,
    shortcut: null,
    experimental_splitProps: {},
    ...overrides,
  } as ExperimentalSidebarNavigationItem;
}

// Stock hands back these exact ids for its built-in rows, and the key
// scheme derives from them, so the fixtures must use the real names.
const newThread = item({ id: "new-thread", action: { kind: "new-thread" } });
const search = item({ id: "search-threads", action: { kind: "search-threads" } });
const extensions = item({
  id: "extensions",
  action: { kind: "open-extensions" },
});
const skills = item({ id: "skills", action: { kind: "open-extensions" } });
const panelA = item({
  id: "pa",
  action: { kind: "open-plugin-panel", pluginId: "alpha", panelId: "board" },
});
const panelB = item({
  id: "pb",
  action: { kind: "open-plugin-panel", pluginId: "beta", panelId: "notes" },
});
const all = [newThread, search, extensions, skills, panelA, panelB];

describe("stockKeyFor", () => {
  it("names built-ins under the __bb__ owner", () => {
    expect(stockKeyFor(newThread)).toBe(STOCK_KEY_NEW_THREAD);
    expect(stockKeyFor(search)).toBe(STOCK_KEY_SEARCH_THREADS);
    expect(stockKeyFor(extensions)).toBe(STOCK_KEY_EXTENSIONS);
    expect(stockKeyFor(skills)).toBe(STOCK_KEY_SKILLS);
  });

  it("names plugin panels as pluginId/panelId", () => {
    expect(stockKeyFor(panelA)).toBe("alpha/board");
  });

  it("special-cases the automations panel like stock does", () => {
    const automations = item({
      id: "au",
      action: { kind: "open-plugin-panel", pluginId: "automations", panelId: "runs" },
    });
    expect(stockKeyFor(automations)).toBe("__bb__/automations");
  });
});

describe("migratePreferences", () => {
  it("inserts Skills right after Plugins when the store predates it", () => {
    const migrated = migratePreferences(
      [STOCK_KEY_NEW_THREAD, STOCK_KEY_EXTENSIONS],
      [STOCK_KEY_NEW_THREAD, STOCK_KEY_EXTENSIONS],
    );
    expect(migrated.order).toEqual([
      STOCK_KEY_NEW_THREAD,
      STOCK_KEY_EXTENSIONS,
      STOCK_KEY_SKILLS,
    ]);
    expect(migrated.visibleKeys).toEqual([
      STOCK_KEY_NEW_THREAD,
      STOCK_KEY_EXTENSIONS,
      STOCK_KEY_SKILLS,
    ]);
  });

  it("leaves an already-migrated store untouched", () => {
    const order = [STOCK_KEY_EXTENSIONS, STOCK_KEY_SKILLS];
    expect(migratePreferences(order, null).order).toEqual(order);
  });
});

describe("computePlacement", () => {
  it("hides only Search for a fresh, never-customised store", () => {
    const { visibleKeys } = computePlacement(all, [], null);
    expect(visibleKeys).toEqual([
      STOCK_KEY_NEW_THREAD,
      STOCK_KEY_EXTENSIONS,
      STOCK_KEY_SKILLS,
      "alpha/board",
      "beta/notes",
    ]);
    expect(visibleKeys).not.toContain(STOCK_KEY_SEARCH_THREADS);
  });

  it("honours a stored order the user set in stock's own UI", () => {
    // Stock also promotes rows the stored order never saw: leading keys go
    // first, and unseen non-default-hidden rows join the visible set. So
    // new-thread and skills surface alongside the user's own ordering.
    const storedOrder = ["beta/notes", STOCK_KEY_EXTENSIONS, "alpha/board"];
    const storedVisible = ["beta/notes", STOCK_KEY_EXTENSIONS];
    const { visible } = computePlacement(all, storedOrder, storedVisible);
    expect(visible.map(stockKeyFor)).toEqual([
      STOCK_KEY_NEW_THREAD,
      "beta/notes",
      STOCK_KEY_EXTENSIONS,
      STOCK_KEY_SKILLS,
    ]);
    // The user's relative ordering of the two panels they did set survives.
    const { ordered } = computePlacement(all, storedOrder, storedVisible);
    const keys = ordered.map(stockKeyFor);
    expect(keys.indexOf("beta/notes")).toBeLessThan(
      keys.indexOf("alpha/board"),
    );
  });

  it("keeps leading built-ins first even when stored order omits them", () => {
    const { ordered } = computePlacement(all, ["beta/notes"], null);
    expect(stockKeyFor(ordered[0])).toBe(STOCK_KEY_NEW_THREAD);
  });

  it("surfaces a newly installed panel inline instead of burying it in More", () => {
    // Stored order was written before panelB existed.
    const storedOrder = [STOCK_KEY_NEW_THREAD, "alpha/board"];
    const storedVisible = [STOCK_KEY_NEW_THREAD, "alpha/board"];
    const { visibleKeys } = computePlacement(all, storedOrder, storedVisible);
    expect(visibleKeys).toContain("beta/notes");
  });

  it("drops rows that no longer exist without corrupting the rest", () => {
    const storedOrder = [STOCK_KEY_NEW_THREAD, "ghost/panel", "alpha/board"];
    const { ordered } = computePlacement(all, storedOrder, null);
    expect(ordered.map(stockKeyFor)).not.toContain("ghost/panel");
    expect(ordered.map(stockKeyFor)).toContain("alpha/board");
  });
});

describe("toggleVisibleKey", () => {
  it("adds a hidden row and stays idempotent", () => {
    const base = [STOCK_KEY_NEW_THREAD];
    const shown = toggleVisibleKey(base, "alpha/board", true);
    expect(shown).toEqual([STOCK_KEY_NEW_THREAD, "alpha/board"]);
    expect(toggleVisibleKey(shown, "alpha/board", true)).toEqual(shown);
  });

  it("removes a visible row", () => {
    expect(
      toggleVisibleKey([STOCK_KEY_NEW_THREAD, "alpha/board"], "alpha/board", false),
    ).toEqual([STOCK_KEY_NEW_THREAD]);
  });
});

describe("groupGlyph", () => {
  it("gives every grouping mode a distinct, correct icon", async () => {
    const { groupGlyph } = await import("./RadarGroupHeader");
    // Regression: the sortable path rendered a folder for the Pinned group,
    // and time/section groups rendered no icon at all.
    expect(groupGlyph({ id: "pinned", icon: "Pin", projectId: null }, true)).toBe(
      "Pin",
    );
    expect(
      groupGlyph({ id: "pinned", icon: "Pin", projectId: null }, false),
    ).toBe("Pin");
    expect(
      groupGlyph({ id: "project:x", icon: "Folder", projectId: "x" }, true),
    ).toBe("Folder");
    expect(
      groupGlyph({ id: "project:x", icon: "Folder", projectId: "x" }, false),
    ).toBe("FolderOpen");
    expect(
      groupGlyph({ id: "time:today", icon: "Clock", projectId: null }, false),
    ).toBe("Clock");
    expect(
      groupGlyph(
        { id: "section:s1", icon: "SectionMove", projectId: null },
        false,
      ),
    ).toBe("SectionMove");
  });
});
