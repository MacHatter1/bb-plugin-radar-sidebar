import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/** Snapshot only this project's unread threads; bound concurrent writes. */
export async function markProjectRead(
  threads: readonly Pick<PluginSidebarThread, "id" | "projectId" | "isUnread" | "isHidden">[],
  projectId: string,
  markRead: (threadId: string) => Promise<unknown>,
): Promise<{ read: number; failed: number }> {
  const ids = [...new Set(threads.filter(thread => thread.projectId === projectId && thread.isUnread && !thread.isHidden).map(thread => thread.id))];
  let read = 0;
  let failed = 0;
  for (let start = 0; start < ids.length; start += 8) {
    const results = await Promise.allSettled(ids.slice(start, start + 8).map(id => Promise.resolve().then(() => markRead(id))));
    for (const result of results) result.status === "fulfilled" ? read++ : failed++;
  }
  return { read, failed };
}
