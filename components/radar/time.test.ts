import { describe, expect, it } from "vitest";
import {
  activityTime,
  isLiveThread,
  isRunningThread,
  timeAgo,
  timeGroupFor,
} from "./time";
import { makeThread, NOW, DAY, HOUR, MINUTE } from "./fixtures";

describe("isLiveThread", () => {
  it("treats executing statuses as live", () => {
    for (const status of ["starting", "active", "stopping"] as const) {
      expect(isLiveThread(makeThread({ id: "t", status }))).toBe(true);
    }
  });

  it("treats background activity counts as live", () => {
    const thread = makeThread({
      id: "t",
      status: "idle",
      activity: {
        workflows: 0,
        backgroundAgents: 1,
        backgroundCommands: 0,
        planMode: 0,
        goals: 0,
      },
    });
    expect(isLiveThread(thread)).toBe(true);
  });

  it("treats queued work and pending interactions as live", () => {
    expect(
      isLiveThread(makeThread({ id: "q", queuedWork: "waiting" })),
    ).toBe(true);
    expect(
      isLiveThread(makeThread({ id: "p", hasPendingInteraction: true })),
    ).toBe(true);
  });

  it("treats a read idle thread as not live", () => {
    expect(isLiveThread(makeThread({ id: "t", status: "idle" }))).toBe(false);
  });
});

describe("isRunningThread", () => {
  it("keeps queued, failed and blocked work live without calling it running", () => {
    for (const thread of [
      makeThread({ id: "queued", queuedWork: "waiting" }),
      makeThread({ id: "failed", queuedWork: "failed", indicator: "queued-failed" }),
      makeThread({ id: "approval", hasPendingInteraction: true, indicator: "waiting-for-input" }),
    ]) {
      expect(isLiveThread(thread)).toBe(true);
      expect(isRunningThread(thread)).toBe(false);
    }
    expect(isRunningThread(makeThread({ id: "run", status: "active" }))).toBe(true);
    expect(isRunningThread(makeThread({ id: "background", activity: {
      workflows: 1, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0,
    } }))).toBe(true);
  });
});

describe("activityTime", () => {
  it("counts a live thread as now so it lands in Today", () => {
    const stale = makeThread({
      id: "live",
      status: "active",
      createdAt: NOW - 30 * DAY,
      latestAttentionAt: NOW - 30 * DAY,
    });
    expect(activityTime(stale, NOW)).toBe(NOW);
  });

  it("ignores read time: opening a thread must not float it to Today", () => {
    // The bug this guards: reading bumps updatedAt, so grouping off it
    // dragged every visited thread into Today.
    const read = makeThread({
      id: "read",
      status: "idle",
      updatedAt: NOW,
      lastReadAt: NOW,
      latestAttentionAt: NOW - 60 * DAY,
    });
    // Keys off attention, not the freshly-read updatedAt.
    expect(activityTime(read, NOW)).toBe(NOW - 60 * DAY);
    expect(timeGroupFor(activityTime(read, NOW), NOW)).toBe("older");
    // Had it used updatedAt, this same thread would have landed in Today.
    expect(timeGroupFor(read.updatedAt, NOW)).toBe("today");
  });
});

describe("timeGroupFor", () => {
  it("buckets by local day boundaries", () => {
    expect(timeGroupFor(NOW, NOW)).toBe("today");
    expect(timeGroupFor(NOW - DAY - HOUR, NOW)).toBe("yesterday");
    expect(timeGroupFor(NOW - 6 * DAY, NOW)).toBe("week");
    expect(timeGroupFor(NOW - 8 * DAY, NOW)).toBe("month");
    expect(timeGroupFor(NOW - 60 * DAY, NOW)).toBe("older");
  });

  it.each([
    [new Date(2026, 9, 26, 12), new Date(2026, 9, 25), "yesterday", "week"],
    [new Date(2026, 10, 1, 12), new Date(2026, 9, 25), "week", "month"],
    [new Date(2026, 10, 24, 12), new Date(2026, 9, 25), "month", "older"],
    [new Date(2026, 2, 30, 12), new Date(2026, 2, 29), "yesterday", "week"],
    [new Date(2026, 3, 5, 12), new Date(2026, 2, 29), "week", "month"],
    [new Date(2026, 3, 28, 12), new Date(2026, 2, 29), "month", "older"],
  ])("uses calendar boundaries across DST (%s, %s)", (now, boundary, group, preceding) => {
    expect(timeGroupFor(Number(boundary) + 30 * MINUTE, Number(now))).toBe(group);
    expect(timeGroupFor(Number(boundary) - MINUTE, Number(now))).toBe(preceding);
  });
});

describe("timeAgo", () => {
  it("shortens recent spans", () => {
    expect(timeAgo(NOW - 30 * 1000, NOW)).toBe("just now");
    expect(timeAgo(NOW - 5 * MINUTE, NOW)).toBe("5m ago");
    expect(timeAgo(NOW - 3 * HOUR, NOW)).toBe("3h ago");
    expect(timeAgo(NOW - DAY, NOW)).toBe("yesterday");
    expect(timeAgo(NOW - 3 * DAY, NOW)).toBe("3d ago");
  });
});
