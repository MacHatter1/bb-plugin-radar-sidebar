import { createElement } from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import * as pluginSdk from "@get-bb/plugin-sdk/app";
import { railHostCss } from "./railHostStyles";
import type { ExperimentalSidebarNavigationItem, ExperimentalSidebarNavigationProps, PluginSidebarThreadsState, PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { DAY, makeProject, makeThread, NOW } from "./fixtures";
import { resetRailScope, setRailScope, useRailScope } from "./railScope";
import { projectRailState } from "./RadarRailNavigation";
import { seedSettings } from "./settingsStore";
import type { RailLiveStatus } from "@/lib/settings";
import { toast } from "sonner";
import * as projectFinder from "./projectFinder";
import * as projectDesktop from "./projectDesktop";
import { changeProjectOrganisation, EMPTY_PROJECT_ORGANISATION, type ProjectOrganisationChange } from "@/lib/projectOrganisation";
import type { SettingsSnapshot } from "@/lib/settingsRpc";

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

describe("live rail accessories", () => {
  const Accessory = () => <span data-testid="mascot">working</span>;
  const dot = () => ({ ...destination("dot", "Dot"), experimental_Accessory: Accessory });
  const staticIcon = (button: HTMLElement) => button.querySelector('[data-sidebar-navigation-icon]');

  it("offers Live status only when an item has an accessory", () => {
    mount([dot(), destination("plain", "Plain")]);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Plain" }));
    expect(screen.queryByText("Live status")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.contextMenu(screen.getByRole("button", { name: "Dot" }));
    expect(screen.getByText("Live status")).toBeTruthy();
    for (const name of ["Off (dot indicator)", "As a badge", "Instead of the icon"])
      expect(screen.getByRole("menuitem", { name })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Off (dot indicator)" }).querySelector(".radar-menu-check")).not.toBeNull();
  });

  it.each(["off", "badge", "icon"] as RailLiveStatus[])("renders %s without changing activation, accessible name or shortcuts", (mode) => {
    const item = { ...dot(), shortcut: { label: "⌘1", ariaKeyShortcuts: "Meta+1" } };
    seedSettings({ railLiveStatus: { [item.id]: mode } });
    const slot = mount([item]);
    const button = screen.getByRole("button", { name: "Dot (⌘1)" });
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+1");
    expect(Boolean(button.querySelector(".radar-rail-dot"))).toBe(mode === "off");
    expect(Boolean(within(button).queryByTestId("mascot"))).toBe(mode !== "off");
    expect(Boolean(staticIcon(button))).toBe(mode !== "icon");
    if (mode !== "off") {
      expect(button.querySelector(`.radar-rail-accessory-${mode}`)?.hasAttribute("inert")).toBe(true);
      expect(button.querySelector(".radar-rail-icon-slot")?.getAttribute("aria-hidden")).toBe("true");
    }
    fireEvent.click(button, { altKey: true });
    expect(slot.inspection.sidebarNavigationCalls).toEqual([{ method: "activate", itemId: item.id, openInSplit: true }]);
    fireEvent.focus(button);
    expect(screen.getByRole("tooltip").textContent).toContain("working");
  });

  it("saves only the chosen item and preserves all other settings", async () => {
    const item = dot();
    const saved = { railNav: true, motion: false, railLiveStatus: { "other/nav": "badge" } };
    seedSettings(saved);
    const setRailLiveStatus = vi.fn(({ itemId, mode }) => ({
      ...saved, railLiveStatus: { ...saved.railLiveStatus, [itemId]: mode }, revision: 1,
    }));
    renderSlot(navigation, props, { sidebarNavigation: { items: [item] }, rpc: { getSettings: () => ({ ...saved, revision: 0 }), setRailLiveStatus } });
    await act(async () => {});
    fireEvent.contextMenu(screen.getByRole("button", { name: "Dot" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Instead of the icon" }));
    await act(async () => {});
    expect(setRailLiveStatus).toHaveBeenCalledWith({ itemId: item.id, mode: "icon" });
    expect(screen.getByRole("button", { name: "Dot" }).querySelector(".radar-rail-accessory-icon")).not.toBeNull();
    expect(JSON.parse(localStorage.getItem("radar-sidebar:settings:v1")!).motion).toBe(false);
  });

  it("preserves a newer remote accessory edit while the local item's reply is pending", async () => {
    const item = dot();
    const other = { ...destination("other", "Other"), experimental_Accessory: Accessory };
    let release!: (value: unknown) => void;
    const mounted = renderSlot(navigation, props, {
      sidebarNavigation: { items: [item, other] },
      rpc: {
        getSettings: async () => ({ railNav: true, revision: 0 }),
        setRailLiveStatus: () => new Promise((resolve) => { release = resolve; }),
      },
    });
    await act(async () => {});
    fireEvent.contextMenu(screen.getByRole("button", { name: "Dot" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Instead of the icon" }));
    expect(screen.getByRole("button", { name: "Dot" }).querySelector(".radar-rail-accessory-icon")).not.toBeNull();
    await mounted.emitRealtime("settings", {
      railNav: true, railLiveStatus: { [item.id]: "icon", [other.id]: "badge" }, revision: 2,
    });
    await act(async () => release({ railNav: true, railLiveStatus: { [item.id]: "icon" }, revision: 1 }));
    expect(screen.getByRole("button", { name: "Other" }).querySelector(".radar-rail-accessory-badge")).not.toBeNull();
  });

  it("allows choosing a live rail mode from More", async () => {
    const item = { ...dot(), isVisible: false };
    const saved = { railNav: true };
    const setRailLiveStatus = vi.fn(({ itemId, mode }) => ({ ...saved, railLiveStatus: { [itemId]: mode }, revision: 1 }));
    renderSlot(navigation, props, { sidebarNavigation: { items: [item] }, rpc: { getSettings: () => ({ ...saved, revision: 0 }), setRailLiveStatus } });
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "More navigation, 1 items" }));
    const button = screen.getByRole("button", { name: "Dot" });
    expect(button.querySelector(".radar-nav-accessory")?.textContent).toBe("working");
    fireEvent.contextMenu(button);
    fireEvent.click(screen.getByRole("menuitem", { name: "As a badge" }));
    await act(async () => {});
    expect(setRailLiveStatus).toHaveBeenCalledWith({ itemId: item.id, mode: "badge" });
  });

  it.each(["off", "badge", "icon"] as RailLiveStatus[])("isolates a throwing accessory in %s and in its tooltip and popover", (mode) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Broken = () => { throw new Error("broken accessory"); };
    const item = { ...dot(), experimental_Accessory: Broken };
    seedSettings({ railLiveStatus: { [item.id]: mode } });
    const slot = mount([item, { ...item, id: "alpha/hidden", label: "Hidden", isVisible: false }]);
    const button = screen.getByRole("button", { name: "Dot" });
    expect(staticIcon(button)).not.toBeNull();
    fireEvent.focus(button);
    expect(staticIcon(screen.getByRole("tooltip"))).not.toBeNull();
    fireEvent.click(button);
    expect(slot.inspection.sidebarNavigationCalls).toContainEqual({ method: "activate", itemId: item.id, openInSplit: false });
    fireEvent.click(screen.getByRole("button", { name: "More navigation, 1 items" }));
    expect(staticIcon(screen.getByRole("button", { name: "Hidden" }))).not.toBeNull();
  });

  it.each([false, true])("shows a trailing accessory in standard navigation (compact=%s)", (compact) => {
    seedSettings({ railNav: false });
    mount([dot()], compact);
    const button = screen.getByRole("button", { name: "Dot" });
    expect(button.querySelector(".radar-nav-accessory")?.textContent).toBe("working");
    expect(staticIcon(button)).not.toBeNull();
  });

  it("keeps standard navigation usable when a trailing accessory throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    seedSettings({ railNav: false });
    const item = { ...dot(), experimental_Accessory: () => { throw new Error("broken accessory"); } };
    const slot = mount([item]);
    const button = screen.getByRole("button", { name: "Dot" });
    expect(staticIcon(button)).not.toBeNull();
    fireEvent.click(button);
    expect(slot.inspection.sidebarNavigationCalls).toHaveLength(1);
  });
});

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
    const callbacks: Array<(entries: ResizeObserverEntry[]) => void> = [];
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: (entries: ResizeObserverEntry[]) => void) { callbacks.push(callback); }
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
    act(() => callbacks.forEach((callback) => callback([])));
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
  it.each([false, true])("keeps More open through thread updates and thread-list scrolling (compact=%s)", (compact) => {
    const thread = makeThread({ id: "working" });
    host.sidebarThreads = { projects: [makeProject({ id: thread.projectId })], threads: [thread] };
    const slot = mount([destination("hidden", "Hidden", false)], compact);
    const threadList = document.createElement("div");
    slot.container.append(threadList);
    fireEvent.click(screen.getByRole("button", { name: "More navigation, 1 items" }));
    const popover = screen.getByRole("group", { name: "More navigation" });
    const hidden = screen.getByRole("button", { name: "Hidden" });

    host.sidebarThreads = { ...host.sidebarThreads, threads: [{ ...thread, status: "active", indicator: "runtime" }] };
    slot.rerender(createElement(navigation.component, { ...props, isCompactViewport: compact }));
    expect(screen.getByRole("group", { name: "More navigation" })).toBe(popover);
    // A changing thread list can adjust its scroll position independently
    // of the rail; that must not dismiss the rail's open menu.
    fireEvent.scroll(threadList);
    expect(screen.queryByRole("group", { name: "More navigation" })).toBe(popover);
    expect(document.activeElement).toBe(hidden);
    fireEvent.click(hidden);
    expect(slot.inspection.sidebarNavigationCalls).toEqual([
      { method: "activate", itemId: "alpha/hidden", openInSplit: false },
    ]);
    expect(screen.queryByRole("group", { name: "More navigation" })).toBeNull();
  });

  it.each([false, true])("keeps More open when its list scrolls and closes when its trigger's container scrolls (rail=%s)", (railNav) => {
    seedSettings({ railNav });
    mount([destination("hidden", "Hidden", false)]);
    const trigger = screen.getByRole("button", { name: "More navigation, 1 items" });
    fireEvent.click(trigger);
    const popover = screen.getByRole("group", { name: "More navigation" });
    fireEvent.scroll(popover.querySelector(".radar-nav-more-list")!);
    expect(screen.getByRole("group", { name: "More navigation" })).toBe(popover);
    fireEvent.scroll(trigger.parentElement!);
    expect(screen.queryByRole("group", { name: "More navigation" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it.each([false, true])("toggles More closed with a complete pointer click (rail=%s)", (railNav) => {
    seedSettings({ railNav });
    mount([destination("hidden", "Hidden", false)]);
    const trigger = screen.getByRole("button", { name: "More navigation, 1 items" });
    const clickTrigger = () => {
      fireEvent.pointerDown(trigger.firstElementChild ?? trigger);
      fireEvent.pointerUp(trigger.firstElementChild ?? trigger);
      fireEvent.click(trigger.firstElementChild ?? trigger);
    };
    clickTrigger();
    expect(screen.getByRole("group", { name: "More navigation" })).toBeTruthy();
    clickTrigger();
    expect(screen.queryByRole("group", { name: "More navigation" })).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    clickTrigger();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Hidden" }));
    expect(screen.getByRole("group", { name: "More navigation" })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("group", { name: "More navigation" })).toBeNull();
  });

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
  function mountWithThreads(isCompactViewport = false, rpc = {}, sdk?: NonNullable<Parameters<typeof renderSlot>[2]>["sdk"]) {
    const wrapped = { ...navigation, component: (p: ExperimentalSidebarNavigationProps) => createElement("div", null, createElement(navigation.component, p), createElement(Scope)) };
    const newThread: ExperimentalSidebarNavigationItem = { ...destination("new", "New thread"), id: "__bb__/new-thread", action: { kind: "new-thread" }, pluginId: null };
    return renderSlot(wrapped, { ...props, isCompactViewport }, { rpc, sdk, sidebarNavigation: { items: [newThread, destination("board", "Board")] }, sidebarThreads: { threads, projects } });
  }

  const projectOrder = () => Array.from(document.querySelectorAll(".radar-rail-project")).map(tile => tile.getAttribute("aria-label")?.split(":")[0]);
  function mountOrganised(compact = false, initial: SettingsSnapshot = { railNav: true, revision: 0 }) {
    let saved = initial;
    seedSettings(saved);
    const change = vi.fn((operation: ProjectOrganisationChange) => {
      saved = { ...saved, revision: saved.revision + 1, projectOrganisation: changeProjectOrganisation(saved.projectOrganisation ?? EMPTY_PROJECT_ORGANISATION, saved.pinnedProjects ?? {}, operation) };
      return saved;
    });
    const slot = mountWithThreads(compact, { getSettings: () => saved, changeProjectOrganisation: change });
    return { slot, change, saved: () => saved };
  }

  it.each([false, true])("reorders pins through the menu, persists it and keeps it through activity changes (compact=%s)", async compact => {
    host.sidebarThreads = { status: "ready", projects, threads };
    const { slot, change, saved } = mountOrganised(compact, { railNav: true, motion: false, revision: 0, pinnedProjects: { proj_a: true, proj_b: true, proj_c: true } });
    await act(async () => {});
    fireEvent.contextMenu(screen.getByRole("button", { name: "Quiet: show only this project" }));
    expect((screen.getByRole("menuitem", { name: "Move pin down" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move pin up" }));
    await act(async () => {});
    expect(projectOrder()).toEqual(["bb-appimage", "Quiet", "ERBareeq"]);
    expect(change).toHaveBeenCalledWith({ kind: "move-pin", projectId: "proj_c", beforeProjectId: "proj_b" });
    await slot.emitRealtime("settings", { ...saved(), revision: 2 });
    host.sidebarThreads = { status: "ready", projects, threads: threads.map(thread => ({ ...thread, isUnread: true, updatedAt: NOW + DAY })) };
    // Retain the wrapper instead of remounting its navigation component.
    await slot.emitRealtime("settings", { ...saved(), revision: 3 });
    expect(projectOrder()).toEqual(["bb-appimage", "Quiet", "ERBareeq"]);
    expect(JSON.parse(localStorage.getItem("radar-sidebar:settings:v1")!).projectOrganisation.pinOrder).toEqual(["proj_a", "proj_c", "proj_b"]);
    expect(saved().motion).toBe(false);
  });

  it("reorders pins using the real keyboard drag sensor without changing project scope", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const index = ["bb-appimage", "ERBareeq", "Quiet"].indexOf(this.getAttribute("aria-label")?.split(":")[0] ?? "");
      return new DOMRect(0, index < 0 ? 0 : 100 + index * 50, 40, 40);
    });
    const { change } = mountOrganised(false, { railNav: true, revision: 0, pinnedProjects: { proj_a: true, proj_b: true, proj_c: true } });
    await act(async () => {});
    const tile = screen.getByRole("button", { name: "ERBareeq: show only this project" });
    act(() => tile.focus());
    fireEvent.keyDown(tile, { key: " ", code: "Space" });
    await waitFor(() => expect(tile.classList.contains("radar-rail-project-dragging")).toBe(true));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    fireEvent.keyDown(tile, { key: "ArrowUp", code: "ArrowUp" });
    fireEvent.keyDown(tile, { key: " ", code: "Space" });
    await waitFor(() => expect(change).toHaveBeenCalledWith({ kind: "move-pin", projectId: "proj_b", beforeProjectId: "proj_a" }));
    expect(projectOrder()).toEqual(["ERBareeq", "bb-appimage", "Quiet"]);
    expect(screen.getByTestId("scope").textContent).toBe("none");
  });

  it("reorders pins with a mouse drag and keeps a cancelled drag unsaved", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const index = ["bb-appimage", "ERBareeq", "Quiet"].indexOf(this.getAttribute("aria-label")?.split(":")[0] ?? "");
      return new DOMRect(0, index < 0 ? 0 : 100 + index * 50, 40, 40);
    });
    const { change } = mountOrganised(false, { railNav: true, revision: 0, pinnedProjects: { proj_a: true, proj_b: true, proj_c: true } });
    await act(async () => {});
    const tile = screen.getByRole("button", { name: "ERBareeq: show only this project" });
    fireEvent.mouseDown(tile, { button: 0, clientX: 20, clientY: 170 });
    fireEvent.mouseMove(document, { clientX: 20, clientY: 160 });
    await waitFor(() => expect(tile.classList.contains("radar-rail-project-dragging")).toBe(true));
    fireEvent.mouseMove(document, { clientX: 20, clientY: 120 });
    fireEvent.mouseUp(document);
    await waitFor(() => expect(change).toHaveBeenCalledWith({ kind: "move-pin", projectId: "proj_b", beforeProjectId: "proj_a" }));
    expect(projectOrder()).toEqual(["ERBareeq", "bb-appimage", "Quiet"]);
    fireEvent.mouseDown(tile, { button: 0, clientX: 20, clientY: 170 });
    fireEvent.mouseMove(document, { clientX: 20, clientY: 160 });
    await waitFor(() => expect(tile.classList.contains("radar-rail-project-dragging")).toBe(true));
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(change).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("scope").textContent).toBe("none");
    // DndKit suppresses synthetic clicks for 50ms after a pointer drag.
    // Let its document listener detach before the next test clicks a menu.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
  });

  it("rolls back a failed reorder and preserves a newer remote collection", async () => {
    const error = vi.spyOn(toast, "error");
    let reject!: (error: Error) => void;
    const initial = { railNav: true, pinnedProjects: { proj_a: true, proj_b: true }, revision: 0 };
    seedSettings(initial);
    const slot = mountWithThreads(false, { getSettings: () => initial, changeProjectOrganisation: () => new Promise((_resolve, fail) => { reject = fail; }) });
    await act(async () => {});
    fireEvent.contextMenu(screen.getByRole("button", { name: "ERBareeq: show only this project" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move pin up" }));
    expect(projectOrder()).toEqual(["ERBareeq", "bb-appimage"]);
    await slot.emitRealtime("settings", { ...initial, revision: 2, projectOrganisation: { pinOrder: ["proj_a", "proj_b"], collections: { work: { name: "Work", collapsed: true } }, projectCollections: { proj_c: "work" } } });
    await act(async () => reject(new Error("offline")));
    expect(projectOrder()).toEqual(["bb-appimage", "ERBareeq"]);
    expect(screen.getByRole("button", { name: "Expand Work collection, 1 projects" })).toBeTruthy();
    expect(error).toHaveBeenCalledWith("Couldn’t save project organisation", { description: "Please try again." });
  });

  it.each([false, true])("creates, collapses, renames and removes a collection (compact=%s)", async compact => {
    const { change, saved } = mountOrganised(compact);
    await act(async () => {});
    fireEvent.contextMenu(screen.getByRole("button", { name: "ERBareeq: show only this project" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to collection…" }));
    const dialog = screen.getByRole("dialog", { name: "Move project to collection" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Collection" }), { target: { value: "new" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Collection name" }), { target: { value: "Work" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save collection" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ kind: "create-collection", name: "Work", projectId: "proj_b" }));
    expect(within(screen.getByRole("group", { name: "Work collection" })).getByRole("button", { name: "ERBareeq: show only this project" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Work collection, 1 projects" }));
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "ERBareeq: show only this project" })).toBeNull();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Expand Work collection, 1 projects" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename collection" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Collection name" }), { target: { value: "Clients" } });
    fireEvent.click(screen.getByRole("button", { name: "Save collection" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Expand Clients collection, 1 projects" })).toBeTruthy();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Expand Clients collection, 1 projects" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove collection" }));
    await act(async () => {});
    expect(screen.queryByRole("group", { name: "Clients collection" })).toBeNull();
    expect(screen.getByRole("button", { name: "ERBareeq: show only this project" })).toBeTruthy();
    expect(saved().projectOrganisation?.projectCollections).toEqual({});
    expect(screen.getByTestId("scope").textContent).toBe("none");
  });

  it("keeps collected idle projects visible and pins above collapsed collections", async () => {
    const layout = { ...EMPTY_PROJECT_ORGANISATION, collections: { work: { name: "Work", collapsed: true } }, projectCollections: { proj_b: "work", proj_c: "work" } };
    mountOrganised(false, { railNav: true, revision: 0, pinnedProjects: { proj_b: true }, projectOrganisation: layout });
    await act(async () => {});
    expect(projectOrder()).toEqual(["ERBareeq", "bb-appimage"]);
    fireEvent.click(screen.getByRole("button", { name: "Expand Work collection, 1 projects" }));
    await act(async () => {});
    expect(projectOrder()).toEqual(["ERBareeq", "Quiet", "bb-appimage"]);
    expect(screen.getByRole("button", { name: "Quiet: show only this project" }).getAttribute("aria-description")).toBe("0 threads");
  });

  it("keeps the collection form open when saving fails", async () => {
    mountWithThreads(false, { getSettings: () => ({ railNav: true, revision: 0 }), changeProjectOrganisation: async () => { throw new Error("offline"); } });
    await act(async () => {});
    fireEvent.contextMenu(screen.getByRole("button", { name: "ERBareeq: show only this project" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to collection…" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Collection" }), { target: { value: "new" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Collection name" }), { target: { value: "Work" } });
    fireEvent.click(screen.getByRole("button", { name: "Save collection" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Couldn’t save"));
    expect(screen.queryByRole("group", { name: "Work collection" })).toBeNull();
  });

  it("starts a thread in the right-clicked project while another project is scoped", () => {
    setRailScope("proj_a");
    const slot = mountWithThreads();
    fireEvent.contextMenu(screen.getByRole("button", { name: "ERBareeq: show only this project" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "New thread in project" }));
    expect(slot.inspection.sidebarActionCalls).toContainEqual({ method: "openNewThread", options: { projectId: "proj_b", focusPrompt: true } });
    expect(screen.getByTestId("scope").textContent).toBe("proj_a");
  });

  it("marks only the chosen project's unread threads read and disables the action when there are none", async () => {
    const markRead = vi.fn(async () => ({} as Awaited<ReturnType<PluginBrowserBbSdk["threads"]["markRead"]>>));
    host.sidebarThreads = { status: "ready", projects, threads: [
      makeThread({ id: "unread-a", projectId: "proj_a", isUnread: true }),
      makeThread({ id: "unread-b", projectId: "proj_b", isUnread: true }),
      makeThread({ id: "read-b", projectId: "proj_b", isUnread: false }),
    ] };
    mountWithThreads(false, {}, { threads: { markRead } });
    fireEvent.contextMenu(screen.getByRole("button", { name: "ERBareeq: show only this project" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark project as read" }));
    await act(async () => {});
    expect(markRead.mock.calls).toEqual([[{ threadId: "unread-b" }]]);
    host.sidebarThreads = { status: "ready", projects, threads: [makeThread({ id: "read-b", projectId: "proj_b", isUnread: false })] };
    cleanup();
    mountWithThreads();
    fireEvent.contextMenu(screen.getByRole("button", { name: "ERBareeq: show only this project" }));
    expect((screen.getByRole("menuitem", { name: "Mark project as read" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers detected desktop editors and terminals and opens the selected app", async () => {
    vi.stubGlobal("bbDesktop", { platform: "macos" });
    const folder = { port: 38887, path: "/Users/tom/project" };
    const discover = vi.spyOn(projectDesktop, "discoverProjectOpenTargets").mockResolvedValue({ folder, targets: [
      { id: "vscode", label: "Visual Studio Code", kind: "editor", capabilities: { openDirectory: true } },
      { id: "terminal", label: "Terminal", kind: "terminal", capabilities: { openDirectory: true } },
    ] });
    const open = vi.spyOn(projectDesktop, "openProjectTarget").mockResolvedValue();
    mountWithThreads();
    fireEvent.contextMenu(screen.getByRole("button", { name: "ERBareeq: show only this project" }));
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Open in Terminal" })).toBeTruthy());
    expect(discover).toHaveBeenCalledWith(expect.anything(), "proj_b", expect.any(AbortSignal));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in Visual Studio Code" }));
    expect(open).toHaveBeenCalledWith(folder, "vscode");
    expect(screen.getByTestId("scope").textContent).toBe("none");
  });

  it("ignores app discovery for a project whose menu has closed", async () => {
    vi.stubGlobal("bbDesktop", { platform: "macos" });
    let release!: (value: Awaited<ReturnType<typeof projectDesktop.discoverProjectOpenTargets>>) => void;
    vi.spyOn(projectDesktop, "discoverProjectOpenTargets")
      .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
      .mockResolvedValue({ folder: { port: 38887, path: "/a" }, targets: [{ id: "terminal", label: "Terminal", kind: "terminal", capabilities: { openDirectory: true } }] });
    mountWithThreads();
    fireEvent.contextMenu(screen.getByRole("button", { name: "ERBareeq: show only this project" }));
    fireEvent.contextMenu(screen.getByRole("button", { name: "bb-appimage: show only this project" }));
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Open in Terminal" })).toBeTruthy());
    await act(async () => release({ folder: { port: 38887, path: "/b" }, targets: [{ id: "wrong", label: "Old app", kind: "editor", capabilities: { openDirectory: true } }] }));
    expect(screen.queryByRole("menuitem", { name: "Open in Old app" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Open in Terminal" })).toBeTruthy();
  });

  it("reports partial mark-read failures and leaves the project scope intact", async () => {
    const error = vi.spyOn(toast, "error");
    host.sidebarThreads = { status: "ready", projects, threads: [makeThread({ id: "failed", projectId: "proj_b", isUnread: true })] };
    setRailScope("proj_a");
    mountWithThreads(false, {}, { threads: { markRead: async () => { throw new Error("offline"); } } });
    fireEvent.contextMenu(screen.getByRole("button", { name: "ERBareeq: show only this project" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark project as read" }));
    await act(async () => {});
    expect(error).toHaveBeenCalledWith("Some threads couldn’t be marked as read", { description: "0 marked as read; 1 failed. Please try again." });
    expect(screen.getByTestId("scope").textContent).toBe("proj_a");
  });

  it.each([false, true])("pins and unpins a project without changing scope, preserving other pins (compact=%s)", async (compact) => {
    let saved = { railNav: true, motion: false, pinnedProjects: { proj_c: true } as Record<string, boolean>, revision: 0 };
    seedSettings(saved);
    const setProjectPinned = vi.fn(({ projectId, pinned }: { projectId: string; pinned: boolean }) => {
      const pins = { ...saved.pinnedProjects, [projectId]: pinned };
      if (!pinned) delete pins[projectId];
      saved = { ...saved, pinnedProjects: pins, revision: saved.revision + 1 };
      return saved;
    });
    mountWithThreads(compact, { getSettings: () => saved, setProjectPinned });
    await act(async () => {});
    let tile = screen.getByRole("button", { name: "ERBareeq: show only this project" });
    fireEvent.contextMenu(tile);
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin project" }));
    tile = screen.getByRole("button", { name: "ERBareeq: show only this project" });
    expect(tile.querySelector(".radar-rail-project-pin")).not.toBeNull();
    expect(within(screen.getByRole("group", { name: "Projects" })).getAllByRole("button")[1]).toBe(tile);
    expect(screen.getByTestId("scope").textContent).toBe("none");
    expect(screen.queryByRole("menu", { name: "Project actions" })).toBeNull();
    await act(async () => {});
    expect(setProjectPinned).toHaveBeenCalledWith({ projectId: "proj_b", pinned: true });
    expect(JSON.parse(localStorage.getItem("radar-sidebar:settings:v1")!).pinnedProjects).toEqual({ proj_b: true, proj_c: true });
    fireEvent.contextMenu(tile);
    fireEvent.click(screen.getByRole("menuitem", { name: "Unpin project" }));
    await act(async () => {});
    tile = screen.getByRole("button", { name: "ERBareeq: show only this project" });
    expect(tile.querySelector(".radar-rail-project-pin")).toBeNull();
    expect(saved.pinnedProjects).toEqual({ proj_c: true });
    expect(saved.motion).toBe(false);
  });

  it("keeps pins visible with no visible threads and omits deleted projects", () => {
    seedSettings({ pinnedProjects: { proj_b: true, proj_c: true, deleted: true } });
    host.sidebarThreads = { status: "ready", projects, threads: threads.map(thread => ({ ...thread, isHidden: true })) };
    const slot = mount([]);
    expect(within(screen.getByRole("group", { name: "Projects" })).getAllByRole("button").map(tile => tile.getAttribute("aria-label")))
      .toEqual(["ERBareeq: show only this project", "Quiet: show only this project"]);
    expect(screen.getByRole("button", { name: "Quiet: show only this project" }).getAttribute("aria-description")).toBe("Pinned · 0 threads");
    host.sidebarThreads = { status: "ready", projects: projects.filter(project => project.id !== "proj_b"), threads: [] };
    slot.rerender(createElement(navigation.component, props));
    expect(screen.queryByRole("button", { name: "ERBareeq: show only this project" })).toBeNull();
    expect(screen.getByRole("button", { name: "Quiet: show only this project" })).toBeTruthy();
  });

  it("honours pins with project badges turned off", () => {
    seedSettings({ pinnedProjects: { proj_c: true }, projectBadges: false });
    mountWithThreads();
    expect(within(screen.getByRole("group", { name: "Projects" })).getAllByRole("button")[0].getAttribute("aria-label"))
      .toBe("Quiet: show only this project");
    expect(document.querySelector(".radar-rail-badges")).toBeNull();
  });

  it("rolls back a failed pin save and reports the failure", async () => {
    const error = vi.spyOn(toast, "error");
    mountWithThreads(false, { getSettings: () => ({ railNav: true, revision: 0 }), setProjectPinned: async () => { throw new Error("offline"); } });
    await act(async () => {});
    const tile = screen.getByRole("button", { name: "ERBareeq: show only this project" });
    fireEvent.contextMenu(tile);
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin project" }));
    expect(screen.getByRole("button", { name: "ERBareeq: show only this project" }).querySelector(".radar-rail-project-pin")).not.toBeNull();
    await act(async () => {});
    expect(tile.querySelector(".radar-rail-project-pin")).toBeNull();
    expect(error).toHaveBeenCalledWith("Couldn’t save project pin", { description: "Please try again." });
  });

  it("preserves a newer remote pin when an older save reply arrives", async () => {
    let release!: (value: unknown) => void;
    const slot = mountWithThreads(false, {
      getSettings: () => ({ railNav: true, revision: 0 }),
      setProjectPinned: () => new Promise(resolve => { release = resolve; }),
    });
    await act(async () => {});
    fireEvent.contextMenu(screen.getByRole("button", { name: "ERBareeq: show only this project" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin project" }));
    await slot.emitRealtime("settings", { railNav: true, pinnedProjects: { proj_b: true, proj_c: true }, revision: 2 });
    await act(async () => release({ railNav: true, pinnedProjects: { proj_b: true }, revision: 1 }));
    expect(screen.getByRole("button", { name: "Quiet: show only this project" }).querySelector(".radar-rail-project-pin")).not.toBeNull();
    expect(JSON.parse(localStorage.getItem("radar-sidebar:settings:v1")!).pinnedProjects).toEqual({ proj_b: true, proj_c: true });
  });

  it("removes an idle project tile when it is unpinned", async () => {
    seedSettings({ pinnedProjects: { proj_c: true } });
    mountWithThreads(false, {
      getSettings: () => ({ railNav: true, pinnedProjects: { proj_c: true }, revision: 0 }),
      setProjectPinned: () => ({ railNav: true, pinnedProjects: {}, revision: 1 }),
    });
    await act(async () => {});
    fireEvent.contextMenu(screen.getByRole("button", { name: "Quiet: show only this project" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Unpin project" }));
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Quiet: show only this project" })).toBeNull();
  });

  it.each([false, true])("keeps the project menu open through chat scrolls and thread updates (compact=%s)", (compact) => {
    host.sidebarThreads = { status: "ready", projects, threads };
    const slot = mount([], compact);
    fireEvent.contextMenu(screen.getByRole("button", { name: "ERBareeq: show only this project" }));
    const chat = document.createElement("div");
    document.body.append(chat);
    fireEvent.scroll(chat);
    chat.remove();
    host.sidebarThreads = { status: "ready", projects, threads: threads.map(thread => ({ ...thread, updatedAt: thread.updatedAt + 1 })) };
    slot.rerender(createElement(navigation.component, { ...props, isCompactViewport: compact }));
    expect(screen.getByRole("menuitem", { name: "Pin project" })).toBeTruthy();
    fireEvent.scroll(screen.getByRole("group", { name: "Projects" }));
    expect(screen.queryByRole("menu", { name: "Project actions" })).toBeNull();
  });

  it.each([false, true])("opens a project's Finder menu on the macOS desktop without changing scope (compact=%s)", async (compact) => {
    vi.stubGlobal("bbDesktop", { platform: "macos" });
    const openFinder = vi.spyOn(projectFinder, "openProjectInFinder").mockResolvedValue();
    mountWithThreads(compact);
    fireEvent.contextMenu(screen.getByRole("button", { name: "ERBareeq: show only this project" }), { clientX: 50, clientY: 100 });
    expect(screen.getByRole("menu", { name: "Project actions" })).toBeTruthy();
    expect(screen.getByTestId("scope").textContent).toBe("none");
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in Finder" }));
    await act(async () => {});
    expect(openFinder).toHaveBeenCalledWith(expect.anything(), "proj_b");
    expect(screen.queryByRole("menu", { name: "Project actions" })).toBeNull();
    expect(screen.getByTestId("scope").textContent).toBe("none");
  });

  it.each([undefined, { platform: "linux" }, { platform: "windows" }])("omits the Finder menu outside the macOS desktop (%s)", (desktop) => {
    vi.stubGlobal("bbDesktop", desktop);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X)");
    mountWithThreads();
    fireEvent.contextMenu(screen.getByRole("button", { name: "ERBareeq: show only this project" }));
    expect(screen.queryByRole("menuitem", { name: "Open in Finder" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Pin project" })).toBeTruthy();
  });

  it("reports when the project's folder cannot be opened", async () => {
    vi.stubGlobal("bbDesktop", { platform: "macos" });
    vi.spyOn(projectFinder, "openProjectInFinder").mockRejectedValue(new Error("This project has no folder on this Mac."));
    const error = vi.spyOn(toast, "error");
    mountWithThreads();
    fireEvent.contextMenu(screen.getByRole("button", { name: "ERBareeq: show only this project" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in Finder" }));
    await act(async () => {});
    expect(error).toHaveBeenCalledWith("Couldn’t open project in Finder", { description: "This project has no folder on this Mac." });
  });

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

describe("project styles", () => {
  const projects = [makeProject({ id: "proj_a", name: "bb-appimage" })];
  function styledTile(style: string, thread = makeThread({ id: "blocked", hasPendingInteraction: true, indicator: "waiting-for-input" })) {
    host.sidebarThreads = { status: "ready", projects, threads: [thread] };
    renderSlot(navigation, props, { sidebarNavigation: { items: [] }, settings: { projectStyle: style } });
    return screen.getByRole("button", { name: "bb-appimage: show only this project" });
  }

  it("names the loudest state waiting first, then working, then unread", () => {
    expect(projectRailState({ waiting: 1, active: 2, unread: 3 })).toBe("waiting");
    expect(projectRailState({ waiting: 0, active: 2, unread: 3 })).toBe("working");
    expect(projectRailState({ waiting: 0, active: 0, unread: 3 })).toBe("unread");
    expect(projectRailState({ waiting: 0, active: 0, unread: 0 })).toBe("quiet");
  });

  it("draws hue monograms with no style class for Tiles", () => {
    const tile = styledTile("Tiles");
    expect(tile.querySelector(".radar-rail-monogram")?.textContent).toBe("BA");
    expect(tile.className).not.toContain("radar-rail-style-");
    expect(tile.className).toContain("radar-rail-state-waiting");
  });

  it("draws a glowing ring while waiting and an arc while working for Rings", () => {
    const waiting = styledTile("Rings");
    expect(waiting.className).toContain("radar-rail-style-rings");
    expect(waiting.querySelector(".radar-rail-ring-waiting")?.textContent).toBe("BA");
    expect(waiting.querySelector(".radar-rail-ringwrap")).toBeNull();
    cleanup();
    host.sidebarThreads = null;
    const working = styledTile("Rings", makeThread({ id: "run", status: "active" }));
    expect(working.querySelector(".radar-rail-ringwrap .radar-rail-arc")).not.toBeNull();
    expect(working.querySelector(".radar-rail-ringcore")?.textContent).toBe("BA");
  });

  it("draws a dot-plus-monogram pill edged by state for Chips", () => {
    const tile = styledTile("Chips");
    expect(tile.className).toContain("radar-rail-style-chips");
    expect(tile.className).toContain("radar-rail-state-waiting");
    expect(tile.querySelector(".radar-rail-chipdot")).not.toBeNull();
    expect(tile.querySelector(".radar-rail-chipmono")?.textContent).toBe("BA");
  });

  it.each(["Tiles", "Rings", "Chips"])("keeps the full badge set in the %s tile for wide rows and assistive tech", (style) => {
    const tile = styledTile(style);
    // Narrow rings and chips show a subset via CSS; the tally stays whole.
    expect(tile.querySelector(".radar-rail-badge-waiting")?.textContent).toBe("1");
    expect(tile.getAttribute("aria-description")).toContain("1 waiting");
  });
});
