import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginAppSlots } from "@get-bb/plugin-sdk/app";
import { RadarProjectRail, type RadarProjectRailProps } from "./RadarProjectRail";
import { RadarThreadList } from "./RadarThreadList";
import { registerProjectRail } from "./registerProjectRail";
import { makeProject, makeThread } from "./fixtures";
import { EMPTY_PROJECT_ORGANISATION, changeProjectOrganisation } from "@/lib/projectOrganisation";
import type { SavedSettings } from "@/lib/settings";
import { seedSettings } from "./settingsStore";

const projects = [makeProject({ id: "a", name: "Learn Anything" }), makeProject({ id: "b", name: "bb-plus" }),
  makeProject({ id: "c", name: "Empty project" })];
const threads = [makeThread({ id: "one", title: "Polish dashboard", projectId: "a", status: "active", isUnread: true }),
  makeThread({ id: "two", title: "Review extensions", projectId: "b", indicator: "waiting-for-input" }),
  makeThread({ id: "hidden", title: "Hidden helper", projectId: "a", isHidden: true, isUnread: true })];

function Sidebar(props: RadarProjectRailProps) {
  return <><RadarProjectRail {...props} /><RadarThreadList activeThreadId={null} activeProjectId="a"
    isCompactViewport={false} onNavigate={() => {}} searchQuery="" /></>;
}

function renderRail(saved: SavedSettings = {}, props: RadarProjectRailProps = {}, sdk: Record<string, unknown> = {},
  rpc: Record<string, (input: unknown) => unknown> = {}, includeList = false) {
  let settings = saved;
  let revision = 1;
  seedSettings(settings);
  return renderSlot({ component: includeList ? Sidebar : RadarProjectRail }, props, {
    context: { projectId: "a", threadId: null },
    sidebarThreads: { status: "ready", projects, threads, sections: [] },
    sdk: { threads: { defaultExecutionOptions: async () => null }, providers: { models: async () => ({
      models: [], modelLoadError: null, permissionCeiling: "full" as const, providers: [], selectedOnlyModels: [],
    }) }, ...sdk },
    rpc: {
      getSettings: () => ({ ...settings, revision }),
      setProjectPinned: raw => {
        const { projectId, pinned } = raw as { projectId: string; pinned: boolean };
        settings = { ...settings, pinnedProjects: { ...settings.pinnedProjects, [projectId]: pinned } };
        return { ...settings, revision: ++revision };
      },
      changeProjectOrganisation: change => {
        settings = { ...settings, projectOrganisation: changeProjectOrganisation(settings.projectOrganisation ?? EMPTY_PROJECT_ORGANISATION,
          settings.pinnedProjects ?? {}, change as Parameters<typeof changeProjectOrganisation>[2]) };
        return { ...settings, revision: ++revision };
      },
      ...rpc,
    },
  });
}

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

describe("optional rail registration", () => {
  it("keeps the thread list and settings loadable on a BB without the extension", async () => {
    const app = await loadPluginApp(() => import("../../app"));
    expect(app.threadLists.map(slot => slot.id)).toEqual(["radar"]);
    expect(app.settingsSections.map(slot => slot.id)).toEqual(["radar"]);
    expect(registerProjectRail({} as PluginAppSlots)).toBe(false);
    expect(registerProjectRail({ experimental_navRailSection: true } as unknown as PluginAppSlots)).toBe(false);
  });

  it("registers the project contribution with the fork's public slot when available", () => {
    const register = vi.fn();
    const slots = { experimental_navRailSection: register };
    expect(registerProjectRail(slots as unknown as PluginAppSlots)).toBe(true);
    expect(register).toHaveBeenCalledExactlyOnceWith({ id: "projects", title: "Radar projects", component: RadarProjectRail });
    expect(register.mock.contexts).toEqual([slots]);
  });
});

