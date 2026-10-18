import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { makeThread, NOW } from "./fixtures";
import { scheduledThreadsFor, useScheduledThreads } from "./useScheduledThreads";

type Timing = Parameters<typeof scheduledThreadsFor>[0][number];
const timing = (threadId: string, sendAt: number | null, failureReason: string | null = null): Timing =>
  ({ threadId, sendAt, failureReason });
const queued = makeThread({ id: "scheduled", queuedWork: "waiting", indicator: "queued-waiting" });

function setup(list = vi.fn().mockResolvedValue([timing(queued.id, NOW + 60_000)])) {
  const callbacks = new Map<string, (event: unknown) => void>();
  const unsubscribers: ReturnType<typeof vi.fn>[] = [];
  const sdk = {
    threads: { queue: { list } },
    subscribe: vi.fn(({ event, callback }: { event: string; callback: (event: unknown) => void }) => {
      callbacks.set(event, callback);
      const unsubscribe = vi.fn();
      unsubscribers.push(unsubscribe);
      return unsubscribe;
    }),
  } as unknown as PluginBrowserBbSdk;
  return { sdk, list, callbacks, unsubscribers };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("scheduled queue classification", () => {
  it("uses the earliest time when every queued item is scheduled", () => {
    expect([...scheduledThreadsFor([
      timing("a", NOW + 2_000), timing("a", NOW + 1_000), timing("b", NOW + 3_000),
    ], NOW)]).toEqual([["a", NOW + 1_000], ["b", NOW + 3_000]]);
  });

  it.each([null, NOW, NOW - 1, NaN, Infinity])("keeps mixed/due/invalid work queued (%s)", sendAt => {
    expect(scheduledThreadsFor([timing("a", NOW + 1_000), timing("a", sendAt)], NOW).has("a")).toBe(false);
  });

  it("never hides failed work behind a future schedule", () => {
    expect([...scheduledThreadsFor([
      timing("a", NOW + 1_000, "Failed"), timing("b", NOW + 1_000),
    ], NOW)]).toEqual([["b", NOW + 1_000]]);
  });
});

describe("scheduled queue lifecycle", () => {
  it("only reads when visible sidebar threads have a queued indicator", async () => {
    const { sdk, list } = setup();
    const hook = renderHook(({ threads }) => useScheduledThreads(threads, sdk), {
      initialProps: { threads: [makeThread({ id: "idle" }), { ...queued, isHidden: true }, { ...queued, isArchived: true }] },
    });
    expect(list).not.toHaveBeenCalled();
    hook.rerender({ threads: [queued] });
    await act(async () => {});
    expect(hook.result.current.get(queued.id)).toBe(NOW + 60_000);
    expect(list).toHaveBeenCalledOnce();
    // Ordinary activity updates do not cause a queue read.
    hook.rerender({ threads: [{ ...queued, updatedAt: NOW + 100 }] });
    expect(list).toHaveBeenCalledOnce();
    hook.rerender({ threads: [makeThread({ id: "idle" })] });
    expect(hook.result.current.size).toBe(0);
  });

  it("refreshes a reschedule and cancellation without a sidebar status change", async () => {
    const { sdk, list, callbacks } = setup();
    const hook = renderHook(() => useScheduledThreads([queued], sdk));
    await act(async () => {});
    list.mockResolvedValue([timing(queued.id, NOW + 120_000)]);
    act(() => callbacks.get("thread:changed")!({ id: queued.id, changes: ["queue-changed"] }));
    expect(hook.result.current.size).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(hook.result.current.get(queued.id)).toBe(NOW + 120_000);
    list.mockResolvedValue([]);
    act(() => callbacks.get("thread:changed")!({ id: queued.id, changes: ["queue-changed"] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(hook.result.current.size).toBe(0);
  });

  it("drops Scheduled exactly when it is due even if the host has not dispatched", async () => {
    const { sdk, list } = setup(vi.fn().mockResolvedValue([timing(queued.id, NOW + 500)]));
    const hook = renderHook(() => useScheduledThreads([queued], sdk));
    await act(async () => {});
    expect(hook.result.current.get(queued.id)).toBe(NOW + 500);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(hook.result.current.size).toBe(0);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("ignores stale reads after queue edits and aborts on unmount", async () => {
    let resolve!: (messages: Timing[]) => void;
    const pending = new Promise<Timing[]>(done => { resolve = done; });
    const { sdk, list, callbacks, unsubscribers } = setup(vi.fn()
      .mockReturnValueOnce(pending).mockResolvedValue([]));
    const hook = renderHook(() => useScheduledThreads([queued], sdk));
    const firstSignal = list.mock.calls[0][0].signal as AbortSignal;
    act(() => callbacks.get("thread:changed")!({ id: queued.id, changes: ["queue-changed"] }));
    expect(firstSignal.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await act(async () => { resolve([timing(queued.id, NOW + 60_000)]); });
    expect(hook.result.current.size).toBe(0);
    const signal = list.mock.calls.at(-1)![0].signal as AbortSignal;
    hook.unmount();
    expect(signal.aborted).toBe(true);
    expect(unsubscribers.every(unsubscribe => unsubscribe.mock.calls.length === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers on focus/reconnect and falls back to Queued when reads fail", async () => {
    const { sdk, list, callbacks } = setup();
    const hook = renderHook(() => useScheduledThreads([queued], sdk));
    await act(async () => {});
    list.mockRejectedValue(new Error("Offline"));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(hook.result.current.size).toBe(0);
    list.mockResolvedValue([timing(queued.id, NOW + 120_000)]);
    act(() => callbacks.get("realtime:connection")!({ state: "connected", reconnected: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(hook.result.current.get(queued.id)).toBe(NOW + 120_000);
  });
});
