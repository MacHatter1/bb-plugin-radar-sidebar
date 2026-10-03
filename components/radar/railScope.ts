import { useEffect, useSyncExternalStore } from "react";
import type { PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";

/**
 * The project scope chosen on the navigation rail, shared with the thread
 * list. A double navigation's rail picks *where*; the list shows *what is
 * there*. Both slots live in this bundle, so a module-level store is all
 * the bridge they need. Remembered per client so a reload lands you back
 * in the project you were working in.
 */

const SCOPE_KEY = "radar-sidebar:rail-scope:v1";

function readScope(): string | null {
  try {
    return localStorage.getItem(SCOPE_KEY) || null;
  } catch {
    return null;
  }
}

let scope: string | null = readScope();
const listeners = new Set<() => void>();

export function setRailScope(projectId: string | null): void {
  if (projectId === scope) return;
  scope = projectId;
  try {
    if (projectId) localStorage.setItem(SCOPE_KEY, projectId);
    else localStorage.removeItem(SCOPE_KEY);
  } catch {
    // Preference simply won't persist.
  }
  for (const listener of listeners) listener();
}

/** Stable subscription prevents needless listener churn on rerenders. */
export function subscribeRailScope(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The scoped project id, or null for every project. */
export function useRailScope(): string | null {
  return useSyncExternalStore(
    subscribeRailScope,
    () => scope,
    () => null,
  );
}

/** Validate against the project directory, not the active-thread tiles.
 * A project with no active threads can still have archives. Loading/error
 * snapshots cannot tell us whether a remembered project was deleted. */
export function useValidatedRailScope({
  projects,
  status,
}: Pick<PluginSidebarThreadsState, "projects" | "status">): string | null {
  const chosenScope = useRailScope();
  const invalid =
    status === "ready" &&
    chosenScope !== null &&
    !projects.some((project) => project.id === chosenScope);
  useEffect(() => {
    if (invalid) setRailScope(null);
  }, [invalid, chosenScope]);
  return invalid ? null : chosenScope;
}

/** Test hook: clear the scope and every subscriber. */
export function resetRailScope(): void {
  scope = null;
  listeners.clear();
  try {
    localStorage.removeItem(SCOPE_KEY);
  } catch {
    // Ignore.
  }
}

/** Two-letter monogram for a project tile: "bb-plugin-radar" → "BP". */
export function monogram(name: string): string {
  const words = name
    .split(/[\s\-_./]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/** Stable hue per project so tiles keep their colour across sessions. */
export function projectHue(id: string): number {
  // FNV-1a, then a golden-angle spread so ids that share a prefix (every
  // "proj_…") still land on distinct hues.
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return Math.round((hash % 1000) * 137.508) % 360;
}
