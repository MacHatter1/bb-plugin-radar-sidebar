import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginBrowserBbSdk, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { makeProject, makeThread } from "./fixtures";
import { scheduledLabel } from "./useScheduledThreads";
import { seedSettings } from "./settingsStore";

type Message = Awaited<ReturnType<PluginBrowserBbSdk["threads"]["queue"]["list"]>>[number];
const sendAt = Date.now() + 3_600_000;
const scheduled = makeThread({ id: "scheduled", queuedWork: "waiting", indicator: "queued-waiting", indicatorLabel: "Queued work" });
const message = (threadId: string, at: number | null = sendAt): Message => ({
  id: `q-${threadId}-${at}`, threadId, sendAt: at, failureReason: null,
  content: [], createdAt: 1, updatedAt: 1, editable: true, groupWithNext: false,
  initiator: "user", model: "model", origin: null, originPluginId: null,
  payload: { kind: "inline" }, permissionMode: "auto", reasoningLevel: "none",
  senderThreadId: null, serviceTier: "default", waitingOn: at === null ? { kind: "thread-busy" } : { kind: "time" },
});
const app = await loadPluginApp(() => import("../../app"));
function mountRail(threads: PluginSidebarThread[], messages: Message[], style = "Tiles") {
  seedSettings({ railNav: true });
  return renderSlot(app.experimentalSidebarNavigations[0]!, {
    isCompactViewport: false, experimental_Original: () => null,
  }, {
    sdk: { threads: { queue: { list: async () => messages } } },
    settings: { railNav: true, projectStyle: style },
    sidebarThreads: { status: "ready", threads, projects: [makeProject({ id: "proj_a", name: "Scheduled project" })], sections: [] },
  });
}
function mount(threads: PluginSidebarThread[], messages: Message[]) {
  return renderSlot(app.threadLists[0]!, {
    activeThreadId: null, activeProjectId: "proj_a", isCompactViewport: false,
    onNavigate: () => {}, searchQuery: "",
  }, {
    sdk: {
      threads: {
        queue: { list: async () => messages },
        defaultExecutionOptions: async () => null,
        context: async () => ({ usage: null }),
      },
    },
    sidebarThreads: { status: "ready", threads, projects: [makeProject({ id: "proj_a" })], sections: [] },
  });
}
beforeAll(() => { Element.prototype.scrollIntoView = () => {}; });
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

describe("scheduled thread display", () => {
  it("shows a calm clock, Scheduled label and local run time", async () => {
    const slot = mount([scheduled], [message(scheduled.id)]);
    await act(async () => {});
    const row = slot.container.querySelector('[data-sidebar-thread-id="scheduled"]')!;
    expect(row.querySelector(".radar-status-word")?.textContent).toBe("Scheduled");
    expect(row.querySelector(".radar-status-icon.radar-tone-info")).not.toBeNull();
    expect(row.querySelector(".radar-row-status-badge")?.getAttribute("title")).toBe(scheduledLabel(sendAt));
    expect(row.closest(".radar-row")?.classList.contains("radar-row-pulse-amber")).toBe(false);
    expect(row.getAttribute("aria-label")).toContain(scheduledLabel(sendAt));
    expect(slot.container.querySelector(".radar-group-status")?.getAttribute("aria-label")).toBe("1 scheduled");
  });

  it("keeps ordinary queued work amber when the same thread has a scheduled item", async () => {
    const slot = mount([scheduled], [message(scheduled.id), message(scheduled.id, null)]);
    await act(async () => {});
    expect(screen.queryByText("Scheduled")).toBeNull();
    expect(screen.getByText("Queued")).not.toBeNull();
    expect(slot.container.querySelector(".radar-row-pulse-amber")).not.toBeNull();
  });

  it.each(["family", "group"])("keeps scheduled child work distinct in a folded %s", async fold => {
    const slot = mount([makeThread({ id: "parent" }), { ...scheduled, parentThreadId: "parent" }], [message(scheduled.id)]);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: fold === "family" ? "Collapse replies" : "Collapse all folders" }));
    expect(slot.container.querySelector(".radar-group-status")?.getAttribute("aria-label")).toBe("1 scheduled");
    if (fold === "family") {
      const pill = slot.container.querySelector('[data-sidebar-thread-id="parent"] .radar-kids-pill')!;
      expect(pill.getAttribute("aria-label")).toContain("scheduled work");
      expect(pill.querySelector(".radar-tone-info")).not.toBeNull();
      expect(pill.querySelector(".radar-dot-attention")).toBeNull();
    }
  });

  it("preserves failures, input waits and running indicators ahead of scheduled work", async () => {
    const states = [
      { id: "failed", indicator: "queued-failed" as const, queuedWork: "failed" as const },
      { id: "input", indicator: "waiting-for-input" as const, hasPendingInteraction: true },
      { id: "runtime", indicator: "runtime" as const, status: "active" as const },
    ];
    const slot = mount([scheduled, ...states.map(state => makeThread({ queuedWork: "waiting", ...state }))],
      [message(scheduled.id), ...states.map(state => message(state.id))]);
    await act(async () => {});
    for (const [id, label] of [["failed", "Failed"], ["input", "Needs you"], ["runtime", "Working"]]) {
      expect(slot.container.querySelector(`[data-sidebar-thread-id="${id}"] .radar-status-word`)?.textContent).toBe(label);
    }
    expect(slot.container.querySelector(".radar-group-status")?.getAttribute("aria-label")).toBe("1 failed");
  });
});

