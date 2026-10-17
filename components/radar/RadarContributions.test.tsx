// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { toast } from "sonner";
import { makeProject, makeThread } from "./fixtures";
import { seedSettings } from "./settingsStore";
import { EXPERIMENTAL_RADAR_METHODS as METHODS } from "../../packages/contributions/src/index";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const app = await loadPluginApp(() => import("../../app"));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

function fakes(options: { badgeCount?: number; confirmation?: string; fail?: boolean; multiple?: boolean } = {}) {
  const callRpc = vi.fn(async ({ method, input }: { method: string; input: { threadIds: string[] } }) => {
    if (options.fail) throw new Error("Team service offline");
    if (method === METHODS.action) return { message: "Team refreshed" };
    return { version: 1, threads: input.threadIds.map((threadId) => ({
      threadId,
      badges: Array.from({ length: options.badgeCount ?? 1 }, (_, i) => ({ id: `team-${i}`, label: `Build team ${i}`, text: "3", icon: "Users", tone: "info" })),
      actions: [
        { kind: "rpc", id: "refresh", label: "Refresh team", confirmation: options.confirmation },
        { kind: "link", id: "open", label: "Open team", href: "/plugins/teams/board/team-1" },
        { kind: "rpc", id: "blocked", label: "Blocked action", disabled: true },
      ],
    })) };
  });
  const sdk = {
    plugins: {
      experimental_discoverRpc: async () => [
        { pluginId: "teams", displayName: "Teams", method: METHODS.contributions },
        ...(options.multiple ? [{ pluginId: "qa", displayName: "QA", method: METHODS.contributions }] : []),
      ],
      callRpc,
    },
    threads: { defaultExecutionOptions: async () => null, context: async () => ({ usage: null }) },
    providers: { models: async () => ({ models: [] }) },
  };
  return { sdk, callRpc };
}
function mount(options: Parameters<typeof fakes>[0] = {}) {
  const { sdk, callRpc } = fakes(options);
  const slot = renderSlot(app.threadLists[0]!, {
    activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => {}, searchQuery: "",
  }, {
    rpc: { getSettings: async () => ({ revision: 0 }) },
    sdk: sdk as never,
    sidebarThreads: { status: "ready", threads: [makeThread({ id: "t1", isUnread: true, indicator: "unread-success", indicatorLabel: "Finished" })], projects: [makeProject({ id: "proj_a" })] },
  });
  return { slot, callRpc };
}
function openMenu(container: HTMLElement) {
  fireEvent.contextMenu(container.querySelector('[data-sidebar-thread-id="t1"]')!, { clientX: 100, clientY: 100 });
}