describe("compact project rail", () => {
  it("shows live projects and saved empty pins without a Radar thread list", async () => {
    const slot = renderRail({ pinnedProjects: { c: true } });
    await act(async () => {});
    expect(slot.getByRole("button", { name: /^Empty project, 0 threads/ })).toBeTruthy();
    expect(slot.getByRole("button", { name: /^Learn Anything, 1 thread · 1 working · 1 unread/ })).toBeTruthy();
    expect(slot.getByRole("button", { name: /^bb-plus, 1 thread · 1 need input/ })).toBeTruthy();
    expect(slot.container.querySelector(".radar-project-tile-selected")).toBeNull();
  });

  it("portals the card, opens projects, and expands a collapsed host sidebar", async () => {
    const openSidebar = vi.fn();
    const slot = renderRail({}, { state: "collapsed", openSidebar });
    await act(async () => {});
    const trigger = slot.getByRole("button", { name: /^Learn Anything,/ });
    fireEvent.contextMenu(trigger);
    const card = await screen.findByRole("dialog", { name: "Learn Anything" });
    expect(slot.container.contains(card)).toBe(false);
    expect(within(card).queryByText("Hidden helper")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Open project" }));
    expect(openSidebar).toHaveBeenCalledOnce();
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toProject", projectId: "a" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens a project-scoped composer and recent threads through BB navigation", async () => {
    const slot = renderRail();
    await act(async () => {});
    fireEvent.click(slot.getByRole("button", { name: /^Learn Anything,/ }));
    fireEvent.click(await screen.findByRole("button", { name: "New thread" }));
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toCompose", options: { projectId: "a", focusPrompt: true } });
    fireEvent.click(slot.getByRole("button", { name: /^Learn Anything,/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Open Polish dashboard" }), { metaKey: true });
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "one", options: { split: true } });
  });

  it("returns keyboard focus to its tile on Escape and removes portals on unmount", async () => {
    const slot = renderRail();
    await act(async () => {});
    const trigger = slot.getByRole("button", { name: /^Learn Anything,/ });
    trigger.focus(); fireEvent.click(trigger);
    const card = await screen.findByRole("dialog", { name: "Learn Anything" });
    fireEvent.keyDown(card, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    slot.lifecycle.unmount();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("finds and pins a project without active threads", async () => {
    const slot = renderRail();
    await act(async () => {});
    expect(slot.queryByRole("button", { name: /^Empty project,/ })).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "All projects" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Find a project" }), { target: { value: "Empty" } });
    expect(screen.queryByRole("button", { name: "Pin bb-plus" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pin Empty project" }));
    await waitFor(() => expect(slot.inspection.rpcCalls).toContainEqual({ method: "setProjectPinned", input: { projectId: "c", pinned: true } }));
    await waitFor(() => expect(slot.getByRole("button", { name: /^Empty project, 0 threads/ })).toBeTruthy());
  });

  it("moves a project into a saved collection and restores it when the collection expands", async () => {
    const slot = renderRail({ projectOrganisation: { ...EMPTY_PROJECT_ORGANISATION,
      collections: { work: { name: "Work", collapsed: true } } } });
    await act(async () => {});
    fireEvent.click(slot.getByRole("button", { name: /^Learn Anything,/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Collection…" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Collection" }), { target: { value: "work" } });
    fireEvent.click(screen.getByRole("button", { name: "Save collection" }));
    await waitFor(() => expect(slot.queryByRole("button", { name: /^Learn Anything,/ })).toBeNull());
    fireEvent.click(slot.getByRole("button", { name: "Work collection, 1 project, collapsed" }));
    fireEvent.click(await screen.findByRole("button", { name: "Expand collection" }));
    await waitFor(() => expect(slot.getByRole("button", { name: /^Learn Anything,/ })).toBeTruthy());
  });

  it("changes pin order through the atomic layout operation", async () => {
    const slot = renderRail({ pinnedProjects: { a: true, b: true }, projectOrganisation: { ...EMPTY_PROJECT_ORGANISATION, pinOrder: ["a", "b"] } });
    await act(async () => {});
    fireEvent.click(slot.getByRole("button", { name: /^bb-plus,/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Move pin up" }));
    await waitFor(() => expect(slot.inspection.rpcCalls.some(call => call.method === "changeProjectOrganisation" &&
      JSON.stringify(call.input) === JSON.stringify({ kind: "move-pin", projectId: "b", beforeProjectId: "a" }))).toBe(true));
    await waitFor(() => expect(Array.from(slot.container.querySelectorAll(".radar-project-tile")).map(tile => tile.textContent)).toEqual([expect.stringContaining("BP"), expect.stringContaining("LA")]));
  });

  it("marks only visible unread project threads read", async () => {
    const markRead = vi.fn(async () => ({}));
    const slot = renderRail({}, {}, { threads: { markRead } });
    await act(async () => {});
    fireEvent.click(slot.getByRole("button", { name: /^Learn Anything,/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Mark project read" }));
    await waitFor(() => expect(markRead).toHaveBeenCalledExactlyOnceWith({ threadId: "one" }));
  });

  it("creates, renames and removes a collection without losing its project", async () => {
    const slot = renderRail();
    await act(async () => {});
    fireEvent.click(slot.getByRole("button", { name: /^Learn Anything,/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Collection…" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Collection" }), { target: { value: "new" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Collection name" }), { target: { value: "Research" } });
    fireEvent.click(screen.getByRole("button", { name: "Save collection" }));
    const collection = await slot.findByRole("button", { name: "Research collection, 1 project" });
    fireEvent.click(collection);
    fireEvent.change(await screen.findByRole("textbox", { name: "Collection name" }), { target: { value: "Learning" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename collection" }));
    await slot.findByRole("button", { name: "Learning collection, 1 project" });
    fireEvent.click(screen.getByRole("button", { name: "Remove collection" }));
    await waitFor(() => expect(slot.queryByRole("group", { name: "Learning collection" })).toBeNull());
    expect(slot.getByRole("button", { name: /^Learn Anything,/ })).toBeTruthy();
  });

  it("rolls a failed pin save back without keeping an empty project tile", async () => {
    const setProjectPinned = vi.fn(async () => { throw new Error("offline"); });
    const slot = renderRail({}, {}, {}, { setProjectPinned });
    await act(async () => {});
    fireEvent.click(slot.getByRole("button", { name: "All projects" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pin Empty project" }));
    await waitFor(() => expect(setProjectPinned).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole("button", { name: "Pin Empty project" }).hasAttribute("disabled")).toBe(false));
    expect(slot.queryByRole("button", { name: /^Empty project,/ })).toBeNull();
  });
});

describe("project selection filters the thread list", () => {
  const rowIds = (container: HTMLElement) => Array.from(container.querySelectorAll(".radar-list [data-sidebar-thread-id]"))
    .map(row => row.getAttribute("data-sidebar-thread-id"));

  it("filters by the clicked tile, switches projects, and clears back to all projects", async () => {
    const slot = renderRail({}, {}, {}, {}, true);
    await act(async () => {});
    expect(rowIds(slot.container).sort()).toEqual(["one", "two"]);
    fireEvent.click(slot.getByRole("button", { name: /^Learn Anything,/ }));
    expect(rowIds(slot.container)).toEqual(["one"]);
    expect(slot.getByRole("button", { name: /^Learn Anything,/ }).getAttribute("aria-pressed")).toBe("true");
    const card = await screen.findByRole("dialog", { name: "Learn Anything" });
    fireEvent.keyDown(card, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(slot.getByRole("button", { name: /^bb-plus,/ }));
    expect(rowIds(slot.container)).toEqual(["two"]);
    fireEvent.keyDown(await screen.findByRole("dialog", { name: "bb-plus" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(slot.getByRole("button", { name: "Show all projects" }));
    expect(rowIds(slot.container).sort()).toEqual(["one", "two"]);
    expect(slot.queryByRole("button", { name: "Show all projects" })).toBeNull();
    expect(slot.container.querySelector(".radar-project-tile-selected")).toBeNull();
    expect(slot.inspection.navigateCalls).toEqual([]);
  });

  it("opens a collapsed sidebar when selecting a project and retains the filter after remount", async () => {
    const openSidebar = vi.fn();
    const slot = renderRail({}, { state: "collapsed", openSidebar }, {}, {}, true);
    await act(async () => {});
    fireEvent.click(slot.getByRole("button", { name: /^bb-plus,/ }));
    expect(openSidebar).toHaveBeenCalledOnce();
    expect(rowIds(slot.container)).toEqual(["two"]);
    slot.lifecycle.unmount();
    const next = renderRail({}, {}, {}, {}, true);
    await act(async () => {});
    expect(rowIds(next.container)).toEqual(["two"]);
    expect(next.getByRole("button", { name: /^bb-plus,/ }).getAttribute("aria-pressed")).toBe("true");
    expect(next.getByLabelText("Project filter: bb-plus")).toBeTruthy();
  });

  it("selects an empty project from the picker without falling back to other projects' threads", async () => {
    const slot = renderRail({}, {}, {}, {}, true);
    await act(async () => {});
    fireEvent.click(slot.getByRole("button", { name: "All projects" }));
    fireEvent.click(await screen.findByRole("button", { name: "Empty project" }));
    expect(rowIds(slot.container)).toEqual([]);
    expect(slot.getByLabelText("Project filter: Empty project")).toBeTruthy();
    expect(slot.getByText("No threads yet.")).toBeTruthy();
    expect(slot.inspection.navigateCalls).toEqual([]);
    fireEvent.click(slot.getByRole("button", { name: "Show all projects" }));
    expect(rowIds(slot.container).sort()).toEqual(["one", "two"]);
  });

  it("keeps search and status filters within the selected project", async () => {
    const slot = renderRail({}, {}, {}, {}, true);
    await act(async () => {});
    fireEvent.click(slot.getByRole("button", { name: /^Learn Anything,/ }));
    fireEvent.keyDown(await screen.findByRole("dialog", { name: "Learn Anything" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.change(slot.getByRole("searchbox", { name: "Filter threads" }), { target: { value: "Review" } });
    await waitFor(() => expect(rowIds(slot.container)).toEqual([]));
    fireEvent.click(slot.getByRole("button", { name: "Clear filter" }));
    await waitFor(() => expect(rowIds(slot.container)).toEqual(["one"]));
    fireEvent.click(slot.getByRole("radio", { name: "Waiting" }));
    expect(rowIds(slot.container)).toEqual([]);
  });

  it("leaves Enter available for activating a pinned project's filter and card", async () => {
    const slot = renderRail({ pinnedProjects: { b: true } }, {}, {}, {}, true);
    await act(async () => {});
    const tile = slot.getByRole("button", { name: /^bb-plus,/ });
    tile.focus();
    expect(fireEvent.keyDown(tile, { key: "Enter", code: "Enter" })).toBe(true);
    // Browsers generate a native button click after an unhandled Enter key.
    fireEvent.click(tile);
    expect(rowIds(slot.container)).toEqual(["two"]);
    expect(await screen.findByRole("dialog", { name: "bb-plus" })).toBeTruthy();
    expect(slot.container.querySelector(".radar-project-tile-dragging")).toBeNull();
  });
});
