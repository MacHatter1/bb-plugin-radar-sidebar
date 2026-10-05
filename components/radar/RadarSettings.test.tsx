import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { SETTINGS, SETTING_GROUPS } from "../../lib/settings";
import { resetSettings } from "./settingsStore";

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
      "Navigation rail", "Thread rows", "Attention and feedback", "Swipe actions",
    ]);
    const labels = Array.from(document.querySelectorAll(".radar-setting-label")).map((label) => label.textContent);
    expect(labels).toEqual(SETTING_GROUPS.flatMap((group) => group.keys.map((key) => SETTINGS[key].label)));
  });

  it("shows saved values and the defaults for the rest", () => {
    mount({ railNav: true, projectBadges: false, defaultDensity: "compact" });
    expect(toggle("Navigation rail").getAttribute("aria-checked")).toBe("true");
    expect(toggle("Project badges").getAttribute("aria-checked")).toBe("false");
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

  it("greys out settings whose requirement is off, and says why", () => {
    mount();
    for (const label of ["Labelled rail (experimental)", "Project badges"]) {
      expect((toggle(label) as HTMLButtonElement).disabled).toBe(true);
    }
    expect((screen.getByRole("combobox", { name: "Project style" }) as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getAllByText("Turn on Navigation rail first")).toHaveLength(3);
    expect((screen.getByRole("combobox", { name: "Swipe right" }) as HTMLSelectElement).disabled).toBe(false);
  });

  it("enables them once the requirement is on", () => {
    mount({ railNav: true, swipeActions: false });
    expect((toggle("Project badges") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("combobox", { name: "Swipe right" }) as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getAllByText("Turn on Swipe actions first")).toHaveLength(2);
  });

  it("enables a dependent as soon as its requirement is switched on", () => {
    mount();
    expect((toggle("Project badges") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(toggle("Navigation rail"));
    expect((toggle("Project badges") as HTMLButtonElement).disabled).toBe(false);
  });

  it("puts a failed save back and says so", async () => {
    mount({}, vi.fn(async () => { throw new Error("nope"); }));
    fireEvent.click(toggle("Hover peek card"));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn’t save Hover peek card");
    expect(toggle("Hover peek card").getAttribute("aria-checked")).toBe("true");
  });
});

describe("settings previews", () => {
  const railTiles = () => Array.from(document.querySelectorAll(".radar-settings-rail .radar-rail-label")).map((label) => label.textContent);

  it("shows navigation above the list while the rail is off", () => {
    mount();
    expect(screen.getByText("Navigation sits above the list")).toBeTruthy();
    expect(document.querySelector(".radar-settings-rail")).toBeNull();
  });

  it("shows the rail with badges and the needs-you project on top", () => {
    mount({ railNav: true });
    expect(railTiles()).toEqual(["api-server", "bb-appimage", "docs-site"]);
    expect(document.querySelectorAll(".radar-settings-rail .radar-rail-badge-waiting")).toHaveLength(1);
    expect(document.querySelector(".radar-settings-rail .radar-double-navigation-wide")).toBeNull();
  });

  it("drops the badges and the ordering when Project badges is off", () => {
    mount({ railNav: true, projectBadges: false });
    expect(railTiles()).toEqual(["bb-appimage", "docs-site", "api-server"]);
    expect(document.querySelector(".radar-settings-rail .radar-rail-badges")).toBeNull();
  });

  it("widens the preview rail with Labelled rail", () => {
    mount({ railNav: true, wideRail: true });
    expect(document.querySelector(".radar-settings-rail.radar-double-navigation-wide")).not.toBeNull();
  });

  it.each([
    ["Tiles", ".radar-rail-monogram", ".radar-rail-ring"],
    ["Rings", ".radar-rail-ring", ".radar-rail-monogram"],
    ["Chips", ".radar-rail-chip", ".radar-rail-monogram"],
  ])("draws the preview projects in the %s style", (style, present, absent) => {
    mount({ railNav: true, projectStyle: style });
    const preview = document.querySelector(".radar-settings-rail")!;
    expect(preview.querySelector(present)).not.toBeNull();
    expect(preview.querySelector(absent)).toBeNull();
  });

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
