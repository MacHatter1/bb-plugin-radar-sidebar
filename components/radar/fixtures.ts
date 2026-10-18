import type {
  PluginSidebarProject,
  PluginSidebarSection,
  PluginSidebarThread,
  PluginThreadActionEntry,
} from "@get-bb/plugin-sdk/app";
import type {
  RenderedSlotInspectionState,
  TestThreadActionsResolver,
} from "@get-bb/plugin-sdk/testing/app";
import { CORE_ARCHIVE, CORE_DELETE } from "./threadActions";

/** Deterministic clock used across fixtures so grouping maths is stable. */
export const NOW = 1_790_000_000_000;
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

type ThreadFixture = Partial<PluginSidebarThread> & { id: string };

/**
 * A complete sidebar thread row. Every field is spelled out on purpose: when
 * the host adds a required field, the type errors here instead of a test
 * passing against a stale shape.
 */
export function makeThread(fixture: ThreadFixture): PluginSidebarThread {
  return {
    id: fixture.id,
    projectId: fixture.projectId ?? "proj_a",
    title: fixture.title ?? `Thread ${fixture.id}`,
    titleFallback: fixture.titleFallback ?? null,
    displayTitle: fixture.displayTitle ?? fixture.title ?? `Thread ${fixture.id}`,
    parentThreadId: fixture.parentThreadId ?? null,
    lifecycleOwnerThreadId: fixture.lifecycleOwnerThreadId ?? null,
    sourceThreadId: fixture.sourceThreadId ?? null,
    sectionId: fixture.sectionId ?? null,
    originKind: fixture.originKind ?? null,
    originPluginId: fixture.originPluginId ?? null,
    providerId: fixture.providerId ?? "pi",
    status: fixture.status ?? "idle",
    runtimeStatus: fixture.runtimeStatus ?? fixture.status ?? "idle",
    queuedWork: fixture.queuedWork ?? "none",
    hasPendingInteraction: fixture.hasPendingInteraction ?? false,
    activity: fixture.activity ?? {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: fixture.indicator ?? "none",
    indicatorLabel: fixture.indicatorLabel ?? null,
    isUnread: fixture.isUnread ?? false,
    isPinned: fixture.isPinned ?? false,
    pinnedAt: fixture.pinnedAt ?? null,
    pinSortKey: fixture.pinSortKey ?? null,
    isArchived: fixture.isArchived ?? false,
    archivedAt: fixture.archivedAt ?? null,
    href: fixture.href ?? `/projects/proj_a/threads/${fixture.id}`,
    isHidden: fixture.isHidden ?? false,
    environment:
      fixture.environment === undefined
        ? {
            id: `env_${fixture.id}`,
            name: null,
            branchName: null,
            path: null,
            isWorktree: false,
            providerId: "project-checkout",
            workspaceDisplayKind: null,
          }
        : fixture.environment,
    host: fixture.host === undefined ? { id: "host_1", name: "This Mac" } : fixture.host,
    createdAt: fixture.createdAt ?? NOW - DAY,
    updatedAt: fixture.updatedAt ?? NOW,
    lastReadAt: fixture.lastReadAt ?? NOW,
    latestAttentionAt: fixture.latestAttentionAt ?? fixture.updatedAt ?? NOW - DAY,
  };
}

export function makeProject(
  fixture: Partial<PluginSidebarProject> & { id: string },
): PluginSidebarProject {
  return {
    id: fixture.id,
    name: fixture.name ?? `Project ${fixture.id}`,
    isPersonal: fixture.isPersonal ?? false,
    href: fixture.href ?? `/projects/${fixture.id}`,
    settingsHref: fixture.settingsHref ?? `/projects/${fixture.id}/settings`,
  };
}

export function makeSection(
  fixture: Partial<PluginSidebarSection> & { id: string; name: string },
): PluginSidebarSection {
  return {
    id: fixture.id,
    name: fixture.name,
    createdAt: fixture.createdAt ?? NOW - DAY,
    updatedAt: fixture.updatedAt ?? NOW,
  };
}

/** One thing the list did to a thread, named as the user would put it. */
export interface ThreadActionCall {
  method: "open" | "openNewThread" | "setPinned" | "setRead" | "rename" | "archive" | "requestDelete";
  threadId?: string;
  options?: Record<string, unknown>;
  title?: string;
  pinned?: boolean;
  read?: boolean;
}

/**
 * bb's own Archive and Delete, which the harness does not emulate. Each run
 * is recorded in `runs`, standing in for bb's confirmation opening.
 */
export function recordCoreThreadActions(runs: ThreadActionCall[]): TestThreadActionsResolver {
  const entry = (key: string, method: "archive" | "requestDelete", threadId: string): PluginThreadActionEntry => ({
    key,
    pluginId: "bb--core",
    group: "4_lifecycle",
    action: {
      label: method === "archive" ? "Archive" : "Delete",
      icon: method === "archive" ? "Archive" : "Trash2",
      run: async () => {
        runs.push({ method, threadId });
      },
    },
  });
  return (thread) => [
    entry(CORE_ARCHIVE, "archive", thread.id),
    entry(CORE_DELETE, "requestDelete", thread.id),
  ];
}

/**
 * Navigation, thread writes and bb's own actions as one log. The list reaches
 * them through three APIs; a test asserts on what happened to the thread.
 */
export function threadActionCalls(
  inspection: RenderedSlotInspectionState,
  runs: readonly ThreadActionCall[],
): ThreadActionCall[] {
  const calls: ThreadActionCall[] = [];
  for (const call of inspection.navigateCalls) {
    if (call.method === "toThread") {
      calls.push({ method: "open", threadId: call.threadId, ...(call.options ? { options: call.options } : {}) });
    } else if (call.method === "toCompose") {
      calls.push({ method: "openNewThread", ...(call.options ? { options: call.options } : {}) });
    }
  }
  for (const { method, args } of inspection.sdkCalls) {
    const input = args[0] as { threadId: string; title?: unknown };
    if (method === "threads.pin" || method === "threads.unpin") {
      calls.push({ method: "setPinned", threadId: input.threadId, pinned: method === "threads.pin" });
    } else if (method === "threads.markRead" || method === "threads.markUnread") {
      calls.push({ method: "setRead", threadId: input.threadId, read: method === "threads.markRead" });
    } else if (method === "threads.update" && typeof input.title === "string") {
      calls.push({ method: "rename", threadId: input.threadId, title: input.title });
    }
  }
  return [...calls, ...runs];
}
