// @vitest-environment jsdom
import { act, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { createElement, Fragment, type FunctionComponent } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import * as pluginSdk from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread, PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";
import { DAY, HOUR, NOW, makeProject, makeSection, makeThread } from "./fixtures";

// Expose configurable test exports while retaining the SDK's slot runtime.
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...await importOriginal<typeof pluginSdk>(),
}));

const app = await loadPluginApp(() => import("../../app"));
const threadList = app.threadLists[0]!;

/** Stub the SDK areas the list touches. Intentionally partial: only the
 * methods under test are implemented, and the cast keeps the harness's
 * exhaustive fake tree from dictating fixtures this suite never calls. */
function sdkFakes(
  execution: Record<string, unknown> | null = null,
): Record<string, unknown> {
  return {
    threads: {
      defaultExecutionOptions: async () => execution,
      update: async () => ({ ok: true }),
      unarchive: async () => ({ ok: true }),
      markRead: async () => ({ ok: true }),
      context: async () => ({ usage: null }),
    },
    providers: { models: async () => ({ models: [] }) },
    system: {
      uiPreferences: {
        list: async () => ({ preferences: {} }),
        set: async () => ({ revision: 1, value: [] }),
      },
    },
  };
}

function renderThreads(
  threads: PluginSidebarThread[],
  options: {
    settings?: Record<string, string | number | boolean>;
    projects?: ReturnType<typeof makeProject>[];
    sections?: ReturnType<typeof makeSection>[];
    execution?: Record<string, unknown> | null;
    archived?: PluginSidebarThreadsState["experimental_archived"];
    sdk?: Record<string, unknown>;
  } = {},
) {
  return renderSlot(
    threadList,
    {
      activeThreadId: null,
      activeProjectId: "proj_a",
      isCompactViewport: false,
      onNavigate: () => {},
      searchQuery: "",
    },
    {
      sdk: sdkFakes(options.execution),
      ...options,
      sidebarThreads: {
        status: "ready",
        threads,
        projects: options.projects ?? [makeProject({ id: "proj_a" })],
        sections: options.sections ?? [],
        experimental_archived: options.archived ?? null,
      },
    },
  );
}

/** Row anchors are the stable handle: ThreadTitle renders empty in the
 * harness, so title text is not queryable — the id attribute is. */
function visibleRowIds(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll("[data-sidebar-thread-id]"),
  ).map((node) => node.getAttribute("data-sidebar-thread-id") ?? "");
}

// jsdom has no layout, so keyboard navigation has nothing to scroll.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("grouping", () => {
  it("groups by activity so merely reading a thread does not float it to Today", () => {
    const visited = makeThread({
      id: "visited",
      title: "Old but just opened",
      updatedAt: NOW,
      lastReadAt: NOW,
      latestAttentionAt: NOW - 60 * DAY,
    });
    renderThreads([visited]);

    expect(screen.getByText("Old but just opened")).toBeTruthy();
    // It must sit under "Older", never under Today.
    const headers = screen
      .getAllByText(/today|yesterday|previous|older/i)
      .map((node) => node.textContent);
    expect(headers).toContain("Older");
    expect(headers).not.toContain("Today");
  });

  it("floats a working thread into Today", () => {
    const working = makeThread({
      id: "working",
      title: "Currently running",
      status: "active",
      indicator: "runtime",
      latestAttentionAt: NOW - 60 * DAY,
    });
    renderThreads([working]);
    const headers = screen
      .getAllByText(/today|yesterday|previous|older/i)
      .map((node) => node.textContent);
    expect(headers).toContain("Today");
  });
});

