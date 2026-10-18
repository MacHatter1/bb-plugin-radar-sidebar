import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../server";
import { SETTINGS, SETTING_GROUPS } from "../../lib/settings";
import { resetSettings } from "./settingsStore";
import { makeProject, makeThread, NOW, HOUR } from "./fixtures";

const app = await loadPluginApp(() => import("../../app"));
const section = app.settingsSections[0]!;

type Change = { key: string; value: string | boolean };
function mount(settings: Record<string, string | boolean> = {}, setSetting = vi.fn(async (input: unknown) => { const { key, value } = input as Change; return { ...settings, [key]: value }; })) {
  const slot = renderSlot(section, {}, { settings, rpc: { getSettings: async () => settings, setSetting } });
  return { slot, setSetting };
}
const toggle = (label: string) => screen.getByRole("switch", { name: label });

afterEach(cleanup);

describe("settings section", () => {
  it("is registered with a heading", () => {
    expect(section.title).toBe("Radar Sidebar");
  });

  it("groups the settings into cards and shows every one once", () => {
    mount();
    expect(screen.getAllByRole("region").map((card) => card.getAttribute("aria-label"))).toEqual([
      "Thread rows", "Attention and feedback", "Swipe actions", "Plugin contributions",
    ]);
    const labels = Array.from(document.querySelectorAll(".radar-setting-label")).map((label) => label.textContent);
    expect(labels).toEqual(SETTING_GROUPS.flatMap((group) => group.keys.map((key) => SETTINGS[key].label)));
  });

  it("shows saved values and the defaults for the rest", () => {
    mount({ twoLineTitles: true, hoverCard: false, defaultDensity: "compact" });
    expect(toggle("Two-line titles").getAttribute("aria-checked")).toBe("true");
    expect(toggle("Hover peek card").getAttribute("aria-checked")).toBe("false");
    expect(toggle("Loud unread rows").getAttribute("aria-checked")).toBe("true");
    expect((screen.getByRole("combobox", { name: "Default row density" }) as HTMLSelectElement).value).toBe("compact");
  });

  it("saves a toggle and shows it at once", async () => {
    const { setSetting } = mount();
    fireEvent.click(toggle("Two-line titles"));
    expect(setSetting).toHaveBeenCalledWith({ key: "twoLineTitles", value: true });
    expect(toggle("Two-line titles").getAttribute("aria-checked")).toBe("true");
  });

  it("saves a choice from a select", () => {
    const { setSetting } = mount();
    fireEvent.change(screen.getByRole("combobox", { name: "Swipe left" }), { target: { value: "Pin / unpin" } });
    expect(setSetting).toHaveBeenCalledWith({ key: "swipeLeft", value: "Pin / unpin" });
  });

  it("saves the project family limit through host RPC and updates the sidebar store", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar" });
    try {
      await plugin(bb);
      localStorage.setItem("radar-sidebar:grouping:v1", "project");
      const rpc = {
        getSettings: () => harness.behavior.callRpc("getSettings"),
        setSetting: vi.fn((input: unknown) => harness.behavior.callRpc("setSetting", input)),
      };
      const settings = renderSlot(section, {}, { rpc });
      const list = renderSlot(app.threadLists[0]!, {
        activeThreadId: null,
        activeProjectId: "proj_a",
        isCompactViewport: false,
        onNavigate: () => {},
        searchQuery: "",
      }, {
        rpc,
        sidebarThreads: {
          status: "ready",
          threads: Array.from({ length: 5 }, (_, index) => makeThread({ id: `t${index}`, latestAttentionAt: NOW - index * HOUR })),
          projects: [makeProject({ id: "proj_a" })],
          sections: [],
          experimental_archived: null,
        },
      });
      await act(async () => {});
      const control = within(settings.container).getByRole("combobox", { name: "Threads per project" }) as HTMLSelectElement;
      expect(control.value).toBe("all");
      expect(Array.from(control.options, (option) => option.value)).toEqual(["all", "3", "5", "10"]);
      expect(list.container.querySelectorAll("[data-sidebar-thread-id]")).toHaveLength(5);
      fireEvent.change(control, { target: { value: "3" } });
      await waitFor(() => {
        expect(list.container.querySelectorAll("[data-sidebar-thread-id]")).toHaveLength(3);
        expect(rpc.setSetting).toHaveBeenCalledWith({ key: "projectThreadLimit", value: "3" });
        expect(JSON.parse(localStorage.getItem("radar-sidebar:settings:v1")!)).toEqual({ projectThreadLimit: "3" });
      });
      expect(await bb.storage.kv.get("settings")).toEqual({ projectThreadLimit: "3", revision: 1 });
      expect(within(list.container).getByRole("button", { name: "Show 2 more thread families" })).toBeTruthy();
      await expect(harness.behavior.callRpc("setSetting", { key: "projectThreadLimit", value: "4" })).rejects.toThrow("rpc input validation failed");
      fireEvent.change(control, { target: { value: "all" } });
      await waitFor(() => {
        expect(list.container.querySelectorAll("[data-sidebar-thread-id]")).toHaveLength(5);
        expect(JSON.parse(localStorage.getItem("radar-sidebar:settings:v1")!)).toEqual({ projectThreadLimit: "all" });
      });
      expect(await bb.storage.kv.get("settings")).toEqual({ projectThreadLimit: "all", revision: 2 });
    } finally {
      cleanup();
      localStorage.clear();
      await harness.lifecycle.dispose();
    }
  });

  it("greys out settings whose requirement is off, and says why", () => {
    mount({ swipeActions: false });
    for (const name of ["Swipe right", "Swipe left"]) {
      expect((screen.getByRole("combobox", { name }) as HTMLSelectElement).disabled).toBe(true);
    }
    expect(screen.getAllByText("Turn on Swipe actions first")).toHaveLength(2);
  });

  it("enables a dependent as soon as its requirement is switched on", () => {
    mount({ swipeActions: false });
    expect((screen.getByRole("combobox", { name: "Swipe right" }) as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(toggle("Swipe actions"));
    expect((screen.getByRole("combobox", { name: "Swipe right" }) as HTMLSelectElement).disabled).toBe(false);
  });

  it("offers no navigation rail settings: BB 0.46 owns navigation", () => {
    mount();
    expect(screen.queryByRole("switch", { name: "Navigation rail" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Project style" })).toBeNull();
  });

  it("puts a failed save back and says so", async () => {
    mount({}, vi.fn(async () => { throw new Error("nope"); }));
    fireEvent.click(toggle("Hover peek card"));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn’t save Hover peek card");
    expect(toggle("Hover peek card").getAttribute("aria-checked")).toBe("true");
  });
});

describe("settings previews", () => {
  it("follows the row settings", () => {
    mount({ defaultDensity: "compact", twoLineTitles: true, loudUnread: false });
    const list = document.querySelector(".radar-settings-list")!;
    expect(list.classList.contains("radar-density-compact")).toBe(true);
    expect(list.classList.contains("radar-title-wrap")).toBe(true);
    expect(list.getAttribute("data-radar-loud-unread")).toBe("off");
    expect(list.querySelector(".radar-row-collapsed")).not.toBeNull();
  });

  it("shows the attention glow only while Attention pulse is on", () => {
    mount({ motion: false });
    const lists = Array.from(document.querySelectorAll(".radar-settings-list"));
    const attention = lists.find((list) => list.querySelector(".radar-row-needs-user"))!;
    expect(attention.getAttribute("data-radar-motion")).toBe("off");
    cleanup();
    cleanup();
    resetSettings();
    mount();
    const again = Array.from(document.querySelectorAll(".radar-settings-list")).find((list) => list.querySelector(".radar-row-needs-user"))!;
    expect(again.getAttribute("data-radar-motion")).toBe("on");
  });

  it("names the chosen swipe actions and dims them when swiping is off", () => {
    mount({ swipeRight: "Pin / unpin", swipeActions: false });
    const swipe = document.querySelector(".radar-settings-swipe")!;
    expect(within(swipe as HTMLElement).getByText("Pin / unpin")).toBeTruthy();
    expect(within(swipe as HTMLElement).getByText("Archive / unarchive")).toBeTruthy();
    expect(swipe.classList.contains("radar-settings-swipe-off")).toBe(true);
  });
});
