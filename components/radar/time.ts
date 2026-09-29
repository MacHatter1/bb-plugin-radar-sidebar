/** Time grouping + relative timestamps for the thread list. */

import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/**
 * True while a thread is live: executing, winding down, running background
 * work, holding a queued message, or blocked on the user. Live threads
 * count as active right now for grouping and sorting.
 */
export function isLiveThread(thread: PluginSidebarThread): boolean {
  if (
    thread.status === "starting" ||
    thread.status === "active" ||
    thread.status === "stopping"
  ) {
    return true;
  }
  const activity = thread.activity;
  if (
    activity.workflows +
      activity.backgroundAgents +
      activity.backgroundCommands +
      activity.planMode +
      activity.goals >
    0
  ) {
    return true;
  }
  if (thread.queuedWork !== "none") return true;
  if (thread.hasPendingInteraction) return true;
  return false;
}

/**
 * Last real activity: live threads count as now, otherwise the latest
 * attention (completions, failures). Reads bump `updatedAt` but never
 * touch this — merely visiting a thread must not float it to Today.
 */
export function activityTime(
  thread: PluginSidebarThread,
  now: number,
): number {
  return isLiveThread(thread) ? now : thread.latestAttentionAt;
}

export type TimeGroupId = "today" | "yesterday" | "week" | "month" | "older";

export const TIME_GROUP_ORDER: readonly TimeGroupId[] = [
  "today",
  "yesterday",
  "week",
  "month",
  "older",
];

export const TIME_GROUP_LABELS: Record<TimeGroupId, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Previous 7 days",
  month: "Previous 30 days",
  older: "Older",
};

const DAY_MS = 86_400_000;

function startOfLocalDay(ts: number): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function timeGroupFor(updatedAt: number, now: number): TimeGroupId {
  const todayStart = startOfLocalDay(now);
  if (updatedAt >= todayStart) return "today";
  if (updatedAt >= todayStart - DAY_MS) return "yesterday";
  if (updatedAt >= todayStart - 7 * DAY_MS) return "week";
  if (updatedAt >= todayStart - 30 * DAY_MS) return "month";
  return "older";
}

export function timeAgo(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  const date = new Date(ts);
  const sameYear = new Date(now).getFullYear() === date.getFullYear();
  return date.toLocaleDateString(
    undefined,
    sameYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" },
  );
}