describe("thread families", () => {
  it("nests a child under its parent instead of listing it separately", () => {
    const parent = makeThread({ id: "p", title: "Parent task" });
    const child = makeThread({ id: "c", title: "Child task", parentThreadId: "p" });
    renderThreads([child, parent]);

    const rows = screen.getAllByRole("link");
    const titles = rows.map((row) => row.getAttribute("aria-label") ?? "");
    // DOM order: parent immediately followed by its child.
    const parentIndex = titles.findIndex((t) => t.startsWith("Parent task"));
    expect(parentIndex).toBeGreaterThanOrEqual(0);
    expect(titles[parentIndex + 1]?.startsWith("Child task")).toBe(true);
  });

  it("folds descendants away when the parent collapses", async () => {
    const parent = makeThread({ id: "p", title: "Family head" });
    const child = makeThread({ id: "c", title: "Hidden kid", parentThreadId: "p" });
    const slot = renderThreads([parent, child]);

    expect(visibleRowIds(slot.container)).toEqual(["p", "c"]);

    fireEvent.click(screen.getByRole("button", { name: "Collapse replies" }));

    // Folded rows stay mounted so the collapse can animate both ways; they
    // are hidden via visibility, which also drops them from tab order.
    const fold = await waitFor(() => {
      const node = slot.container.querySelector(".radar-fold-collapsed");
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    expect(fold.getAttribute("aria-hidden")).toBe("true");
    expect(
      fold.querySelector('[data-sidebar-thread-id="c"]'),
    ).not.toBeNull();
  });

  it("announces a fold only when it hides something that matters", async () => {
    const parent = makeThread({ id: "p", title: "Family head" });
    const quiet = makeThread({ id: "q", title: "Quiet kid", parentThreadId: "p" });
    const loud = makeThread({
      id: "u",
      title: "Unseen kid",
      parentThreadId: "p",
      isUnread: true,
      indicator: "unread-success",
    });
    const slot = renderThreads([parent, quiet, loud]);

    // Nothing announced while open.
    expect(slot.container.querySelector(".radar-kids-pill")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Collapse replies" }));
    await waitFor(() =>
      expect(slot.container.querySelector(".radar-fold-collapsed")).toBeTruthy(),
    );

    // One hidden row is unseen, so the pill appears and counts it.
    const pill = slot.container.querySelector(".radar-kids-pill");
    expect(pill?.textContent).toContain("1");
  });

  it("unfolds back to the full family", async () => {
    const parent = makeThread({ id: "p", title: "Family head" });
    const child = makeThread({ id: "c", title: "Shown kid", parentThreadId: "p" });
    const slot = renderThreads([parent, child]);

    fireEvent.click(screen.getByRole("button", { name: "Collapse replies" }));
    await waitFor(() =>
      expect(slot.container.querySelector(".radar-fold-collapsed")).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand replies" }));
    await waitFor(() =>
      expect(
        slot.container.querySelector(".radar-fold-collapsed"),
      ).toBeNull(),
    );
    expect(visibleRowIds(slot.container)).toEqual(["p", "c"]);
  });

  it("promotes an orphan whose parent is absent to a root row", () => {
    const orphan = makeThread({
      id: "orphan",
      title: "Parentless child",
      parentThreadId: "does-not-exist",
    });
    renderThreads([orphan]);
    expect(screen.getByText("Parentless child")).toBeTruthy();
  });
});

describe("filtering", () => {
  it("keeps a matching child's ancestor context", () => {
    const parent = makeThread({ id: "p", title: "Umbrella" });
    const child = makeThread({
      id: "c",
      title: "Needle finding",
      parentThreadId: "p",
    });
    const slot = renderThreads([parent, child]);

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "needle" },
    });

    // Child matches, so both it and its parent stay rendered.
    expect(visibleRowIds(slot.container)).toEqual(["p", "c"]);
  });

  it("drops an ancestor branch that matches nothing", () => {
    const parent = makeThread({ id: "p", title: "Umbrella" });
    const child = makeThread({
      id: "c",
      title: "Needle finding",
      parentThreadId: "p",
    });
    const other = makeThread({ id: "x", title: "Unrelated" });
    const slot = renderThreads([parent, child, other]);

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "needle" },
    });

    expect(visibleRowIds(slot.container)).not.toContain("x");
  });

  it("matches case-insensitively against a capitalised title", () => {
    // Regression: `.toLowerCase()` once bound to only the last fragment of
    // the haystack, so lowercase queries never matched real titles.
    const thread = makeThread({ id: "t", title: "Umbrella Solo" });
    const slot = renderThreads([thread]);

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "umbrella" },
    });

    expect(visibleRowIds(slot.container)).toEqual(["t"]);
  });

  it("says so when nothing matches", () => {
    renderThreads([makeThread({ id: "p", title: "Only one" })]);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "zzzzz" },
    });
    expect(screen.getByText(/No threads match/)).toBeTruthy();
  });
});

describe("actions", () => {
  it("routes the archive hover action through the host", () => {
    const thread = makeThread({ id: "t", title: "Archive me" });
    const slot = renderThreads([thread]);

    fireEvent.click(screen.getByLabelText("Archive thread"));
    expect(slot.inspection.sidebarActionCalls).toContainEqual({
      method: "archive",
      threadId: "t",
    });
  });

  it("routes pin through the host with the toggled state", () => {
    const thread = makeThread({ id: "t", title: "Pin me" });
    const slot = renderThreads([thread]);

    fireEvent.click(screen.getByLabelText("Pin thread"));
    expect(slot.inspection.sidebarActionCalls).toContainEqual({
      method: "setPinned",
      threadId: "t",
      pinned: true,
    });
  });
});

