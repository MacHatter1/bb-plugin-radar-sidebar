import { describe, expect, it, vi } from "vitest";
import { markProjectRead } from "./projectRead";

const thread = (id: string, projectId = "a", isUnread = true, isHidden = false) => ({ id, projectId, isUnread, isHidden });
describe("mark project read", () => {
  it("reads only the chosen project's unread, non-hidden threads once", async () => {
    const markRead = vi.fn(async () => {});
    expect(await markProjectRead([thread("one"), thread("one"), thread("other", "b"), thread("seen", "a", false), thread("hidden", "a", true, true)], "a", markRead))
      .toEqual({ read: 1, failed: 0 });
    expect(markRead.mock.calls).toEqual([["one"]]);
  });
  it("continues after failures and limits concurrent requests to eight", async () => {
    let running = 0;
    let max = 0;
    const markRead = vi.fn(async (id: string) => {
      max = Math.max(max, ++running);
      await new Promise(resolve => setTimeout(resolve, 0));
      running--;
      if (id === "p3") throw new Error("offline");
    });
    expect(await markProjectRead(Array.from({ length: 19 }, (_, i) => thread(`p${i}`)), "a", markRead)).toEqual({ read: 18, failed: 1 });
    expect(max).toBe(8);
    expect(markRead).toHaveBeenCalledTimes(19);
  });
  it("leaves threads that became unread after the click for the next action", async () => {
    const threads = [thread("one")];
    const markRead = vi.fn(async () => { threads.push(thread("new")); });
    expect(await markProjectRead(threads, "a", markRead)).toEqual({ read: 1, failed: 0 });
    expect(markRead).toHaveBeenCalledTimes(1);
  });
});
