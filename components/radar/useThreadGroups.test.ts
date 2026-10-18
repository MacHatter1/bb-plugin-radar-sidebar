import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThread, makeProject, makeSection, NOW, HOUR } from "./fixtures";
import { useThreadGroups } from "./useThreadGroups";

type Args = Parameters<typeof useThreadGroups>[0];
function argsFor(threads: Args["threads"]): Args {
  return { threads, query: "", statusFilter: "all", grouping: "time",
    projectOrder: [], projects: [makeProject({ id: "proj_a" })], sections: [], now: NOW };
}
afterEach(cleanup);

describe("family derivation cache", () => {
  it("shares activity and summary work across sorting, headers and row renders", () => {
    const parent = makeThread({ id: "p", latestAttentionAt: NOW - HOUR });
    const child = makeThread({ id: "c", parentThreadId: "p", latestAttentionAt: NOW });
    const activityRead = vi.fn(() => NOW);
    const unreadRead = vi.fn(() => false);
    Object.defineProperty(child, "latestAttentionAt", { get: activityRead });
    Object.defineProperty(child, "isUnread", { get: unreadRead });
    const args = argsFor([parent, child, makeThread({ id: "other" })]);
    const hook = renderHook((props: Args) => useThreadGroups(props), { initialProps: args });
    const first = hook.result.current;
    const counts = first.countSubtree(parent);
    expect(first.subtreeActivity(parent)).toBe(NOW);
    activityRead.mockClear();
    unreadRead.mockClear();
    for (let i = 0; i < 100; i++) {
      expect(first.countSubtree(parent)).toBe(counts);
      expect(first.subtreeActivity(parent)).toBe(NOW);
    }
    hook.rerender({ ...args, grouping: "project" });
    expect(hook.result.current.countSubtree(parent)).toBe(counts);
    expect(hook.result.current.subtreeActivity(parent)).toBe(NOW);
    expect(activityRead).not.toHaveBeenCalled();
    expect(unreadRead).not.toHaveBeenCalled();
  });

  it("invalidates summaries on a new snapshot and when filtering changes descendants", () => {
    const parent = makeThread({ id: "p", title: "Parentneedle" });
    const child = makeThread({ id: "c", parentThreadId: "p" });
    const args = argsFor([parent, child]);
    const hook = renderHook((props: Args) => useThreadGroups(props), { initialProps: args });
    const before = hook.result.current.countSubtree(parent);
    const failed = { ...child, isUnread: true, indicator: "unread-error" as const };
    const updated = { ...args, threads: [parent, failed] };
    hook.rerender(updated);
    const after = hook.result.current.countSubtree(parent);
    expect(after).not.toBe(before);
    expect(after).toMatchObject({ total: 2, unread: 1, failed: 1 });
    expect(hook.result.current.groups[0]).toMatchObject({ total: 2, unread: 1, failed: 1 });
    hook.rerender({ ...updated, query: "Parentneedle" });
    expect(hook.result.current.countSubtree(parent)).toMatchObject({ total: 1, unread: 0, failed: 0, kids: [] });
    hook.rerender({ ...updated, statusFilter: "unread" });
    expect(hook.result.current.countSubtree(parent)).toMatchObject({ total: 2, unread: 1, failed: 1 });
  });

  it("invalidates cached activity when the clock advances or live work ends", () => {
    const parent = makeThread({ id: "p", latestAttentionAt: NOW - 3 * HOUR });
    const child = makeThread({ id: "c", parentThreadId: "p", status: "active", latestAttentionAt: NOW - HOUR });
    const args = argsFor([parent, child]);
    const hook = renderHook((props: Args) => useThreadGroups(props), { initialProps: args });
    expect(hook.result.current.subtreeActivity(parent)).toBe(NOW);
    hook.rerender({ ...args, now: NOW + HOUR });
    expect(hook.result.current.subtreeActivity(parent)).toBe(NOW + HOUR);
    hook.rerender({ ...args, threads: [parent, { ...child, status: "idle" }] });
    expect(hook.result.current.subtreeActivity(parent)).toBe(NOW - HOUR);
    expect(hook.result.current.countSubtree(parent).live).toBe(0);
  });

  it("preserves all descendant counts and the first five previews in depth-first order", () => {
    const parent = makeThread({ id: "p" });
    const threads = [parent,
      makeThread({ id: "a", parentThreadId: "p", status: "active" }),
      makeThread({ id: "a1", parentThreadId: "a", indicator: "waiting-for-input", hasPendingInteraction: true }),
      makeThread({ id: "b", parentThreadId: "p", isUnread: true, indicator: "unread-error", latestAttentionAt: NOW - HOUR }),
      makeThread({ id: "c", parentThreadId: "p", isUnread: true, latestAttentionAt: NOW - 2 * HOUR }),
      makeThread({ id: "d", parentThreadId: "p", latestAttentionAt: NOW - 3 * HOUR }),
      makeThread({ id: "e", parentThreadId: "p", latestAttentionAt: NOW - 4 * HOUR }),
    ];
    const hook = renderHook(() => useThreadGroups(argsFor(threads)));
    const counts = hook.result.current.countSubtree(parent);
    expect(counts).toMatchObject({ total: 7, unread: 2, live: 1, needsUser: 1, failed: 1 });
    expect(counts.kids.map(({ id, dot }) => [id, dot])).toEqual([
      ["a", "radar-dot-running radar-dot-pulse"], ["a1", "radar-dot-attention"],
      ["b", "radar-dot-error"], ["c", "radar-unread"], ["d", null],
    ]);
  });

  it("rolls up queued descendants separately from running or user-blocked work", () => {
    const parent = makeThread({ id: "parent" });
    const threads = [parent,
      makeThread({ id: "child", parentThreadId: "parent" }),
      makeThread({ id: "queued", parentThreadId: "child", queuedWork: "waiting", indicator: "queued-waiting" }),
    ];
    const hook = renderHook(() => useThreadGroups(argsFor(threads)));
    expect(hook.result.current.countSubtree(parent)).toMatchObject({
      total: 3, live: 0, needsUser: 0, queued: 1, failed: 0,
    });
    expect(hook.result.current.groups[0]).toMatchObject({ live: 0, needsUser: 0, queued: 1 });
    expect(hook.result.current.statusCounts).toMatchObject({ live: 1, waiting: 1 });
    expect(hook.result.current.countSubtree(parent).kids.find(kid => kid.id === "queued")?.dot).toBe("radar-dot-attention");
  });

  it("preserves the traversal depth guard", () => {
    const threads = Array.from({ length: 32 }, (_, i) => makeThread({
      id: `t${i}`, parentThreadId: i === 0 ? null : `t${i - 1}`,
      latestAttentionAt: NOW - (40 - i) * HOUR,
    }));
    const hook = renderHook(() => useThreadGroups(argsFor(threads)));
    expect(hook.result.current.countSubtree(threads[0]).total).toBe(27);
    expect(hook.result.current.subtreeActivity(threads[0])).toBe(threads[26].latestAttentionAt);
  });

  it("separates scheduled descendants and invalidates family summaries on rescheduling", () => {
    const parent = makeThread({ id: "parent" });
    const child = makeThread({ id: "scheduled", parentThreadId: "parent", queuedWork: "waiting", indicator: "queued-waiting" });
    const args = { ...argsFor([parent, child]), scheduledThreads: new Map([[child.id, NOW + HOUR]]) };
    const hook = renderHook((props: Args) => useThreadGroups(props), { initialProps: args });
    const before = hook.result.current.countSubtree(parent);
    expect(before).toMatchObject({ queued: 0, scheduled: 1, live: 0, needsUser: 0 });
    expect(before.kids[0].dot).toBe("radar-dot-scheduled");
    expect(hook.result.current.groups[0]).toMatchObject({ queued: 0, scheduled: 1 });
    hook.rerender({ ...args, scheduledThreads: new Map() });
    expect(hook.result.current.countSubtree(parent)).not.toBe(before);
    expect(hook.result.current.countSubtree(parent)).toMatchObject({ queued: 1, scheduled: 0 });
  });
});

