import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { orderedProjectPins, type ProjectOrganisation } from "./projectOrganisation";
import { activityTime, isRunningThread, threadAttention } from "@/components/radar/time";

export interface RailProject extends PluginSidebarProject {
  total: number;
  working: number;
  waiting: number;
  failed: number;
  queued: number;
  scheduled: number;
  unread: number;
  latest: number;
}

/** Hide archived/hidden work; retain empty pinned and collected projects. */
export function projectRailProjects(
  projects: readonly PluginSidebarProject[],
  threads: readonly PluginSidebarThread[],
  pins: Readonly<Record<string, boolean>>,
  organisation: ProjectOrganisation,
  schedules: ReadonlyMap<string, number>,
  now: number,
): RailProject[] {
  const byId = new Map<string, RailProject>(projects.map(project => [project.id, {
    ...project, name: project.isPersonal ? "Personal" : project.name,
    total: 0, working: 0, waiting: 0, failed: 0, queued: 0,
    scheduled: 0, unread: 0, latest: 0,
  }]));
  for (const thread of threads) {
    if (thread.isArchived || thread.isHidden) continue;
    const project = byId.get(thread.projectId);
    if (!project) continue;
    project.total++;
    project.latest = Math.max(project.latest, activityTime(thread, now));
    if (thread.isUnread) project.unread++;
    const attention = threadAttention(thread, schedules.get(thread.id));
    if (attention === "failed") project.failed++;
    else if (attention === "needs-user" || thread.hasPendingInteraction) project.waiting++;
    else if (attention === "scheduled") project.scheduled++;
    else if (attention === "queued") project.queued++;
    else if (isRunningThread(thread)) project.working++;
  }
  const positions = new Map(orderedProjectPins(pins, organisation.pinOrder).map((id, i) => [id, i]));
  return [...byId.values()]
    .filter(project => project.total > 0 || pins[project.id] === true ||
      Object.hasOwn(organisation.collections, organisation.projectCollections[project.id] ?? ""))
    .sort((a, b) => Number(pins[b.id] === true) - Number(pins[a.id] === true) ||
      (pins[a.id] === true ? positions.get(a.id)! - positions.get(b.id)! : 0) ||
      Number(b.failed + b.waiting > 0) - Number(a.failed + a.waiting > 0) ||
      b.latest - a.latest || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** A project gets one corner badge; its card supplies the complete breakdown. */
export function projectRailBadge(project: RailProject): { kind: string; count: number; label: string } | null {
  for (const [kind, label] of [
    ["failed", "failed"], ["waiting", "need input"], ["working", "working"],
    ["unread", "unread"], ["queued", "queued"], ["scheduled", "scheduled"],
  ] as const) {
    if (project[kind] > 0) return { kind, count: project[kind], label };
  }
  return null;
}

export function projectRailSummary(project: RailProject): string {
  const parts = [`${project.total} ${project.total === 1 ? "thread" : "threads"}`];
  for (const [key, label] of [
    ["failed", "failed"], ["waiting", "need input"], ["working", "working"],
    ["queued", "queued"], ["scheduled", "scheduled"], ["unread", "unread"],
  ] as const) if (project[key]) parts.push(`${project[key]} ${label}`);
  return parts.join(" · ");
}

/** Ignore a common bb-plugin prefix so different plugins get different tiles. */
export function projectInitials(name: string): string {
  const words = name.split(/[\s\-_./]+/)
    .map(word => word.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
  if (words.length > 2 && words[0]!.toLowerCase() === "bb" && words[1]!.toLowerCase() === "plugin") words.splice(0, 2);
  if (!words.length) return "?";
  return (words.length === 1 ? [...words[0]!].slice(0, 2).join("") : [...words[0]!][0]! + [...words[1]!][0]!).toUpperCase();
}

export function projectHue(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return hash % 360;
}
