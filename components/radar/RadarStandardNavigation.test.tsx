import { createElement } from "react";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ExperimentalSidebarNavigationItem } from "@get-bb/plugin-sdk/app";

const host = vi.hoisted(() => ({ items: null as ExperimentalSidebarNavigationItem[] | null }));
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  return {
    ...actual,
    experimental_useSidebarNavigation: () => {
      const state = actual.experimental_useSidebarNavigation();
      return host.items ? { ...state, items: host.items } : state;
    },
  };
});

const app = await loadPluginApp(() => import("../../app"));
const navigation = app.experimentalSidebarNavigations[0]!;
const props = { isCompactViewport: false, experimental_Original: () => null };
function destination(id: string, label: string, isVisible = true): ExperimentalSidebarNavigationItem {
  return {
    id: `alpha/${id}`, label, action: { kind: "open-plugin-panel", pluginId: "alpha", panelId: id },
    icon: { kind: "plugin", pluginId: "alpha", icon: "Zap" }, isDisabled: false,
    isVisible, isLoading: false, pluginId: "alpha", shortcut: null, experimental_Accessory: null,
  };
}
function mount(items: ExperimentalSidebarNavigationItem[], isCompactViewport = false) {
  return renderSlot(navigation, { ...props, isCompactViewport }, { sidebarNavigation: { items } });
}
afterEach(() => { cleanup(); host.items = null; });

describe("host navigation arrangement", () => {
  it.each([false, true])("renders host order and visibility immediately (compact=%s)", (compact) => {
    const slot = mount([destination("notes", "Notes"), destination("hidden", "Hidden", false), destination("board", "Board")], compact);
    const primary = screen.getByRole("navigation", { name: "Primary" });
    expect(within(primary).getAllByRole("button").map((button) => button.getAttribute("aria-label")))
      .toEqual(["Notes", "Board", "More navigation, 1 items"]);
    expect(screen.queryByRole("button", { name: "Hidden" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More navigation, 1 items" }));
    expect(screen.getByRole("button", { name: "Hidden" })).toBeTruthy();
    expect(slot.inspection.sdkCalls).toEqual([]);
  });

  it("applies host visibility and order updates without a preference fetch or window focus", () => {
    const board = destination("board", "Board");
    const notes = destination("notes", "Notes");
    const slot = mount([board, notes]);
    host.items = [notes, { ...board, isVisible: false }];
    slot.rerender(createElement(navigation.component, props));
    expect(screen.queryByRole("button", { name: "Board" })).toBeNull();
    expect(screen.getByRole("button", { name: "More navigation, 1 items" })).toBeTruthy();
    host.items = [notes, board];
    slot.rerender(createElement(navigation.component, props));
    expect(within(screen.getByRole("navigation")).getAllByRole("button").map((button) => button.getAttribute("aria-label")))
      .toEqual(["Notes", "Board"]);
    fireEvent.focus(window);
    expect(slot.inspection.sdkCalls).toEqual([]);
  });

  it("delegates Move to More and Keep in sidebar to host actions without rewriting order", () => {
    const board = destination("board", "Board");
    const slot = mount([board]);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Board" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to More" }));
    expect(slot.inspection.sidebarNavigationCalls).toEqual([{ method: "setVisible", itemId: board.id, isVisible: false }]);
    // The host publishes the save result. Radar keeps no competing snapshot.
    host.items = [{ ...board, isVisible: false }];
    slot.rerender(createElement(navigation.component, props));
    fireEvent.click(screen.getByRole("button", { name: "More navigation, 1 items" }));
    fireEvent.contextMenu(screen.getByRole("button", { name: "Board" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Keep in sidebar" }));
    expect(slot.inspection.sidebarNavigationCalls).toContainEqual({ method: "setVisible", itemId: board.id, isVisible: true });
    expect(slot.inspection.sdkCalls).toEqual([]);
  });

  it("preserves split activation from inline and overflow destinations", () => {
    const board = destination("board", "Board");
    const notes = destination("notes", "Notes", false);
    const slot = mount([board, notes]);
    fireEvent.click(screen.getByRole("button", { name: "Board" }), { altKey: true });
    fireEvent.click(screen.getByRole("button", { name: "More navigation, 1 items" }));
    fireEvent.contextMenu(screen.getByRole("button", { name: "Notes" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in split" }));
    expect(slot.inspection.sidebarNavigationCalls).toEqual([
      { method: "activate", itemId: board.id, openInSplit: true },
      { method: "activate", itemId: notes.id, openInSplit: true },
    ]);
  });
});