describe("section family placement", () => {
  it("moves a child into its selected section after the host snapshot changes", () => {
    const parent = makeThread({ id: "parent", sectionId: "a" });
    const child = makeThread({ id: "child", parentThreadId: "parent", sectionId: "a", isUnread: true });
    const args: Args = { ...argsFor([parent, child]), grouping: "section",
      sections: [makeSection({ id: "a", name: "A" }), makeSection({ id: "b", name: "B" })] };
    const hook = renderHook((props: Args) => useThreadGroups(props), { initialProps: args });
    expect(hook.result.current.groups.map(group => [group.label, group.total, group.unread])).toEqual([
      ["A", 2, 1], ["B", 0, 0], ["Unfiled", 0, 0],
    ]);
    hook.rerender({ ...args, threads: [parent, { ...child, sectionId: "b" }] });
    expect(hook.result.current.groups.map(group => [group.label, group.total, group.unread])).toEqual([
      ["A", 1, 0], ["B", 1, 1], ["Unfiled", 0, 0],
    ]);
    expect(hook.result.current.roots.map(thread => thread.id)).toEqual(["parent", "child"]);
    expect(hook.result.current.childrenOf.get("parent")?.map(thread => thread.id)).toEqual(["child"]);
    expect(hook.result.current.countSubtree(parent)).toMatchObject({ total: 1, unread: 0, kids: [] });
    expect(hook.result.current.shownTotal).toBe(2);
  });
});

