import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginBrowserBbSdk, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { makeProject, makeThread } from "./fixtures";
import { scheduledLabel } from "./useScheduledThreads";

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
