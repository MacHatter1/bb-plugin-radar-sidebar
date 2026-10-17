import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  experimental_useThreadActions,
  useBbNavigate,
  useSdk,
  type BbNavigate,
  type PluginBoundThreadAction,
  type PluginSidebarThread,
  type PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";

/**
 * What the list and its rows do to a thread. BB 0.46 retired
 * `experimental_useSidebarThreadActions`. Opening goes through navigation and
 * pin, read and rename through the SDK, exactly as bb's own thread actions
 * do. Archive and delete run bb's own actions, because those own the
 * confirmation (child threads, undo) that a plain SDK call would skip.
 */
export interface RadarThreadActions {
  open(threadId: string, options?: { split?: boolean }): void;
  openNewThread(options: Parameters<BbNavigate["toCompose"]>[0]): void;
  setPinned(threadId: string, pinned: boolean): Promise<void>;
  setRead(threadId: string, read: boolean): Promise<void>;
  rename(threadId: string, title: string): Promise<void>;
  /** Does nothing for an archived thread: bb's action would unarchive it. */
  archive(threadId: string): void;
  requestDelete(threadId: string): void;
  /** A row binds bb's actions for its thread. */
  bind(threadId: string, binding: CoreBinding): void;
}

interface CoreBinding {
  archived: boolean;
  archive: PluginBoundThreadAction | undefined;
  delete: PluginBoundThreadAction | undefined;
}

/** bb's own thread-action keys, `<owner>/<id>`. */
export const CORE_ARCHIVE = "bb--core/archive";
export const CORE_DELETE = "bb--core/delete";
const CORE_KEYS = [CORE_ARCHIVE, CORE_DELETE];

/** One stable object for the list's lifetime, so memoised rows keep it. */
export function useRadarThreadActions(): RadarThreadActions {
  // Bindings outlive their row on purpose: a swipe delivers its archive as
  // the row unmounts, after layout cleanups have run. bb's actions are
  // app-wide, so a bound action stays valid once its row is gone.
  const navigate = useBbNavigate();
  const sdk = useSdk();
  const latest = useRef({ navigate, sdk });
  useLayoutEffect(() => {
    latest.current = { navigate, sdk };
  });
  const [actions] = useState<RadarThreadActions>(() => {
    const bound = new Map<string, CoreBinding>();
    const threads = () => latest.current.sdk.threads;
    return {
      open: (threadId, options) => latest.current.navigate.toThread(threadId, options),
      openNewThread: (options) => latest.current.navigate.toCompose(options),
      setPinned: async (threadId, pinned) => {
        await (pinned ? threads().pin({ threadId }) : threads().unpin({ threadId }));
      },
      setRead: async (threadId, read) => {
        await (read ? threads().markRead({ threadId }) : threads().markUnread({ threadId }));
      },
      rename: async (threadId, title) => {
        await threads().update({ threadId, title });
      },
      archive: (threadId) => {
        const binding = bound.get(threadId);
        if (binding && !binding.archived) void binding.archive?.run();
      },
      requestDelete: (threadId) => {
        void bound.get(threadId)?.delete?.run();
      },
      bind: (threadId, binding) => {
        bound.set(threadId, binding);
      },
    };
  });
  return actions;
}

/**
 * Bind bb's Archive and Delete for one row's thread. The list is not
 * virtualised, so every thread it can act on has a mounted row.
 */
export function useBindCoreThreadActions(
  thread: PluginSidebarThread,
  actions: RadarThreadActions,
): void {
  const environmentId = thread.environment?.id ?? null;
  const environmentPath = thread.environment?.path ?? null;
  const target = useMemo<PluginThreadActionTarget>(
    () => ({
      id: thread.id,
      projectId: thread.projectId,
      parentThreadId: thread.parentThreadId,
      archivedAt: thread.archivedAt,
      pinnedAt: thread.pinnedAt,
      sectionId: thread.sectionId,
      isUnread: thread.isUnread,
      status: thread.status,
      environment: environmentId ? { id: environmentId, path: environmentPath } : null,
    }),
    [
      thread.id,
      thread.projectId,
      thread.parentThreadId,
      thread.archivedAt,
      thread.pinnedAt,
      thread.sectionId,
      thread.isUnread,
      thread.status,
      environmentId,
      environmentPath,
    ],
  );
  const entries = experimental_useThreadActions(target, { keys: CORE_KEYS });
  const archive = entries.find((entry) => entry.key === CORE_ARCHIVE)?.action;
  const remove = entries.find((entry) => entry.key === CORE_DELETE)?.action;
  const archived = thread.isArchived;
  useLayoutEffect(() => {
    actions.bind(thread.id, { archived, archive, delete: remove });
  }, [actions, thread.id, archived, archive, remove]);
}