describe("swipe actions", () => {
  const row = (container: HTMLElement) =>
    container.querySelector(".radar-row") as HTMLElement;

  function swipe(container: HTMLElement, dx: number, dy = 0) {
    const target = row(container);
    fireEvent.touchStart(target, { touches: [{ clientX: 150, clientY: 20 }] });
    // Two steps: the first (just past the slop) decides swipe versus scroll.
    const step = 12 / Math.max(Math.abs(dx), Math.abs(dy));
    fireEvent.touchMove(target, {
      touches: [{ clientX: 150 + dx * step, clientY: 20 + dy * step }],
    });
    fireEvent.touchMove(target, {
      touches: [{ clientX: 150 + dx, clientY: 20 + dy }],
    });
    fireEvent.touchEnd(target, { touches: [] });
  }

  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get: () => 300,
    });
  });

  it("marks read on a right swipe by default", () => {
    const slot = renderThreads([
      makeThread({ id: "t", lastReadAt: null, latestAttentionAt: NOW }),
    ]);
    swipe(slot.container, 160);
    expect(slot.inspection.sidebarActionCalls).toContainEqual(
      expect.objectContaining({ method: "setRead", threadId: "t" }),
    );
  });

  it("slides the row away, then archives on a left swipe by default", () => {
    vi.useFakeTimers();
    try {
      const slot = renderThreads([makeThread({ id: "t" })]);
      swipe(slot.container, -160);
      expect(row(slot.container).dataset.swipePhase).toBe("out");
      expect(slot.inspection.sidebarActionCalls).toEqual([]);
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(slot.inspection.sidebarActionCalls).toContainEqual({
        method: "archive",
        threadId: "t",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the configured action for each side", () => {
    const slot = renderThreads([makeThread({ id: "t" })], {
      settings: { swipeLeft: "Pin / unpin" },
    });
    swipe(slot.container, -160);
    expect(slot.inspection.sidebarActionCalls).toContainEqual({
      method: "setPinned",
      threadId: "t",
      pinned: true,
    });
  });

  it("does not treat a quick drag that then rests as a flick", () => {
    vi.useFakeTimers();
    try {
      const slot = renderThreads([makeThread({ id: "t" })]);
      const target = row(slot.container);
      fireEvent.touchStart(target, { touches: [{ clientX: 150, clientY: 20 }] });
      for (let x = 138; x >= 90; x -= 12) {
        fireEvent.touchMove(target, { touches: [{ clientX: x, clientY: 20 }] });
        act(() => {
          vi.advanceTimersByTime(16);
        });
      }
      // Rest, then lift: short of the threshold, so nothing happens.
      act(() => {
        vi.advanceTimersByTime(400);
      });
      fireEvent.touchEnd(target, { touches: [] });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(slot.inspection.sidebarActionCalls).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("springs back without acting on a short drag", () => {
    const slot = renderThreads([makeThread({ id: "t" })]);
    swipe(slot.container, -30);
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
    expect(row(slot.container).dataset.swipePhase).toBe("settle");
  });

  it("leaves vertical movement to the scroller", () => {
    const slot = renderThreads([makeThread({ id: "t" })]);
    swipe(slot.container, -20, 160);
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
    expect(row(slot.container).dataset.swipePhase).toBeUndefined();
  });

  /** A two-finger trackpad stream: pixel wheel events, ~16ms apart. */
  function wheelSwipe(container: HTMLElement, dx: number, dy = 0, steps = 10) {
    const target = row(container);
    for (let i = 0; i < steps; i += 1) {
      // Content-style deltas: fingers moving left scroll content right (+x).
      fireEvent.wheel(target, { deltaX: -dx / steps, deltaY: dy / steps, deltaMode: 0 });
      act(() => {
        vi.advanceTimersByTime(16);
      });
    }
  }

  /** The fade-out a trackpad sends after the fingers lift mid-flick. */
  function momentumTail(container: HTMLElement, direction: number) {
    const target = row(container);
    for (let d = 8; d >= 0.8; d *= 0.7) {
      fireEvent.wheel(target, { deltaX: -direction * d, deltaMode: 0 });
      act(() => {
        vi.advanceTimersByTime(16);
      });
    }
  }

  it("rests a stopped trackpad swipe open, then follows on", () => {
    vi.useFakeTimers();
    try {
      const slot = renderThreads([makeThread({ id: "t" })], {
        settings: { swipeLeft: "Pin / unpin" },
      });
      wheelSwipe(slot.container, -60);
      // Resting fingers: no decision, the row just settles open.
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(row(slot.container).dataset.swipePhase).toBe("open");
      expect(row(slot.container).style.transform).toContain("-96px");
      expect(slot.inspection.sidebarActionCalls).toEqual([]);
      // Moving again carries on from there.
      wheelSwipe(slot.container, -100);
      momentumTail(slot.container, -1);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(slot.inspection.sidebarActionCalls).toEqual([
        { method: "setPinned", threadId: "t", pinned: true },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  function openWithTrackpad(container: HTMLElement) {
    wheelSwipe(container, -60);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
  }

  it("runs the action from an open row's button", () => {
    vi.useFakeTimers();
    try {
      const slot = renderThreads([makeThread({ id: "t" })], {
        settings: { swipeLeft: "Pin / unpin" },
      });
      openWithTrackpad(slot.container);
      const button = slot.container.querySelector(".radar-swipe-underlay") as HTMLElement;
      fireEvent.pointerDown(button);
      fireEvent.click(button);
      expect(slot.inspection.sidebarActionCalls).toEqual([
        { method: "setPinned", threadId: "t", pinned: true },
      ]);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(row(slot.container).dataset.swipePhase).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["press elsewhere", "press on the row", "Escape", "scroll"])(
    "closes an open row on %s without acting",
    (how) => {
      vi.useFakeTimers();
      try {
        const slot = renderThreads([makeThread({ id: "t" })], {
          settings: { swipeLeft: "Pin / unpin" },
        });
        openWithTrackpad(slot.container);
        const anchor = slot.container.querySelector("[data-sidebar-thread-id]") as HTMLElement;
        if (how === "press elsewhere") fireEvent.pointerDown(document.body);
        if (how === "press on the row") {
          fireEvent.pointerDown(anchor);
          fireEvent.click(anchor);
        }
        if (how === "Escape") fireEvent.keyDown(document, { key: "Escape" });
        if (how === "scroll") {
          fireEvent.scroll(slot.container.querySelector(".radar-list-body") as HTMLElement);
        }
        act(() => {
          vi.advanceTimersByTime(1000);
        });
        expect(row(slot.container).dataset.swipePhase).toBeUndefined();
        // The harness's split-drag stand-in logs any press on a row link as
        // "open"; the real host only drags once the pointer leaves the list.
        expect(
          slot.inspection.sidebarActionCalls.filter((call) => call.method !== "open"),
        ).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("keeps only one row open", () => {
    vi.useFakeTimers();
    try {
      const slot = renderThreads(
        [makeThread({ id: "a" }), makeThread({ id: "b" })],
        { settings: { swipeLeft: "Pin / unpin" } },
      );
      const rows = () =>
        Array.from(slot.container.querySelectorAll(".radar-row")) as HTMLElement[];
      const open = (target: HTMLElement) => {
        for (let i = 0; i < 10; i += 1) {
          fireEvent.wheel(target, { deltaX: 6, deltaMode: 0 });
          act(() => {
            vi.advanceTimersByTime(16);
          });
        }
        act(() => {
          vi.advanceTimersByTime(1500);
        });
      };
      open(rows()[0]);
      expect(rows()[0].dataset.swipePhase).toBe("open");
      open(rows()[1]);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(rows()[1].dataset.swipePhase).toBe("open");
      expect(rows()[0].dataset.swipePhase).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases a trackpad flick as soon as its momentum fades", () => {
    vi.useFakeTimers();
    try {
      const slot = renderThreads([makeThread({ id: "t" })], {
        settings: { swipeLeft: "Pin / unpin" },
      });
      wheelSwipe(slot.container, -160);
      momentumTail(slot.container, -1);
      expect(slot.inspection.sidebarActionCalls).toEqual([]);
      act(() => {
        vi.advanceTimersByTime(120);
      });
      expect(slot.inspection.sidebarActionCalls).toEqual([
        { method: "setPinned", threadId: "t", pinned: true },
      ]);

      // Stragglers from the tail must not start a second swipe.
      for (let i = 0; i < 20; i += 1) {
        fireEvent.wheel(row(slot.container), { deltaX: 6, deltaMode: 0 });
        act(() => {
          vi.advanceTimersByTime(16);
        });
      }
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(slot.inspection.sidebarActionCalls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a trackpad swipe going after the row slides out from under the cursor", () => {
    vi.useFakeTimers();
    try {
      const slot = renderThreads([makeThread({ id: "t" })], {
        settings: { swipeLeft: "Pin / unpin" },
      });
      // Starts over the row...
      wheelSwipe(slot.container, -40, 0, 4);
      expect(row(slot.container).dataset.swipePhase).toBe("drag");
      // ...then the cursor is over the list body instead.
      const elsewhere = slot.container.querySelector(".radar-list-body") as HTMLElement;
      for (let i = 0; i < 10; i += 1) {
        fireEvent.wheel(elsewhere, { deltaX: 16, deltaMode: 0 });
        act(() => {
          vi.advanceTimersByTime(16);
        });
      }
      expect(row(slot.container).style.transform).toContain("-200px");
      momentumTail(slot.container, -1);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(slot.inspection.sidebarActionCalls).toEqual([
        { method: "setPinned", threadId: "t", pinned: true },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("springs back from a third of the row on a trackpad", () => {
    vi.useFakeTimers();
    try {
      const slot = renderThreads([makeThread({ id: "t" })], {
        settings: { swipeLeft: "Pin / unpin" },
      });
      wheelSwipe(slot.container, -100);
      expect("swipeArmed" in row(slot.container).dataset).toBe(false);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(slot.inspection.sidebarActionCalls).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("decides an abrupt stop only after a longer pause", () => {
    vi.useFakeTimers();
    try {
      const slot = renderThreads([makeThread({ id: "t" })], {
        settings: { swipeLeft: "Pin / unpin" },
      });
      wheelSwipe(slot.container, -200);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(slot.inspection.sidebarActionCalls).toEqual([]);
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(slot.inspection.sidebarActionCalls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves vertical trackpad scrolling to the list", () => {
    vi.useFakeTimers();
    try {
      const slot = renderThreads([makeThread({ id: "t" })]);
      wheelSwipe(slot.container, -20, 200);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(slot.inspection.sidebarActionCalls).toEqual([]);
      expect(row(slot.container).dataset.swipePhase).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores pinch-zoom and line-stepped mouse wheels", () => {
    vi.useFakeTimers();
    try {
      const slot = renderThreads([makeThread({ id: "t" })]);
      const target = row(slot.container);
      for (let i = 0; i < 10; i += 1) {
        fireEvent.wheel(target, { deltaX: 30, ctrlKey: true, deltaMode: 0 });
        fireEvent.wheel(target, { deltaX: 3, deltaMode: 1 });
      }
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(slot.inspection.sidebarActionCalls).toEqual([]);
      expect(target.dataset.swipePhase).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("turning swipe actions off stops trackpad swipes too", () => {
    vi.useFakeTimers();
    try {
      const slot = renderThreads([makeThread({ id: "t" })], {
        settings: { swipeActions: false },
      });
      wheelSwipe(slot.container, -160);
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(slot.inspection.sidebarActionCalls).toEqual([]);
      expect(row(slot.container).dataset.swipePhase).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing when turned off", () => {
    const slot = renderThreads([makeThread({ id: "t" })], {
      settings: { swipeActions: false },
    });
    swipe(slot.container, -160);
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
    expect(row(slot.container).dataset.swipePhase).toBeUndefined();
    expect(slot.container.querySelector("[data-radar-swipe=\"off\"]")).not.toBeNull();
  });
});

describe("density", () => {
  const root = (slot: { container: HTMLElement }) =>
    slot.container.querySelector(".radar-list") as HTMLElement;

  it("follows the server default when nothing was chosen locally", () => {
    const slot = renderThreads([makeThread({ id: "t", title: "One" })], {
      settings: { defaultDensity: "compact" },
    });
    expect(root(slot).classList.contains("radar-density-compact")).toBe(true);
  });

  it("toggles compact on and back off", () => {
    const slot = renderThreads([makeThread({ id: "t", title: "One" })]);
    expect(root(slot).classList.contains("radar-density-compact")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Compact view" }));
    expect(root(slot).classList.contains("radar-density-compact")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Comfortable view" }));
    expect(root(slot).classList.contains("radar-density-compact")).toBe(false);
  });

  it("releases the local override when toggled back onto the server default", () => {
    // Regression: a stored "compact" used to lock out the server setting
    // permanently, so the list could be stuck compact with no way back.
    const slot = renderThreads([makeThread({ id: "t", title: "One" })], {
      settings: { defaultDensity: "compact" },
    });
    // Server says compact, so the button offers the comfortable option.
    fireEvent.click(screen.getByRole("button", { name: "Comfortable view" }));
    expect(localStorage.getItem("radar-sidebar:density:v1")).toBe(
      "comfortable",
    );

    // Toggling back onto the server default stores "auto", not an override.
    fireEvent.click(screen.getByRole("button", { name: "Compact view" }));
    expect(localStorage.getItem("radar-sidebar:density:v1")).toBe("auto");
  });
});

describe("settings gates", () => {
  it("shows rows on the shipped defaults while settings load", () => {
    vi.spyOn(pluginSdk, "useSettings").mockReturnValue({
      values: undefined, isLoading: true,
    });
    const slot = renderThreads([makeThread({ id: "t" })]);
    expect(visibleRowIds(slot.container)).toEqual(["t"]);
    expect(screen.queryByRole("status", { name: "Loading threads" })).toBeNull();
    expect(slot.container.querySelector(".radar-title-wrap, .radar-density-compact"))
      .toBeNull();
  });

  it("paints the last-seen density and title mode while settings load", () => {
    // A first render on settings remembers them for this client...
    renderThreads([makeThread({ id: "t" })], {
      settings: { twoLineTitles: true, defaultDensity: "compact" },
    });
    cleanup();

    // ...so the next load sizes rows correctly before settings resolve.
    vi.spyOn(pluginSdk, "useSettings").mockReturnValue({
      values: undefined, isLoading: true,
    });
    const slot = renderThreads([makeThread({ id: "t" })]);
    expect(visibleRowIds(slot.container)).toEqual(["t"]);
    expect(slot.container.querySelector(".radar-title-wrap.radar-density-compact"))
      .not.toBeNull();
  });

  it("follows the loaded settings over the last-seen ones", () => {
    renderThreads([makeThread({ id: "t" })], {
      settings: { twoLineTitles: true, defaultDensity: "compact" },
    });
    cleanup();

    const slot = renderThreads([makeThread({ id: "t" })], {
      settings: { twoLineTitles: false },
    });
    expect(slot.container.querySelector(".radar-title-wrap, .radar-density-compact"))
      .toBeNull();
  });

  it.each([false, true])("owns all title segments when a mention is last: %s", (mentionLast) => {
    vi.spyOn(pluginSdk as typeof pluginSdk & {
      ThreadTitle: FunctionComponent<pluginSdk.PluginThreadTitleProps>;
    }, "ThreadTitle").mockImplementation(() => createElement(
      Fragment, null,
      createElement("span", null, "Fix checkout "),
      createElement("span", { "data-mention": "" }, "@checkout.test.ts"),
      mentionLast ? null : createElement("span", null, " that times out on CI"),
    ));
    const slot = renderThreads([makeThread({ id: "t", isPinned: true })], {
      settings: { twoLineTitles: true },
    });
    const title = slot.container.querySelector(".radar-thread-title");
    expect(title?.textContent).toBe(
      `Fix checkout @checkout.test.ts${mentionLast ? "" : " that times out on CI"}`,
    );
    expect(title?.children).toHaveLength(mentionLast ? 2 : 3);
    expect(title?.querySelector(".radar-pin-marker")).toBeNull();
  });

  it("wraps titles when twoLineTitles is true", () => {
    const slot = renderThreads([makeThread({ id: "t" })], {
      settings: { twoLineTitles: true },
    });
    expect(slot.container.querySelector(".radar-title-wrap")).not.toBeNull();
  });

  it.each([undefined, false, "1", "2", "invalid"])("keeps one-line titles when twoLineTitles is %s", (twoLineTitles) => {
    const slot = renderThreads([makeThread({ id: "t" })], {
      settings: twoLineTitles === undefined ? {} : { twoLineTitles },
    });
    expect(slot.container.querySelector(".radar-title-wrap")).toBeNull();
  });

  it("keeps quiet rows expanded when adaptive collapse is off", () => {
    const quiet = makeThread({
      id: "quiet",
      title: "Idle read thread",
      sectionId: "s1",
    });
    const sections = [makeSection({ id: "s1", name: "Backlog" })];

    // The subtitle line is what adaptive collapse folds away.
    const expanded = renderThreads([quiet], {
      settings: { adaptiveCollapse: false },
      sections,
    });
    expect(expanded.container.querySelector(".radar-row-subtitle")).toBeTruthy();
    cleanup();

    const folded = renderThreads([quiet], {
      settings: { adaptiveCollapse: true },
      sections,
    });
    const subtitle = folded.container.querySelector(".radar-row-subtitle");
    // Hidden rather than removed: the fold animates, so it stays mounted.
    expect(
      subtitle?.closest(".radar-row-extra-collapsed") ??
        folded.container.querySelector(".radar-row-collapsed"),
    ).toBeTruthy();
  });
});

describe("model and thinking display", () => {
  const execution = {
    model: "muse-spark",
    reasoningLevel: "high",
    permissionMode: "full",
    serviceTier: "default",
    source: "client/turn/start",
  };

  it("shows nothing for an idle thread that is not running", async () => {
    // The options endpoint resolves defaults, so it answers for every
    // thread; showing that on an idle one reads as fabricated.
    const idle = makeThread({ id: "idle", title: "Finished earlier" });
    const slot = renderThreads([idle], { execution });

    await waitFor(() => {
      expect(
        slot.container.querySelector(".radar-model-chip"),
      ).toBeNull();
    });
  });

  it("shows nothing on an idle branch thread last active yesterday", async () => {
    // The exact reported case: a worktree branch, read, idle, nothing due.
    const yesterday = makeThread({
      id: "y",
      title: "Yesterday branch thread",
      status: "idle",
      indicator: "none",
      isUnread: false,
      createdAt: NOW - 2 * DAY,
      updatedAt: NOW - DAY,
      latestAttentionAt: NOW - DAY,
      lastReadAt: NOW - DAY,
      environment: {
        id: "e",
        name: null,
        branchName: "codex/some-branch",
        path: "/tmp/x",
        isWorktree: true,
        providerId: "p",
        workspaceDisplayKind: null,
      },
    });
    const slot = renderThreads([yesterday], { execution });

    await waitFor(() =>
      expect(slot.container.querySelector(".radar-row")).toBeTruthy(),
    );

    expect(slot.container.querySelectorAll(".radar-model-chip")).toHaveLength(
      0,
    );
    // The branch line is deliberate and stays.
    expect(slot.container.querySelector(".radar-branch-line")).toBeTruthy();
  });

  it("shows model and thinking while the thread is running", async () => {
    const live = makeThread({
      id: "live",
      title: "Working now",
      status: "active",
      indicator: "runtime",
    });
    const slot = renderThreads([live], { execution });

    await waitFor(() => {
      expect(slot.container.querySelectorAll(".radar-model-chip").length)
        .toBeGreaterThan(0);
    });
    // No catalog entry in the stub, so the raw id is the documented fallback.
    expect(slot.container.textContent).toContain("muse-spark");
    expect(slot.container.textContent).toContain("High");
  });
});

describe("reconciliation", () => {
  it("renders multiple groups without React key warnings", async () => {
    // A group once lost its key when the section wrapper was introduced,
    // which React reports only as a console warning.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderThreads([
      makeThread({
        id: "a",
        title: "Today one",
        latestAttentionAt: NOW,
        projectId: "proj_a",
      }),
      makeThread({
        id: "b",
        title: "Old one",
        latestAttentionAt: NOW - 60 * DAY,
        projectId: "proj_b",
      }),
    ]);
    await waitFor(() =>
      expect(visibleRowIds(document.body as HTMLElement)).toEqual(["a", "b"]),
    );
    const keyWarnings = spy.mock.calls
      .map((call) => call.map(String).join(" "))
      .filter((text) => /unique.*key|Each child in a list/i.test(text));
    expect(keyWarnings).toEqual([]);
  });
});

describe("cyclic parents", () => {
  it("keeps threads whose parents point at each other visible", () => {
    const a = makeThread({ id: "a", parentThreadId: "b" });
    const b = makeThread({ id: "b", parentThreadId: "a" });
    const slot = renderThreads([a, b]);
    expect([...visibleRowIds(slot.container)].sort()).toEqual(["a", "b"]);
  });
});

describe("Pinned smart view", () => {
  it("filters the list to pinned threads", async () => {
    const pinned = makeThread({ id: "pin", isPinned: true, pinnedAt: NOW });
    const other = makeThread({ id: "other" });
    const slot = renderThreads([pinned, other]);
    expect(visibleRowIds(slot.container)).toContain("other");

    fireEvent.click(screen.getByTitle("Pinned threads"));
    await waitFor(() =>
      expect(visibleRowIds(slot.container)).toEqual(["pin"]),
    );
  });
});

describe("keyboard shortcuts", () => {
  const archived = (slot: ReturnType<typeof renderThreads>) =>
    slot.inspection.sidebarActionCalls.filter(
      (call) => call.method === "archive",
    );

  it("only acts while focus is in the list or nowhere", () => {
    const slot = renderThreads([makeThread({ id: "t" })]);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });

    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    fireEvent.keyDown(elsewhere, { key: "e" });
    expect(archived(slot)).toHaveLength(0);

    elsewhere.remove();
    fireEvent.keyDown(document.body, { key: "e" });
    expect(archived(slot)).toHaveLength(1);
  });

  it("still works when focus sits on plain page chrome", () => {
    const slot = renderThreads([makeThread({ id: "t" })]);
    const pane = document.createElement("div");
    pane.tabIndex = -1;
    document.body.appendChild(pane);
    pane.focus();
    fireEvent.keyDown(pane, { key: "ArrowDown" });
    fireEvent.keyDown(pane, { key: "e" });
    pane.remove();
    expect(archived(slot)).toHaveLength(1);
  });

  it("stays out of open dialogs and editable fields", () => {
    const slot = renderThreads([makeThread({ id: "t" })]);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inside = document.createElement("div");
    inside.tabIndex = -1;
    dialog.appendChild(inside);
    document.body.appendChild(dialog);
    fireEvent.keyDown(inside, { key: "e" });

    const editor = document.createElement("div");
    editor.setAttribute("role", "textbox");
    document.body.appendChild(editor);
    fireEvent.keyDown(editor, { key: "e" });

    dialog.remove();
    editor.remove();
    expect(archived(slot)).toHaveLength(0);
  });

  it("leaves keys another handler already consumed alone", () => {
    const slot = renderThreads([makeThread({ id: "t" })]);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });

    const consumed = new KeyboardEvent("keydown", {
      key: "e",
      bubbles: true,
      cancelable: true,
    });
    consumed.preventDefault();
    document.body.dispatchEvent(consumed);
    expect(archived(slot)).toHaveLength(0);
  });

  it("does not swallow arrow keys when the list is empty", () => {
    renderThreads([]);
    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("review regressions", () => {
  it.each(["root", "child", "grandchild"])(
    "marks the entire family read from %s",
    async (targetId) => {
      const slot = renderThreads([
        makeThread({ id: "root" }),
        makeThread({ id: "child", parentThreadId: "root" }),
        makeThread({ id: "grandchild", parentThreadId: "child" }),
        makeThread({ id: "sibling", parentThreadId: "root" }),
      ]);
      fireEvent.contextMenu(
        slot.container.querySelector(`[data-sidebar-thread-id="${targetId}"]`)!,
      );
      fireEvent.click(screen.getByRole("menuitem", { name: "Mark family read" }));
      await waitFor(() => {
        const calls = slot.inspection.sdkCalls.filter(
          (call) => call.method === "threads.markRead",
        );
        expect(calls).toHaveLength(4);
        for (const threadId of ["root", "child", "grandchild", "sibling"]) {
          expect(calls).toContainEqual({
            method: "threads.markRead",
            args: [{ threadId }],
          });
        }
      });
    },
  );

  it("moves DOM focus and the highlight together on repeated arrow keys", () => {
    const slot = renderThreads(["a", "b", "c"].map((id) => makeThread({ id })));
    const row = (id: string) =>
      slot.container.querySelector<HTMLElement>(`[data-sidebar-thread-id="${id}"]`)!;
    row("a").focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(row("c"));
    expect(row("c").closest(".radar-row-keyboard-focused")).not.toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(row("b"));
  });

  it("archives the highlighted row after navigating away from a focused link", () => {
    const slot = renderThreads(["a", "b"].map((id) => makeThread({ id })));
    slot.container.querySelector<HTMLElement>('[data-sidebar-thread-id="a"]')!.focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "e" });
    expect(slot.inspection.sidebarActionCalls).toEqual([
      { method: "archive", threadId: "b" },
    ]);
  });

  it("keeps Space folding available after moving focus from the search field", () => {
    const slot = renderThreads([
      makeThread({ id: "parent" }),
      makeThread({ id: "child", parentThreadId: "parent" }),
    ]);
    const search = screen.getByRole("searchbox");
    search.focus();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    const parent = slot.container.querySelector('[data-sidebar-thread-id="parent"]');
    expect(document.activeElement).toBe(parent);
    fireEvent.keyDown(document.activeElement!, { key: " " });
    expect(screen.getByRole("button", { name: "Expand replies" })).toBeTruthy();
  });

  it.each(["time", "project", "section", "pinned"])(
    "temporarily reveals filtered matches in collapsed %s groups",
    (grouping) => {
      localStorage.setItem("radar-sidebar:grouping:v1", grouping === "pinned" ? "time" : grouping);
      const slot = renderThreads([
        makeThread({ id: "needle", title: "Needle", isPinned: grouping === "pinned" }),
      ]);
      fireEvent.click(screen.getByRole("button", { name: "Collapse all folders" }));
      const stored = localStorage.getItem("radar-sidebar:collapsed:v1");
      const row = () => slot.container.querySelector('[data-sidebar-thread-id="needle"]')!;
      expect(row().closest('[aria-hidden="true"]')).not.toBeNull();
      fireEvent.change(screen.getByRole("searchbox"), { target: { value: "needle" } });
      expect(row().closest('[aria-hidden="true"]')).toBeNull();
      fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
      expect(document.activeElement).toBe(row());
      fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
      expect(row().closest('[aria-hidden="true"]')).not.toBeNull();
      expect(localStorage.getItem("radar-sidebar:collapsed:v1")).toBe(stored);
    },
  );

  it("reveals matches in collapsed groups for status filters too", () => {
    const slot = renderThreads([makeThread({ id: "unread", isUnread: true })]);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all folders" }));
    fireEvent.click(screen.getByTitle("Filter unread threads"));
    expect(
      slot.container.querySelector('[data-sidebar-thread-id="unread"]')!
        .closest('[aria-hidden="true"]'),
    ).toBeNull();
  });

  it("keeps empty sections available as drop targets", () => {
    renderThreads([makeThread({ id: "unfiled" })], {
      sections: [makeSection({ id: "empty", name: "Empty bucket" })],
    });
    fireEvent.click(screen.getByRole("button", {
      name: "Group by section (drag threads between them)",
    }));
    expect(screen.getByRole("region", { name: "Empty bucket" })).toBeTruthy();
    expect(screen.getByText("Drop a thread here to file it.")).toBeTruthy();
  });

  it("keeps archived pagination available when loaded rows do not match", () => {
    localStorage.setItem("radar-sidebar:lifecycles:v1", "archived");
    const fetchNextPage = vi.fn(async () => {});
    renderThreads([makeThread({ id: "one", title: "Unrelated", isArchived: true })], {
      archived: {
        status: "ready",
        hasNextPage: true,
        isFetchingNextPage: false,
        isFetchNextPageError: false,
        fetchNextPage,
      },
    });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "needle" } });
    expect(screen.getByText(/No threads match/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(fetchNextPage).toHaveBeenCalledOnce();
  });
});

describe("section creation", () => {
  const sectionMode = () => fireEvent.click(screen.getByRole("button", {
    name: "Group by section (drag threads between them)",
  }));
  const openForm = () => {
    sectionMode();
    fireEvent.click(screen.getByRole("button", { name: "New section" }));
    return screen.getByRole("textbox", { name: "Section name" }) as HTMLInputElement;
  };
  const createSdk = (create: (args: { name: string }) => Promise<unknown>) => ({
    ...sdkFakes(),
    threadSections: { create },
  });

  it("creates a trimmed section through the SDK, even before there are threads", async () => {
    const create = vi.fn(async ({ name }: { name: string }) => makeSection({ id: "new", name }));
    const slot = renderThreads([], { sdk: createSdk(create) });
    expect(screen.queryByRole("button", { name: "New section" })).toBeNull();
    const input = openForm();
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "  Research  " } });
    fireEvent.submit(screen.getByRole("form", { name: "New section" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Section name" })).toBeNull());
    expect(slot.inspection.sdkCalls).toContainEqual({
      method: "threadSections.create", args: [{ name: "Research" }],
    });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "New section" }));
  });

  it("rejects blank names and cancels without creating or firing row shortcuts", () => {
    const create = vi.fn();
    const slot = renderThreads([makeThread({ id: "one" })], { sdk: createSdk(create) });
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    const input = openForm();
    fireEvent.change(input, { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "Create section" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("form", { name: "New section" }));
    const cancel = screen.getByRole("button", { name: "Cancel" });
    fireEvent.keyDown(cancel, { key: "e" });
    fireEvent.keyDown(cancel, { key: "p" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("form", { name: "New section" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "New section" }));
    fireEvent.click(screen.getByRole("button", { name: "New section" }));
    expect((screen.getByRole("textbox", { name: "Section name" }) as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(create).not.toHaveBeenCalled();
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
  });

  it("keeps a failed name for retry and shows the API error", async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Error("Could not create section"))
      .mockResolvedValueOnce(makeSection({ id: "new", name: "Research" }));
    renderThreads([], { sdk: createSdk(create) });
    const input = openForm();
    fireEvent.change(input, { target: { value: "Research" } });
    fireEvent.click(screen.getByRole("button", { name: "Create section" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not create section");
    expect(input.value).toBe("Research");
    expect(document.activeElement).toBe(input);
    fireEvent.click(screen.getByRole("button", { name: "Create section" }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "New section" })).toBeNull());
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("prevents duplicate submissions while creation is pending", async () => {
    let resolve!: (section: ReturnType<typeof makeSection>) => void;
    const create = vi.fn(() => new Promise<ReturnType<typeof makeSection>>((done) => { resolve = done; }));
    renderThreads([], { sdk: createSdk(create) });
    const input = openForm();
    fireEvent.change(input, { target: { value: "Research" } });
    const form = screen.getByRole("form", { name: "New section" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(create).toHaveBeenCalledOnce();
    expect(input.disabled).toBe(true);
    expect(form.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", { name: "Creating…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(form, { key: "Escape" });
    expect(screen.getByRole("form", { name: "New section" })).toBe(form);
    await act(async () => resolve(makeSection({ id: "new", name: "Research" })));
    expect(screen.queryByRole("form", { name: "New section" })).toBeNull();
  });

  it.each([false, true])("shows empty sections from the host with no matching threads (filter=%s)", (filtered) => {
    renderThreads(filtered ? [makeThread({ id: "one" })] : [], {
      sections: [makeSection({ id: "new", name: "Research" })],
    });
    sectionMode();
    if (filtered) fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no match" } });
    expect(screen.getByRole("region", { name: "Research" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New section" })).toBeTruthy();
  });
});

describe("selection", () => {
  it("drops selected threads that a filter hides", async () => {
    const read = makeThread({ id: "read", latestAttentionAt: NOW });
    const unread = makeThread({
      id: "unread",
      isUnread: true,
      indicator: "unread-success",
      latestAttentionAt: NOW - 2 * HOUR,
    });
    const slot = renderThreads([read, unread]);

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "x" });
    expect(screen.getByText("1 selected")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Filter unread threads"));
    await waitFor(() =>
      expect(visibleRowIds(slot.container)).toEqual(["unread"]),
    );
    expect(screen.queryByText("1 selected")).toBeNull();
  });
});
