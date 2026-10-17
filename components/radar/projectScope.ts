import { useEffect, useSyncExternalStore } from "react";
import type { PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";

// Per-client view state shared by Radar's rail and thread-list slots.
// Keep the former rail's key so existing project choices survive the update.
const SCOPE_KEY = "radar-sidebar:rail-scope:v1";
let transientScope: string | null = null;
const listeners = new Set<() => void>();

function readScope(): string | null {
  try { return localStorage.getItem(SCOPE_KEY) || null; }
  catch { return transientScope; }
}

export function setProjectScope(projectId: string | null): void {
  transientScope = projectId;
  try {
    if (projectId === null) localStorage.removeItem(SCOPE_KEY);
    else localStorage.setItem(SCOPE_KEY, projectId);
  } catch { /* The filter still works when storage is unavailable. */ }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === SCOPE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** An empty project remains selectable. Only a complete project directory
 * can establish that the chosen project has been removed. */
export function useProjectScope({ projects, status }: Pick<PluginSidebarThreadsState, "projects" | "status">): string | null {
  const chosen = useSyncExternalStore(subscribe, readScope, () => null);
  const invalid = status === "ready" && chosen !== null && !projects.some(project => project.id === chosen);
  useEffect(() => {
    if (invalid && readScope() === chosen) setProjectScope(null);
  }, [invalid, chosen]);
  return invalid ? null : chosen;
}