it("splits every section boundary while preserving same-section nesting, rollups and logical search context", () => {
  const parent = makeThread({ id: "a-root", sectionId: "a", latestAttentionAt: NOW - 4 * HOUR });
  const same = makeThread({ id: "a-child", parentThreadId: parent.id, sectionId: "a", latestAttentionAt: NOW - 3 * HOUR });
  const moved = makeThread({ id: "b-child", title: "Needle", parentThreadId: same.id, sectionId: "b", latestAttentionAt: NOW, status: "active" });
  const back = makeThread({ id: "a-grandchild", parentThreadId: moved.id, sectionId: "a", isUnread: true, indicator: "unread-error", latestAttentionAt: NOW - HOUR });
  const args: Args = { ...argsFor([parent, same, moved, back]), grouping: "section",
    sections: [makeSection({ id: "a", name: "A" }), makeSection({ id: "b", name: "B" })] };
  const hook = renderHook((props: Args) => useThreadGroups(props), { initialProps: args });
  const grouped = hook.result.current;
  expect(grouped.groups.map(group => [group.label, group.roots.map(thread => thread.id), group.total, group.unread, group.live, group.failed])).toEqual([
    ["A", ["a-grandchild", "a-root"], 3, 1, 0, 1], ["B", ["b-child"], 1, 0, 1, 0], ["Unfiled", [], 0, 0, 0, 0],
  ]);
  expect(grouped.shownChildren.get(parent.id)?.map(thread => thread.id)).toEqual(["a-child"]);
  expect(grouped.countSubtree(parent)).toMatchObject({ total: 2, unread: 0, live: 0, failed: 0, kids: [{ id: "a-child" }] });
  expect(grouped.subtreeActivity(parent)).toBe(NOW - 3 * HOUR);
  expect(grouped.shownTotal).toBe(4);
  hook.rerender({ ...args, query: "needle" });
  expect(hook.result.current.groups.map(group => [group.label, group.total, group.live, group.failed])).toEqual([
    ["A", 2, 0, 0], ["B", 1, 1, 0], ["Unfiled", 0, 0, 0],
  ]);
  hook.rerender({ ...args, statusFilter: "unread" });
  expect(hook.result.current.groups.map(group => [group.label, group.total, group.unread])).toEqual([
    ["A", 3, 1], ["B", 1, 0], ["Unfiled", 0, 0],
  ]);
  for (const grouping of ["project", "time"] as const) {
    hook.rerender({ ...args, grouping });
    expect(hook.result.current.roots.map(thread => thread.id)).toEqual(["a-root"]);
    expect(hook.result.current.countSubtree(parent)).toMatchObject({ total: 4, unread: 1, live: 1, failed: 1 });
    expect(hook.result.current.subtreeActivity(parent)).toBe(NOW);
    expect(hook.result.current.shownChildren.get(same.id)?.map(thread => thread.id)).toEqual(["b-child"]);
  }
  hook.rerender(args);
  expect(hook.result.current.countSubtree(parent)).toMatchObject({ total: 2, live: 0, failed: 0 });
});

