import { describe, expect, it } from "vitest";
import {
  DEFAULT_SWIPE_LEFT,
  DEFAULT_SWIPE_RIGHT,
  SWIPE_ACTION_OPTION_LABELS,
  shouldCommitSwipe,
  swipeActionFromSetting,
  swipeActionView,
  swipeOffset,
  swipeThreshold,
} from "./swipe";

const idle = { isUnread: false, isPinned: false, isArchived: false };

describe("swipe settings", () => {
  it("offers every action, with defaults among the options", () => {
    expect(SWIPE_ACTION_OPTION_LABELS).toContain(DEFAULT_SWIPE_RIGHT);
    expect(SWIPE_ACTION_OPTION_LABELS).toContain(DEFAULT_SWIPE_LEFT);
    expect(SWIPE_ACTION_OPTION_LABELS.map((label) => swipeActionFromSetting(label, "Nothing")))
      .toEqual(["read", "pin", "archive", "split", "rename", "menu", "delete", "none"]);
  });

  it.each([undefined, 3, "archive", ""])("falls back on an unknown value: %s", (value) => {
    expect(swipeActionFromSetting(value, "Pin / unpin")).toBe("pin");
  });
});

describe("swipeActionView", () => {
  it("names the toggle by what it will do", () => {
    expect(swipeActionView("read", { ...idle, isUnread: true })?.label).toBe("Read");
    expect(swipeActionView("read", idle)?.label).toBe("Unread");
    expect(swipeActionView("pin", { ...idle, isPinned: true })?.label).toBe("Unpin");
  });

  it("slides the row away only when it will leave the list", () => {
    expect(swipeActionView("archive", idle)?.removes).toBe(true);
    expect(swipeActionView("archive", { ...idle, isArchived: true })?.removes).toBe(false);
    // Delete waits on the host's confirmation.
    expect(swipeActionView("delete", idle)?.removes).toBe(false);
  });

  it("has no view for none", () => {
    expect(swipeActionView("none", idle)).toBeNull();
  });
});

describe("gesture math", () => {
  it("arms at a third of the row within finger reach", () => {
    expect(swipeThreshold(300)).toBe(90);
    expect(swipeThreshold(100)).toBe(64);
    expect(swipeThreshold(1000)).toBe(128);
  });

  it("tracks the finger 1:1, then resists", () => {
    expect(swipeOffset(120, 300, true)).toBe(120);
    expect(swipeOffset(-120, 300, true)).toBe(-120);
    expect(swipeOffset(340, 300, true)).toBe(240 + 25);
  });

  it("only tugs on a side without an action", () => {
    expect(swipeOffset(50, 300, false)).toBe(10);
    expect(swipeOffset(-500, 300, false)).toBe(-28);
  });

  it("commits past the threshold unless pulled back hard", () => {
    expect(shouldCommitSwipe(100, 0, 90)).toBe(true);
    expect(shouldCommitSwipe(-100, 0, 90)).toBe(true);
    expect(shouldCommitSwipe(100, -1, 90)).toBe(false);
  });

  it("commits a short flick but not a short drag", () => {
    expect(shouldCommitSwipe(40, 0.8, 90)).toBe(true);
    expect(shouldCommitSwipe(-40, -0.8, 90)).toBe(true);
    expect(shouldCommitSwipe(40, 0.1, 90)).toBe(false);
    expect(shouldCommitSwipe(20, 2, 90)).toBe(false);
    expect(shouldCommitSwipe(0, 2, 90)).toBe(false);
  });
});
