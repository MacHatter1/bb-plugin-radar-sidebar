import { describe, expect, it } from "vitest";
import {
  activityTime,
  isLiveThread,
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