it("keeps missing and deleted section ids nested together in Unfiled", () => {
  const parent = makeThread({ id: "parent", sectionId: "deleted-a" });
  const child = makeThread({ id: "child", parentThreadId: "parent" });
  const grandchild = makeThread({ id: "grandchild", parentThreadId: "child", sectionId: "deleted-b" });
  const hook = renderHook(() => useThreadGroups({ ...argsFor([parent, child, grandchild]), grouping: "section" }));
  expect(hook.result.current.groups.map(group => [group.label, group.roots.map(thread => thread.id), group.total])).toEqual([
    ["Unfiled", ["parent"], 3],
  ]);
  expect(hook.result.current.shownChildren.get("parent")?.map(thread => thread.id)).toEqual(["child"]);
  expect(hook.result.current.shownChildren.get("child")?.map(thread => thread.id)).toEqual(["grandchild"]);
});

it("uses promoted children's own pin state while preserving same-section pinned nesting", () => {
  const parent = makeThread({ id: "pinned-parent", sectionId: "a", isPinned: true });
  const moved = makeThread({ id: "moved", sectionId: "b", parentThreadId: parent.id });
  const other = makeThread({ id: "other", sectionId: "a" });
  const pinned = makeThread({ id: "pinned-child", sectionId: "b", parentThreadId: other.id, isPinned: true });
  const same = makeThread({ id: "same-pinned-child", sectionId: "a", parentThreadId: other.id, isPinned: true });
  const args: Args = { ...argsFor([parent, moved, other, pinned, same]), grouping: "section",
    sections: [makeSection({ id: "a", name: "A" }), makeSection({ id: "b", name: "B" })] };
  const hook = renderHook((props: Args) => useThreadGroups(props), { initialProps: args });
  expect(hook.result.current.pinnedGroup?.roots.map(thread => thread.id)).toEqual(["pinned-parent", "pinned-child"]);
  expect(hook.result.current.pinnedGroup?.total).toBe(2);
  expect(hook.result.current.groups.map(group => [group.label, group.roots.map(thread => thread.id), group.total])).toEqual([
    ["A", ["other"], 2], ["B", ["moved"], 1], ["Unfiled", [], 0],
  ]);
  expect(hook.result.current.shownChildren.get("other")?.map(thread => thread.id)).toEqual(["same-pinned-child"]);
  expect(hook.result.current.childrenOf.get(parent.id)?.map(thread => thread.id)).toEqual(["moved"]);
  expect(hook.result.current.shownTotal).toBe(5);
  hook.rerender({ ...args, grouping: "project" });
  expect(hook.result.current.pinnedGroup?.roots.map(thread => thread.id)).toEqual(["pinned-parent"]);
  expect(hook.result.current.pinnedGroup?.total).toBe(2);
  expect(hook.result.current.groups[0].total).toBe(3);
});
