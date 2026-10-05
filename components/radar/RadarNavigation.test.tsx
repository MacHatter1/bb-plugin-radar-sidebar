import { createElement } from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import * as pluginSdk from "@get-bb/plugin-sdk/app";
import { railHostCss } from "./railHostStyles";
import type { ExperimentalSidebarNavigationItem, ExperimentalSidebarNavigationProps, PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";
import { DAY, makeProject, makeThread, NOW } from "./fixtures";
import { resetRailScope, setRailScope, useRailScope } from "./railScope";
import { seedSettings } from "./settingsStore";

const host = vi.hoisted(() => ({
  items: null as ExperimentalSidebarNavigationItem[] | null,
  sidebarThreads: null as Partial<PluginSidebarThreadsState> | null,
}));
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  return {
    ...actual,
    experimental_useSidebarThreads: (...args: Parameters<typeof actual.experimental_useSidebarThreads>) => ({
      ...actual.experimental_useSidebarThreads(...args),
      ...host.sidebarThreads,
    }),
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
/** The rail's host <style> elements still in the document (the harness adds its own). */
function railHostStyles(): HTMLStyleElement[] {
  return Array.from(document.querySelectorAll("style")).filter((style) => style.textContent?.includes('[data-sidebar="sidebar"]'));
}
function mount(items: ExperimentalSidebarNavigationItem[], isCompactViewport = false) {
  return renderSlot(navigation, { ...props, isCompactViewport }, { sidebarNavigation: { items } });
}
beforeEach(() => { seedSettings({ railNav: true }); });
afterEach(() => { cleanup(); host.items = null; host.sidebarThreads = null; resetRailScope(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("host navigation arrangement", () => {
  it.each([false, true])("renders host order and visibility immediately (compact=%s)", (compact) => {
    const slot = mount([destination("notes", "Notes"), destination("hidden", "Hidden", false), destination("board", "Board")], compact);
    const primary = screen.getByRole("navigation", { name: "Primary" });
    expect(within(primary).getAllByRole("button").map((button) => button.getAttribute("aria-label")))
      .toEqual(["Home", "Notes", "Board", "More navigation, 1 items", "Customize sidebar"]);
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
      .toEqual(["Home", "Notes", "Board", "Customize sidebar"]);
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

  it("keeps search available and delegates the rail customize button to BB", () => {
    const search: ExperimentalSidebarNavigationItem = {
      ...destination("search", "Search threads"),
      id: "__bb__/search-threads",
      action: { kind: "search-threads" },
      pluginId: null,
    };
    const slot = mount([search]);
    fireEvent.click(screen.getByRole("button", { name: "Search threads" }));
    fireEvent.click(screen.getByRole("button", { name: "Customize sidebar" }));
    expect(slot.inspection.sidebarNavigationCalls).toEqual([
      { method: "activate", itemId: search.id, openInSplit: false },
      { method: "openCustomize" },
    ]);
    // Settings comes from BB's existing footer, which this slot doesn't own.
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("keeps the rail on compact viewports, marked compact, without tooltips", () => {
    const slot = mount([destination("board", "Board")]);
    expect(document.querySelector(".radar-double-navigation-compact")).toBeNull();
    slot.rerender(createElement(navigation.component, { ...props, isCompactViewport: true }));
    expect(document.querySelector(".radar-double-navigation.radar-double-navigation-compact")).toBeTruthy();
    expect(document.querySelector(".radar-double-rail")).toBeTruthy();
    const board = screen.getByRole("button", { name: "Board" });
    fireEvent.focus(board);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(board.getAttribute("title")).toBe("Board");
    expect(screen.getByRole("button", { name: "Customize sidebar" })).toBeTruthy();
  });

  it("runs the rail full height beside BB's footer bar", () => {
    const wrapped = {
      ...navigation,
      component: (p: ExperimentalSidebarNavigationProps) => createElement(
        "div", { "data-sidebar": "sidebar" },
        createElement(navigation.component, p),
        createElement("div", { "data-sidebar": "footer" }),
      ),
    };
    const slot = renderSlot(wrapped, props, { sidebarNavigation: { items: [destination("board", "Board")] } });
    // No inline bottom: the rail's CSS runs it the full sidebar height,
    // and BB's footer keeps its default bar under the thread list.
    expect((document.querySelector(".radar-double-rail") as HTMLElement).style.bottom).toBe("");
    slot.lifecycle.unmount();
  });

  it("tracks the rail's scroll position and releases cues and listeners on unmount", () => {
    let overflowing = true;
    const callbacks: Array<() => void> = [];
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { callbacks.push(callback); }
      observe() {}
      disconnect() {}
    });
    const isStack = (element: HTMLElement) => element.classList.contains("radar-double-rail-items");
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return isStack(this) ? 100 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return isStack(this) ? (overflowing ? 200 : 100) : 0;
    });
    const slot = mount([destination("board", "Board")]);
    const nav = document.querySelector(".radar-double-navigation")!;
    const rail = document.querySelector<HTMLElement>(".radar-double-rail")!;
    const stack = document.querySelector<HTMLElement>(".radar-double-rail-items")!;
    expect(nav.hasAttribute("data-rail-overflow")).toBe(true);
    expect(rail.style.getPropertyValue("--radar-scroll-height")).toBe("50px");
    expect(rail.style.getPropertyValue("--radar-scroll-top")).toBe("0px");
    // A burst of scroll events waits for one frame instead of reading
    // layout per event.
    stack.scrollTop = 100;
    fireEvent.scroll(stack);
    fireEvent.scroll(stack);
    expect(rail.style.getPropertyValue("--radar-scroll-top")).toBe("0px");
    expect(frames).toHaveLength(1);
    frames.splice(0).forEach((frame) => frame(0));
    expect(rail.style.getPropertyValue("--radar-scroll-top")).toBe("50px");
    overflowing = false;
    act(() => callbacks.forEach((callback) => callback()));
    expect(nav.hasAttribute("data-rail-overflow")).toBe(false);
    expect(rail.style.getPropertyValue("--radar-scroll-height")).toBe("");
    slot.lifecycle.unmount();
    fireEvent.scroll(stack);
    expect(frames).toHaveLength(0);
    expect(railHostStyles()).toEqual([]);
  });

  it.each([false, true])("releases the rail when BB hides the app body for Settings and restores it on return (compact=%s)", async (compact) => {
    const wrapped = {
      ...navigation,
      component: (p: ExperimentalSidebarNavigationProps) => createElement(
        "div", { "data-sidebar": "sidebar" },
        createElement("div", { "data-testid": "app-sidebar-body" },
          createElement(navigation.component, p)),
        createElement("div", { "data-sidebar": "footer" }),
      ),
    };
    const slot = renderSlot(wrapped, { ...props, isCompactViewport: compact }, {
      sidebarNavigation: { items: [destination("board", "Board")] },
    });
    const body = document.querySelector<HTMLElement>('[data-testid="app-sidebar-body"]')!;
    expect(document.querySelector(".radar-double-navigation")).toBeTruthy();
    body.hidden = true;
    await waitFor(() => expect(document.querySelector(".radar-double-navigation")).toBeNull());
    // The rail's host styles go with it.
    expect(document.querySelector('[data-sidebar="sidebar"] style')).toBeNull();
    body.hidden = false;
    await waitFor(() => expect(screen.getByRole("button", { name: "Board" })).toBeTruthy());
    // The host's inner Customize wrapper is a separate visibility boundary.
    const root = body.firstElementChild as HTMLElement;
    root.hidden = true;
    await Promise.resolve();
    expect(document.querySelector(".radar-double-navigation")).toBeTruthy();
    root.hidden = false;
    slot.lifecycle.unmount();
    body.hidden = true;
    await Promise.resolve();
    expect(document.documentElement.style.getPropertyValue("--radar-rail-reserve")).toBe("");
  });

  it.each([{ ctrlKey: true }, { metaKey: true }])("supports host split modifiers %s", (modifiers) => {
    const board = destination("board", "Board");
    const slot = mount([board]);
    fireEvent.click(screen.getByRole("button", { name: "Board" }), modifiers);
    expect(slot.inspection.sidebarNavigationCalls).toEqual([
      { method: "activate", itemId: board.id, openInSplit: true },
    ]);
  });
});

describe("rail ergonomics", () => {
  it("steps focus through the rail with arrow keys and wraps at the ends", () => {
    mount([destination("notes", "Notes"), destination("board", "Board")]);
    const notes = screen.getByRole("button", { name: "Notes" });
    const board = screen.getByRole("button", { name: "Board" });
    const customize = screen.getByRole("button", { name: "Customize sidebar" });
    notes.focus();
    fireEvent.keyDown(notes, { key: "ArrowDown" });
    expect(document.activeElement).toBe(board);
    fireEvent.keyDown(board, { key: "End" });
    expect(document.activeElement).toBe(customize);
    fireEvent.keyDown(customize, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Home" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Home" }), { key: "ArrowUp" });
    expect(document.activeElement).toBe(customize);
  });

  it("shows a tooltip with the label, shortcut and accessory on focus", () => {
    const Accessory = () => createElement("span", null, "3 new");
    const notes = { ...destination("notes", "Notes"), shortcut: { label: "⌘1", ariaKeyShortcuts: "Meta+1" }, experimental_Accessory: Accessory };
    mount([notes]);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(screen.getByRole("button", { name: "Notes (⌘1)" }));
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("Notes");
    expect(tip.textContent).toContain("⌘1");
    expect(tip.textContent).toContain("3 new");
    fireEvent.blur(screen.getByRole("button", { name: "Notes (⌘1)" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not draw tooltips on compact viewports", () => {
    mount([destination("notes", "Notes")], true);
    fireEvent.focus(screen.getByRole("button", { name: "Notes" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getByRole("button", { name: "Notes" }).getAttribute("title")).toBe("Notes");
  });

  it.each([false, true])("focuses the first enabled More item for immediate keyboard traversal (rail=%s)", (rail) => {
    seedSettings({ railNav: rail });
    mount([
      { ...destination("disabled", "Disabled", false), isDisabled: true },
      destination("notes", "Notes", false),
      { ...destination("loading", "Loading", false), isLoading: true },
      destination("board", "Board", false),
    ]);
    const more = screen.getByRole("button", { name: "More navigation, 4 items" });
    act(() => more.focus());
    fireEvent.click(more);
    const notes = screen.getByRole("button", { name: "Notes" });
    const board = screen.getByRole("button", { name: "Board" });
    expect(document.activeElement).toBe(notes);
    fireEvent.keyDown(notes, { key: "ArrowDown" });
    expect(document.activeElement).toBe(board);
    fireEvent.keyDown(board, { key: "Home" });
    expect(document.activeElement).toBe(notes);
    fireEvent.keyDown(notes, { key: "ArrowUp" });
    expect(document.activeElement).toBe(board);
    fireEvent.keyDown(board, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "More navigation" })).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it("clears an open desktop tooltip when entering compact mode without restoring it later", () => {
    const slot = mount([destination("notes", "Notes")]);
    fireEvent.focus(screen.getByRole("button", { name: "Notes" }));
    expect(screen.getByRole("tooltip")).toBeTruthy();
    slot.rerender(createElement(navigation.component, { ...props, isCompactViewport: true }));
    expect(screen.queryByRole("tooltip")).toBeNull();
    slot.rerender(createElement(navigation.component, props));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("cancels pending desktop tooltips when entering compact mode", () => {
    vi.useFakeTimers();
    const slot = mount([destination("notes", "Notes")]);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Notes" }));
    slot.rerender(createElement(navigation.component, { ...props, isCompactViewport: true }));
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByRole("tooltip")).toBeNull();
    slot.rerender(createElement(navigation.component, props));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("reorders within the visible bucket through host setOrder", () => {
    const notes = destination("notes", "Notes");
    const hidden = destination("hidden", "Hidden", false);
    const board = destination("board", "Board");
    const slot = mount([notes, hidden, board]);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Board" }));
    expect((screen.getByRole("menuitem", { name: "Move down" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move up" }));
    expect(slot.inspection.sidebarNavigationCalls).toEqual([
      { method: "setOrder", itemIds: [board.id, notes.id, hidden.id] },
    ]);
  });

  it("opens plugin details from the context menu", () => {
    const board = destination("board", "Board");
    const slot = mount([board]);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Board" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Plugin details" }));
    expect(slot.inspection.sidebarNavigationCalls).toEqual([{ method: "openDetails", itemId: board.id }]);
  });
});

describe("wide rail", () => {
  function newThread(): ExperimentalSidebarNavigationItem {
    return { ...destination("new", "New thread"), id: "__bb__/new-thread", action: { kind: "new-thread" }, pluginId: null };
  }

  // Wide mode needs the setting on and BB's sidebar structure around the slot.
  function hostShell(p: ExperimentalSidebarNavigationProps) {
    return createElement(
      "div", { className: "group peer" },
      createElement(
        "div", { style: { "--sidebar-width": "320px" } as React.CSSProperties },
        createElement("div", { "data-sidebar": "sidebar" }, createElement(navigation.component, p), createElement("div", { "data-sidebar": "footer" })),
      ),
    );
  }
  function mountWide(items: ExperimentalSidebarNavigationItem[], settings: Record<string, boolean> = { wideRail: true }) {
    return renderSlot({ ...navigation, component: hostShell }, props, { sidebarNavigation: { items }, settings });
  }

  it("hides the toggle unless the setting is on and the host shell is recognised", () => {
    mount([newThread()]);
    expect(screen.queryByRole("button", { name: "Show labels" })).toBeNull();
    cleanup();
    mountWide([newThread()], { wideRail: false });
    expect(screen.queryByRole("button", { name: "Show labels" })).toBeNull();
    cleanup();
    renderSlot(navigation, props, { sidebarNavigation: { items: [newThread()] }, settings: { wideRail: true } });
    expect(screen.queryByRole("button", { name: "Show labels" })).toBeNull();
  });

  it("toggles wide mode, labels the rail and remembers the choice", () => {
    mountWide([newThread(), destination("board", "Board")]);
    expect(document.querySelector(".radar-double-navigation-wide")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show labels" }));
    expect(document.querySelector(".radar-double-navigation-wide")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Board" }).querySelector(".radar-rail-label")?.textContent).toBe("Board");
    expect(localStorage.getItem("radar-sidebar:rail-wide:v1")).toBe("1");
    cleanup();
    mountWide([newThread()]);
    expect(document.querySelector(".radar-double-navigation-wide")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide labels" }));
    expect(document.querySelector(".radar-double-navigation-wide")).toBeNull();
  });
});

describe("project scope tiles", () => {
  const projects = [makeProject({ id: "proj_a", name: "bb-appimage" }), makeProject({ id: "proj_b", name: "ERBareeq" }), makeProject({ id: "proj_c", name: "Quiet" })];
  const threads = [
    makeThread({ id: "t1", projectId: "proj_a", updatedAt: NOW - 1000, hasPendingInteraction: true, indicator: "waiting-for-input" }),
    makeThread({ id: "t2", projectId: "proj_b", updatedAt: NOW }),
    makeThread({ id: "t3", projectId: "proj_b", updatedAt: NOW - 5000, isArchived: true }),
  ];
  function Scope() { return createElement("span", { "data-testid": "scope" }, useRailScope() ?? "none"); }
  /** The tile's monogram and name, without its badges. */
  const tileLabel = (tile: HTMLElement) => `${tile.querySelector(".radar-rail-monogram")?.textContent}${tile.querySelector(".radar-rail-label")?.textContent}`;
  function mountWithThreads(isCompactViewport = false) {
    const wrapped = { ...navigation, component: (p: ExperimentalSidebarNavigationProps) => createElement("div", null, createElement(navigation.component, p), createElement(Scope)) };
    const newThread: ExperimentalSidebarNavigationItem = { ...destination("new", "New thread"), id: "__bb__/new-thread", action: { kind: "new-thread" }, pluginId: null };
    return renderSlot(wrapped, { ...props, isCompactViewport }, { sidebarNavigation: { items: [newThread, destination("board", "Board")] }, sidebarThreads: { threads, projects } });
  }

  it("orders project tiles by activity rather than recent reads", () => {
    host.sidebarThreads = {
      status: "ready", projects,
      threads: [
        makeThread({ id: "quiet", projectId: "proj_a", updatedAt: NOW, lastReadAt: NOW, latestAttentionAt: NOW - 7 * DAY }),
        makeThread({ id: "recent", projectId: "proj_b", updatedAt: NOW - DAY, latestAttentionAt: NOW - DAY }),
      ],
    };
    mount([]);
    const tiles = within(screen.getByRole("group", { name: "Projects" })).getAllByRole("button");
    expect(tiles.map(tile => tile.getAttribute("aria-label"))).toEqual([
      "ERBareeq: show only this project", "bb-appimage: show only this project",
    ]);
  });

  it("sorts live projects ahead of idle projects with newer updated timestamps", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    host.sidebarThreads = {
      status: "ready", projects,
      threads: [
        makeThread({ id: "running", projectId: "proj_a", status: "active", updatedAt: NOW - 7 * DAY, latestAttentionAt: NOW - 7 * DAY }),
        makeThread({ id: "read", projectId: "proj_b", updatedAt: NOW, latestAttentionAt: NOW - DAY }),
      ],
    };
    mount([]);
    const tiles = within(screen.getByRole("group", { name: "Projects" })).getAllByRole("button");
    expect(tiles.map(tile => tile.getAttribute("aria-label"))).toEqual([
      "bb-appimage: show only this project", "ERBareeq: show only this project",
    ]);
  });

  it("lists projects with visible threads, most recent first, and scopes on click", () => {
    mountWithThreads();
    const group = screen.getByRole("group", { name: "Projects" });
    const tiles = within(group).getAllByRole("button");
    expect(tiles.map(tileLabel)).toEqual(["BAbb-appimage", "ERERBareeq"]);
    expect(screen.queryByText("Quiet")).toBeNull();
    fireEvent.click(tiles[0]!);
    expect(screen.getByTestId("scope").textContent).toBe("proj_a");
    expect(tiles[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("radar-sidebar:rail-scope:v1")).toBe("proj_a");
    // The heading names the project and clears the scope.
    fireEvent.click(screen.getByRole("button", { name: "Showing bb-appimage only. Show every project" }));
    expect(screen.getByTestId("scope").textContent).toBe("none");
    expect(screen.getByText("Threads")).toBeTruthy();
  });

  it("clears the scope when Home is activated", () => {
    const slot = mountWithThreads();
    fireEvent.click(screen.getByRole("button", { name: "bb-appimage: show only this project" }));
    expect(screen.getByTestId("scope").textContent).toBe("proj_a");
    const home = screen.getByRole("button", { name: "Home" });
    fireEvent.click(home);
    expect(screen.getByTestId("scope").textContent).toBe("none");
    expect(slot.inspection.sidebarNavigationCalls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "bb-appimage: show only this project" }));
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    expect(screen.getByTestId("scope").textContent).toBe("proj_a");
    expect(slot.inspection.sidebarNavigationCalls).toEqual([]);
  });

  it("starts the new thread in the scoped project", () => {
    const slot = mountWithThreads();
    fireEvent.click(screen.getByRole("button", { name: "bb-appimage: show only this project" }));
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    expect(slot.inspection.sidebarActionCalls).toEqual([{ method: "openNewThread", options: { projectId: "proj_a", focusPrompt: true } }]);
    expect(slot.inspection.sidebarNavigationCalls).toEqual([]);
  });

  it("uses the host's new thread when no project is scoped", () => {
    const slot = mountWithThreads();
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    expect(slot.inspection.sidebarNavigationCalls).toEqual([{ method: "activate", itemId: "__bb__/new-thread", openInSplit: false }]);
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
  });

  it("keeps the host's split behaviour for a modified click while scoped", () => {
    const slot = mountWithThreads();
    fireEvent.click(screen.getByRole("button", { name: "bb-appimage: show only this project" }));
    fireEvent.click(screen.getByRole("button", { name: "New thread" }), { altKey: true });
    expect(slot.inspection.sidebarNavigationCalls).toEqual([{ method: "activate", itemId: "__bb__/new-thread", openInSplit: true }]);
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
  });

  it("explains the tally in the tile tooltip and marks waiting projects", () => {
    mountWithThreads();
    const tile = screen.getByRole("button", { name: "bb-appimage: show only this project" });
    expect(tile.querySelector(".radar-rail-badge-waiting")).toBeTruthy();
    fireEvent.focus(tile);
    expect(screen.getByRole("tooltip").textContent).toContain("1 thread · 1 waiting");
  });

  it("keeps the project tiles on compact viewports", () => {
    mountWithThreads(true);
    const group = screen.getByRole("group", { name: "Projects" });
    const tiles = within(group).getAllByRole("button");
    expect(tiles.map(tileLabel)).toEqual(["BAbb-appimage", "ERERBareeq"]);
    fireEvent.click(tiles[0]!);
    expect(screen.getByTestId("scope").textContent).toBe("proj_a");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it.each([
    makeThread({ id: "active", status: "active" }),
    makeThread({ id: "stopping", status: "stopping" }),
    makeThread({ id: "background", activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 1, planMode: 0, goals: 0 } }),
    makeThread({ id: "queued", queuedWork: "waiting", indicator: "queued-waiting" }),
    makeThread({ id: "blocked", hasPendingInteraction: true, indicator: "waiting-for-input" }),
  ])("counts $id work as live using the list's rules", (thread) => {
    host.sidebarThreads = { threads: [thread], projects, status: "ready" };
    mount([]);
    fireEvent.focus(screen.getByRole("button", { name: "bb-appimage: show only this project" }));
    expect(screen.getByRole("tooltip").textContent).toContain("1 live");
    if (thread.indicator === "queued-waiting" || thread.indicator === "waiting-for-input") {
      expect(screen.getByRole("tooltip").textContent).toContain("1 waiting");
    }
  });

  it.each(["loading", "error"] as const)("preserves scope through a %s snapshot, then clears a deleted project when ready", (status) => {
    setRailScope("deleted_project");
    host.sidebarThreads = { status, projects: [], threads: [] };
    const slot = mount([]);
    expect(localStorage.getItem("radar-sidebar:rail-scope:v1")).toBe("deleted_project");
    host.sidebarThreads = { status: "ready", projects: [], threads: [] };
    slot.rerender(createElement(navigation.component, props));
    expect(localStorage.getItem("radar-sidebar:rail-scope:v1")).toBeNull();
  });

  it("keeps a valid project heading when its last active thread is archived", () => {
    setRailScope("proj_a");
    host.sidebarThreads = { status: "ready", projects, threads: [] };
    mount([]);
    expect(screen.getByRole("button", { name: "Showing bb-appimage only. Show every project" })).toBeTruthy();
    expect(localStorage.getItem("radar-sidebar:rail-scope:v1")).toBe("proj_a");
  });
});


describe("railNav layout setting", () => {
  it.each([false, true])("keeps the published slot and normal navigation when off (compact=%s)", (compact) => {
    expect(navigation.id).toBe("radar");
    expect(app.experimentalSidebarNavigations).toHaveLength(1);
    seedSettings({ railNav: false });
    const newThread: ExperimentalSidebarNavigationItem = { ...destination("new", "New thread"), action: { kind: "new-thread" }, pluginId: null };
    const slot = mount([newThread, destination("notes", "Notes"), destination("hidden", "Hidden", false)], compact);
    expect(slot.container.querySelector(".radar-double-navigation")).toBeNull();
    expect(screen.queryByRole("button", { name: "Home" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Customize sidebar" })).toBeNull();
    expect(within(screen.getByRole("navigation")).getAllByRole("button").map(b => b.getAttribute("aria-label")))
      .toEqual(["New thread", "Notes", "More navigation, 1 items"]);
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    expect(slot.inspection.sidebarNavigationCalls).toEqual([{ method: "activate", itemId: newThread.id, openInSplit: false }]);
    expect(Boolean(slot.container.querySelector(".radar-nav-compact"))).toBe(compact);
  });

  it("releases tooltip timers, overlays and layout reservations when disabled, then restores the rail", () => {
    const slot = mount([destination("notes", "Notes"), destination("hidden", "Hidden", false)]);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Notes" }));
    fireEvent.click(screen.getByRole("button", { name: "More navigation, 1 items" }));
    expect(screen.getByRole("group", { name: "More navigation" })).toBeTruthy();
    seedSettings({ railNav: false });
    slot.rerender(createElement(navigation.component, props));
    expect(slot.container.querySelector(".radar-double-navigation")).toBeNull();
    expect(screen.queryByRole("group", { name: "More navigation" })).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--radar-rail-reserve")).toBe("");
    expect(railHostStyles()).toEqual([]);
    seedSettings({ railNav: true });
    slot.rerender(createElement(navigation.component, props));
    expect(screen.getByRole("button", { name: "Home" })).toBeTruthy();
    expect(railHostStyles().map((style) => style.textContent)).toEqual([railHostCss({ wide: false, compact: false, scoped: false })]);
    expect(screen.queryByRole("group", { name: "More navigation" })).toBeNull();
  });

  it("ignores a saved wide choice and wideRail when railNav is off", () => {
    seedSettings({ railNav: false });
    localStorage.setItem("radar-sidebar:rail-wide:v1", "1");
    renderSlot(navigation, props, { sidebarNavigation: { items: [destination("notes", "Notes")] }, settings: { wideRail: true } });
    expect(document.querySelector(".radar-double-navigation-wide")).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide labels" })).toBeNull();
  });
});

describe("host styles", () => {
  // The rail restyles BB's sidebar from <style> elements in its own markup.
  // It never writes to BB's elements: :has() on body or the sidebar made the
  // browser restyle the page on every DOM change, and attributes on BB's
  // elements edited host DOM.
  function shell(p: ExperimentalSidebarNavigationProps) {
    return createElement(
      "div", { className: "group peer", "data-state": "expanded" },
      createElement(
        "div", { style: { "--sidebar-width": "320px" } as React.CSSProperties },
        createElement("div", { "data-sidebar": "sidebar" }, createElement(navigation.component, p), createElement("div", { "data-sidebar": "footer" })),
      ),
    );
  }
  const hostSheet = () => document.querySelector<HTMLStyleElement>(".radar-double-navigation > style")?.textContent ?? null;

  it("follows the rail's state without ever writing to BB's elements, and releases on unmount", () => {
    host.sidebarThreads = { status: "ready", projects: [makeProject({ id: "proj_a", name: "Alpha" })], threads: [makeThread({ id: "a", projectId: "proj_a" })] };
    const writes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => writes.push(...records));
    observer.observe(document.documentElement, { attributes: true, subtree: true });
    const slot = renderSlot({ ...navigation, component: shell }, props, { sidebarNavigation: { items: [destination("board", "Board")] }, settings: { wideRail: true } });
    const peer = document.querySelector<HTMLElement>(".group.peer")!;
    const bbElements = [document.documentElement, document.body, peer, peer.firstElementChild!, document.querySelector('[data-sidebar="sidebar"]')!, document.querySelector('[data-sidebar="footer"]')!];
    const state = { wide: false, compact: false, scoped: false };
    expect(hostSheet()).toBe(railHostCss(state));

    fireEvent.click(screen.getByRole("button", { name: "Show labels" }));
    expect(hostSheet()).toBe(railHostCss({ ...state, wide: true }));
    fireEvent.click(screen.getByRole("button", { name: "Alpha: show only this project" }));
    expect(hostSheet()).toBe(railHostCss({ ...state, wide: true, scoped: true }));
    slot.rerender(createElement(shell, { ...props, isCompactViewport: true }));
    expect(hostSheet()).toBe(railHostCss({ ...state, compact: true, scoped: true }));

    slot.lifecycle.unmount();
    expect(railHostStyles()).toEqual([]);
    writes.push(...observer.takeRecords());
    observer.disconnect();
    expect(writes.filter((record) => bbElements.includes(record.target as Element)).map((record) => record.attributeName)).toEqual([]);
  });

  it("leaves destinations and tiles alone when a thread update changes nothing they show", () => {
    const thread = makeThread({ id: "a", projectId: "proj_a" });
    host.sidebarThreads = { status: "ready", projects: [makeProject({ id: "proj_a", name: "Alpha" })], threads: [thread] };
    const split = vi.spyOn(pluginSdk, "experimental_useSidebarNavigationSplit");
    const slot = mount([destination("board", "Board"), destination("notes", "Notes")]);
    const tile = screen.getByRole("button", { name: "Alpha: show only this project" });
    split.mockClear();
    host.sidebarThreads = { ...host.sidebarThreads, threads: [{ ...thread, updatedAt: thread.updatedAt + 1 }] };
    slot.rerender(createElement(navigation.component, props));
    expect(split).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Alpha: show only this project" })).toBe(tile);
    // A change the tiles do show still lands.
    host.sidebarThreads = { ...host.sidebarThreads, threads: [{ ...thread, indicator: "waiting-for-input" }] };
    slot.rerender(createElement(navigation.component, props));
    expect(tile.querySelector(".radar-rail-badge-waiting")).not.toBeNull();
  });
});

describe("project badges", () => {
  const projects = [makeProject({ id: "proj_a", name: "bb-appimage" })];
  function tileFor(threads: ReturnType<typeof makeThread>[]) {
    host.sidebarThreads = { status: "ready", projects, threads };
    mount([]);
    const tile = screen.getByRole("button", { name: "bb-appimage: show only this project" });
    return { tile, badge: (kind: "waiting" | "active" | "unread") => tile.querySelector(`.radar-rail-badge-${kind}`)?.textContent ?? null };
  }

  it("counts what needs you, what is working, and what is unread", () => {
    const { badge } = tileFor([
      makeThread({ id: "blocked", hasPendingInteraction: true, indicator: "waiting-for-input" }),
      makeThread({ id: "queued", queuedWork: "waiting", indicator: "queued-waiting" }),
      makeThread({ id: "run-a", status: "active" }),
      makeThread({ id: "run-b", status: "active", isUnread: true }),
      makeThread({ id: "unread", isUnread: true }),
      makeThread({ id: "quiet" }),
    ]);
    expect(badge("waiting")).toBe("2");
    // Blocked and queued work is already under needs-you, not counted twice.
    expect(badge("active")).toBe("2");
    expect(badge("unread")).toBe("2");
  });

  it("draws only the badges a project has", () => {
    const { tile, badge } = tileFor([makeThread({ id: "unread", isUnread: true })]);
    expect(badge("unread")).toBe("1");
    expect(badge("waiting")).toBeNull();
    expect(badge("active")).toBeNull();
    expect(tile.querySelectorAll(".radar-rail-badge")).toHaveLength(1);
  });

  it("draws none for a quiet project", () => {
    const { tile } = tileFor([makeThread({ id: "quiet" })]);
    expect(tile.querySelector(".radar-rail-badges")).toBeNull();
  });

  it("caps large counts", () => {
    const { badge } = tileFor(Array.from({ length: 120 }, (_, index) => makeThread({ id: `u${index}`, isUnread: true })));
    expect(badge("unread")).toBe("99+");
  });

  it("pins a project that needs you above busier ones until it is resolved", () => {
    const pair = [makeProject({ id: "proj_a", name: "bb-appimage" }), makeProject({ id: "proj_b", name: "ERBareeq" })];
    const running = makeThread({ id: "running", projectId: "proj_b", status: "active" });
    const blocked = makeThread({ id: "blocked", projectId: "proj_a", updatedAt: NOW - 7 * DAY, latestAttentionAt: NOW - 7 * DAY, hasPendingInteraction: true, indicator: "waiting-for-input" });
    const order = () => within(screen.getByRole("group", { name: "Projects" })).getAllByRole("button").map((tile) => tile.getAttribute("aria-label"));
    host.sidebarThreads = { status: "ready", projects: pair, threads: [running, blocked] };
    const slot = mount([]);
    expect(order()).toEqual(["bb-appimage: show only this project", "ERBareeq: show only this project"]);
    // Answered: back to activity order.
    host.sidebarThreads = { status: "ready", projects: pair, threads: [running, { ...blocked, hasPendingInteraction: false, indicator: "none" }] };
    slot.rerender(createElement(navigation.component, props));
    expect(order()).toEqual(["ERBareeq: show only this project", "bb-appimage: show only this project"]);
  });

  it("orders projects that need you by activity among themselves", () => {
    const pair = [makeProject({ id: "proj_a", name: "bb-appimage" }), makeProject({ id: "proj_b", name: "ERBareeq" })];
    host.sidebarThreads = {
      status: "ready", projects: pair,
      threads: [
        makeThread({ id: "older", projectId: "proj_a", indicator: "waiting-for-input", updatedAt: NOW - 3 * DAY, latestAttentionAt: NOW - 3 * DAY }),
        makeThread({ id: "newer", projectId: "proj_b", indicator: "waiting-for-input", updatedAt: NOW - DAY, latestAttentionAt: NOW - DAY }),
      ],
    };
    mount([]);
    const tiles = within(screen.getByRole("group", { name: "Projects" })).getAllByRole("button");
    expect(tiles.map((tile) => tile.getAttribute("aria-label"))).toEqual(["ERBareeq: show only this project", "bb-appimage: show only this project"]);
  });

  it("shows no badges when Project badges is off, but keeps the tally", () => {
    host.sidebarThreads = { status: "ready", projects, threads: [makeThread({ id: "blocked", hasPendingInteraction: true, indicator: "waiting-for-input", isUnread: true })] };
    renderSlot(navigation, props, { sidebarNavigation: { items: [] }, settings: { projectBadges: false } });
    const tile = screen.getByRole("button", { name: "bb-appimage: show only this project" });
    expect(tile.querySelector(".radar-rail-badges")).toBeNull();
    expect(tile.getAttribute("aria-description")).toContain("1 waiting");
  });

  it("keeps activity order, without the needs-you pin, when Project badges is off", () => {
    const pair = [makeProject({ id: "proj_a", name: "bb-appimage" }), makeProject({ id: "proj_b", name: "ERBareeq" })];
    host.sidebarThreads = {
      status: "ready", projects: pair,
      threads: [
        makeThread({ id: "running", projectId: "proj_b", status: "active" }),
        makeThread({ id: "blocked", projectId: "proj_a", updatedAt: NOW - 7 * DAY, latestAttentionAt: NOW - 7 * DAY, hasPendingInteraction: true, indicator: "waiting-for-input" }),
      ],
    };
    renderSlot(navigation, props, { sidebarNavigation: { items: [] }, settings: { projectBadges: false } });
    const tiles = within(screen.getByRole("group", { name: "Projects" })).getAllByRole("button");
    expect(tiles.map((tile) => tile.getAttribute("aria-label"))).toEqual(["ERBareeq: show only this project", "bb-appimage: show only this project"]);
  });

  it("describes the tally to assistive tech without renaming the tile", () => {
    const { tile } = tileFor([makeThread({ id: "blocked", hasPendingInteraction: true, indicator: "waiting-for-input", isUnread: true })]);
    expect(tile.getAttribute("aria-description")).toBe("1 thread · 1 waiting · 1 live · 1 unread");
    expect(tile.querySelector(".radar-rail-badges")?.getAttribute("aria-hidden")).toBe("true");
  });
});