describe("scheduled project rail display", () => {
  const tile = () => screen.getByRole("button", { name: "Scheduled project: show only this project" });

  it.each(["Tiles", "Rings", "Chips"])("replaces the yellow waiting state with a static clock in %s", async style => {
    mountRail([scheduled], [message(scheduled.id)], style);
    await act(async () => {});
    expect(tile().className).toContain("radar-rail-state-scheduled");
    expect(tile().className).not.toContain("radar-rail-state-waiting");
    expect(tile().querySelector(".radar-rail-badge-scheduled")?.textContent).toBe("1");
    expect(tile().querySelector('.radar-rail-badge-scheduled [data-icon="Clock"]')).not.toBeNull();
    expect(tile().querySelector(".radar-rail-badge-waiting")).toBeNull();
    expect(tile().querySelector(".radar-rail-badge-active")).toBeNull();
    expect(tile().querySelector(".radar-rail-ring-waiting")).toBeNull();
    expect(tile().getAttribute("aria-description")).toBe("1 thread · 1 scheduled");
  });

  it("keeps genuine waiting and working counts separate from scheduled work", async () => {
    mountRail([
      scheduled,
      makeThread({ id: "input", indicator: "waiting-for-input", hasPendingInteraction: true }),
      makeThread({ id: "running", status: "active", indicator: "runtime" }),
      makeThread({ id: "queued", indicator: "queued-waiting", queuedWork: "waiting" }),
    ], [message(scheduled.id), message("queued", null)]);
    await act(async () => {});
    expect(tile().querySelector(".radar-rail-badge-waiting")?.textContent).toBe("2");
    expect(tile().querySelector(".radar-rail-badge-active")?.textContent).toBe("1");
    expect(tile().querySelector(".radar-rail-badge-scheduled")?.textContent).toBe("1");
    expect(tile().getAttribute("aria-description")).toBe("4 threads · 2 waiting · 1 scheduled · 3 live");
  });

  it("leaves mixed immediate/scheduled items in the ordinary queue", async () => {
    mountRail([scheduled], [message(scheduled.id), message(scheduled.id, null)]);
    await act(async () => {});
    expect(tile().querySelector(".radar-rail-badge-waiting")?.textContent).toBe("1");
    expect(tile().querySelector(".radar-rail-badge-scheduled")).toBeNull();
  });

  it("restores the queued badge when scheduled work becomes due", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(sendAt - 500);
    mountRail([scheduled], [message(scheduled.id)]);
    await act(async () => {});
    expect(tile().querySelector(".radar-rail-badge-scheduled")).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(tile().querySelector(".radar-rail-badge-scheduled")).toBeNull();
    expect(tile().querySelector(".radar-rail-badge-waiting")?.textContent).toBe("1");
  });
});
