import { useEffect, useMemo, useState } from "react";
import type { PluginBrowserBbSdk, PluginSidebarThread } from "@get-bb/plugin-sdk/app";

type QueuedMessage = Awaited<ReturnType<PluginBrowserBbSdk["threads"]["queue"]["list"]>>[number];
type QueueTiming = Pick<QueuedMessage, "threadId" | "sendAt" | "failureReason">;
export const EMPTY_SCHEDULES: ReadonlyMap<string, number> = new Map();

/** Only exclusively future work is scheduled; immediate or failed work wins. */
export function scheduledThreadsFor(
  messages: readonly QueueTiming[],
  now: number,
): ReadonlyMap<string, number> {
  const scheduled = new Map<string, number>();
  const immediate = new Set<string>();
  for (const message of messages) {
    if (message.failureReason !== null || message.sendAt === null ||
      !Number.isFinite(message.sendAt) || message.sendAt <= now) {
      immediate.add(message.threadId);
    } else {
      scheduled.set(message.threadId, Math.min(scheduled.get(message.threadId) ?? Infinity, message.sendAt));
    }
  }
  for (const id of immediate) scheduled.delete(id);
  return scheduled;
}

const scheduledDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium", timeStyle: "short",
});

export function scheduledLabel(sendAt: number): string {
  return `Scheduled for ${scheduledDate.format(sendAt)}`;
}

/** Sidebar summaries omit sendAt. Read the public queue once for the list,
 * then refresh on queue edits, reconnects and focus, including folded rows. */
export function useScheduledThreads(
  threads: readonly PluginSidebarThread[],
  sdk: PluginBrowserBbSdk,
): ReadonlyMap<string, number> {
  const key = JSON.stringify(threads
    .filter(thread => !thread.isHidden && !thread.isArchived &&
      thread.indicator === "queued-waiting" && thread.queuedWork === "waiting")
    .map(thread => thread.id).sort());
  const ids = useMemo(() => new Set<string>(JSON.parse(key)), [key]);
  const [snapshot, setSnapshot] = useState({ key: "", scheduled: EMPTY_SCHEDULES });

  useEffect(() => {
    if (ids.size === 0) return;
    let disposed = false;
    let request: AbortController | null = null;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let messages: readonly QueueTiming[] = [];
    const publish = () => {
      clearTimeout(deadline);
      const scheduled = new Map([...scheduledThreadsFor(messages, Date.now())]
        .filter(([id]) => ids.has(id)));
      setSnapshot(previous => previous.key === key && previous.scheduled.size === scheduled.size &&
        [...scheduled].every(([id, at]) => previous.scheduled.get(id) === at)
        ? previous : { key, scheduled });
      // Revert to Queued when the time arrives, even without a host event.
      if (scheduled.size > 0) {
        const next = Math.min(...scheduled.values());
        deadline = setTimeout(() => {
          publish();
          void refresh();
        }, Math.min(2_147_483_647, Math.max(1, next - Date.now())));
      }
    };
    const refresh = async () => {
      request?.abort();
      const current = new AbortController();
      request = current;
      try {
        const result = await sdk.threads.queue.list({ signal: current.signal });
        if (disposed || current.signal.aborted) return;
        messages = result;
      } catch {
        if (disposed || current.signal.aborted) return;
        // An unavailable read must not leave a stale schedule visible.
        messages = [];
      }
      publish();
    };
    const invalidate = () => {
      request?.abort();
      clearTimeout(debounce);
      clearTimeout(deadline);
      setSnapshot({ key, scheduled: EMPTY_SCHEDULES });
      debounce = setTimeout(() => void refresh(), 100);
    };
    const unsubscribers: (() => void)[] = [];
    try {
      unsubscribers.push(sdk.subscribe({ event: "thread:changed", callback: event => {
        if ((!event.id || ids.has(event.id)) && event.changes.includes("queue-changed")) invalidate();
      } }));
      unsubscribers.push(sdk.subscribe({ event: "realtime:connection", callback: event => {
        if (event.state === "connected" && event.reconnected) invalidate();
      } }));
    } catch {
      // Older transports still revalidate through focus and the periodic read.
    }
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const poll = setInterval(() => void refresh(), 30_000);
    void refresh();
    return () => {
      disposed = true;
      request?.abort();
      clearTimeout(deadline);
      clearTimeout(debounce);
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [ids, key, sdk]);
  return snapshot.key === key ? snapshot.scheduled : EMPTY_SCHEDULES;
}