describe("rendered Radar contributions", () => {
  it("adds accessible badges without replacing BB's unread and status indicators", async () => {
    const { slot, callRpc } = mount();
    expect(await screen.findByRole("img", { name: "Teams: Build team 0" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Unread" })).toBeTruthy();
    expect(slot.container.querySelectorAll(".radar-row-status-badge")).toHaveLength(1);
    expect(callRpc).toHaveBeenCalledTimes(1);
  });

  it("bounds aggregate badge chrome and gives overflow an accessible description", async () => {
    const { slot } = mount({ badgeCount: 3, multiple: true });
    await waitFor(() => expect(slot.container.querySelector(".radar-contribution-overflow")?.textContent).toBe("+3"));
    expect(slot.container.querySelectorAll(".radar-contribution-badge")).toHaveLength(3);
    expect(slot.container.querySelector(".radar-contribution-overflow")?.getAttribute("aria-label")).toContain("Teams: Build team");
  });

  it("lets keyboard navigation reach contributed links as well as buttons", async () => {
    const { slot } = mount();
    await screen.findByRole("img", { name: "Teams: Build team 0" });
    openMenu(slot.container);
    const items = Array.from(screen.getByRole("menu").querySelectorAll<HTMLElement>("[data-menu-item]:not(:disabled)"));
    const link = screen.getByRole("menuitem", { name: "Teams: Open team" });
    const previous = items[items.indexOf(link) - 1]!;
    previous.focus();
    fireEvent.keyDown(previous, { key: "ArrowDown" });
    expect(document.activeElement).toBe(link);
  });

  it("renders owned menu links, disabled actions and explicitly activated RPC actions", async () => {
    const { slot, callRpc } = mount();
    await screen.findByRole("img", { name: "Teams: Build team 0" });
    openMenu(slot.container);
    const link = screen.getByRole("menuitem", { name: "Teams: Open team" });
    expect(link.getAttribute("href")).toBe("/plugins/teams/board/team-1");
    expect((screen.getByRole("menuitem", { name: "Teams: Blocked action" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Teams: Refresh team" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Team refreshed"));
    expect(callRpc.mock.calls.filter(([args]) => args.method === METHODS.action)).toHaveLength(1);
    expect(callRpc.mock.calls.find(([args]) => args.method === METHODS.action)![0]).toMatchObject({ input: { threadId: "t1", actionId: "refresh" } });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("respects a cancelled contributor confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { slot, callRpc } = mount({ confirmation: "Refresh this team?" });
    await screen.findByRole("img", { name: "Teams: Build team 0" });
    openMenu(slot.container);
    fireEvent.click(screen.getByRole("menuitem", { name: "Teams: Refresh team" }));
    expect(confirm).toHaveBeenCalledWith("Refresh this team?");
    expect(callRpc.mock.calls.filter(([args]) => args.method === METHODS.action)).toHaveLength(0);
  });

  it("removes badges and open-menu actions when a contributor is disabled", async () => {
    const { slot } = mount();
    await screen.findByRole("img", { name: "Teams: Build team 0" });
    openMenu(slot.container);
    expect(screen.getByRole("menuitem", { name: "Teams: Refresh team" })).toBeTruthy();
    await act(async () => { seedSettings({ disabledContributors: { teams: true } }); });
    expect(screen.queryByRole("img", { name: "Teams: Build team 0" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Teams: Refresh team" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Rename…" })).toBeTruthy();
  });

  it("leaves core navigation and actions usable when a contributor fails", async () => {
    const { slot, callRpc } = mount({ fail: true });
    await waitFor(() => expect(callRpc).toHaveBeenCalled());
    expect(slot.container.querySelector('[data-sidebar-thread-id="t1"]')).toBeTruthy();
    openMenu(slot.container);
    expect(screen.getByRole("menuitem", { name: "Rename…" })).toBeTruthy();
    expect(screen.queryByText("Plugin actions")).toBeNull();
  });

  it("reconciles on reconnect and stops polling after unmount", async () => {
    const { slot, callRpc } = mount();
    await screen.findByRole("img", { name: "Teams: Build team 0" });
    const initial = callRpc.mock.calls.length;
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    await slot.behavior.setRealtimeConnectionState("connected");
    await waitFor(() => expect(callRpc.mock.calls.length).toBeGreaterThan(initial));
    slot.lifecycle.unmount();
    const settled = callRpc.mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();
    expect(callRpc).toHaveBeenCalledTimes(settled);
  });

  it("discovers contributors in Settings and saves atomic shared toggles", async () => {
    const { sdk } = fakes();
    const save = vi.fn(async (input: unknown) => {
      const { pluginId, enabled } = input as { pluginId: string; enabled: boolean };
      return { revision: 1, disabledContributors: { [pluginId]: !enabled } };
    });
    renderSlot(app.settingsSections[0]!, {}, {
      sdk: sdk as never,
      rpc: { getSettings: async () => ({ revision: 0 }), setContributorEnabled: save },
    });
    const toggle = await screen.findByRole("switch", { name: "Teams" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    await waitFor(() => expect(save).toHaveBeenCalledWith({ pluginId: "teams", enabled: false }));
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(JSON.parse(localStorage.getItem("radar-sidebar:settings:v1")!).disabledContributors).toEqual({ teams: true });
  });
});
