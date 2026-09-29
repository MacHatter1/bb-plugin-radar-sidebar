import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { useThreadExecution, type ThreadExecution } from "./useThreadExecution";

// This hook only uses defaultExecutionOptions; keep the fake deliberately small.
function sdkWith(fetch: () => Promise<ThreadExecution>) {
  return { threads: { defaultExecutionOptions: fetch } } as unknown as PluginBrowserBbSdk;
}

afterEach(cleanup);

describe("execution cache", () => {
  it("refreshes on a new run without refetching on same-run remounts", async () => {
    const old = { model: "old", reasoningLevel: "low" };
    const next = { model: "new", reasoningLevel: "high" };
    const fetch = vi.fn().mockResolvedValueOnce(old).mockResolvedValueOnce(next);
    const sdk = sdkWith(fetch);
    const hook = ({ enabled }: { enabled: boolean }) =>
      useThreadExecution("restarted-run", sdk, 0, enabled);
    const first = renderHook(hook, { initialProps: { enabled: true } });
    await waitFor(() => expect(first.result.current).toEqual(old));
    first.unmount();

    const second = renderHook(hook, { initialProps: { enabled: true } });
    expect(second.result.current).toEqual(old);
    expect(fetch).toHaveBeenCalledTimes(1);
    second.rerender({ enabled: false });
    expect(second.result.current).toBeUndefined();
    second.rerender({ enabled: true });
    await waitFor(() => expect(second.result.current).toEqual(next));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes when a filtered-out row returns after newer activity", async () => {
    const old = { model: "old", reasoningLevel: "low" };
    const next = { model: "new", reasoningLevel: "high" };
    const fetch = vi.fn().mockResolvedValueOnce(old).mockResolvedValueOnce(next);
    const sdk = sdkWith(fetch);
    const first = renderHook(() =>
      useThreadExecution("filtered-run", sdk, 0, true, 100),
    );
    await waitFor(() => expect(first.result.current).toEqual(old));
    first.unmount();
    // The row never rendered enabled=false while the thread was idle.
    const second = renderHook(() =>
      useThreadExecution("filtered-run", sdk, 0, true, 200),
    );
    await waitFor(() => expect(second.result.current).toEqual(next));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["idle", "activity"])("discards stale pending requests across %s changes", async (change) => {
    let resolveOld!: (value: ThreadExecution) => void;
    const pending = new Promise<ThreadExecution>((resolve) => { resolveOld = resolve; });
    const next = { model: "new", reasoningLevel: "high" };
    const fetch = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(next);
    const sdk = sdkWith(fetch);
    const hook = ({ enabled, activity }: { enabled: boolean; activity: number }) =>
      useThreadExecution(`pending-run-${change}`, sdk, 0, enabled, activity);
    const first = renderHook(hook, { initialProps: { enabled: true, activity: 100 } });
    const activity = change === "activity" ? 200 : 100;
    if (change === "idle") first.rerender({ enabled: false, activity });
    first.rerender({ enabled: true, activity });
    await waitFor(() => expect(first.result.current).toEqual(next));
    await act(async () => {
      resolveOld({ model: "old", reasoningLevel: "low" });
      await pending;
    });
    first.unmount();
    const second = renderHook(hook, { initialProps: { enabled: true, activity } });
    expect(second.result.current).toEqual(next);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
