import { useRef, useState } from "react";
import { experimental_Icon as HostIcon, UrlLink, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { projectInitials, projectRailSummary, type RailProject } from "@/lib/projectRail";
import type { ProjectOrganisation, ProjectOrganisationChange } from "@/lib/projectOrganisation";
import { activityTime, isRunningThread, threadAttention } from "./time";
import { ProjectCollectionForm } from "./ProjectCollectionForm";

export function RadarProjectCard({ project, threads, schedules, pinned, pinIndex, pinCount, organisation,
  saveOrganisation, setPinned, movePin, markRead, openProject, newThread, openThread, onNavigate, titleId,
}: {
  project: RailProject;
  threads: readonly PluginSidebarThread[];
  schedules: ReadonlyMap<string, number>;
  pinned: boolean;
  pinIndex: number;
  pinCount: number;
  organisation: ProjectOrganisation;
  saveOrganisation: (change: ProjectOrganisationChange) => Promise<boolean>;
  setPinned: (id: string, pinned: boolean) => Promise<boolean>;
  movePin: (id: string, index: number) => void;
  markRead: (threads: readonly PluginSidebarThread[]) => Promise<void>;
  openProject: () => void;
  newThread: () => void;
  openThread: (id: string, split: boolean) => void;
  onNavigate: () => void;
  titleId: string;
}) {
  const [editingCollection, setEditingCollection] = useState(false);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const visible = threads.filter(thread => thread.projectId === project.id && !thread.isHidden && !thread.isArchived);
  const recent = [...visible].sort((a, b) =>
    Number(b.hasPendingInteraction || threadAttention(b) === "needs-user") -
    Number(a.hasPendingInteraction || threadAttention(a) === "needs-user") ||
    activityTime(b, Date.now()) - activityTime(a, Date.now()) || a.id.localeCompare(b.id),
  ).slice(0, 5);
  const perform = async (action: () => Promise<unknown>) => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    try { await action(); }
    finally { submitting.current = false; setPending(false); }
  };
  return <>
    <div className="radar-project-card-heading">
      <span className="radar-project-avatar" aria-hidden="true">{projectInitials(project.name)}</span>
      <h2 id={titleId}>{project.name}</h2>
      <button type="button" aria-label={pinned ? `Unpin ${project.name}` : `Pin ${project.name}`}
        aria-pressed={pinned} disabled={pending} onClick={() => void perform(() => setPinned(project.id, !pinned))}>
        <HostIcon name={pinned ? "PinOff" : "Pin"} aria-hidden="true" />
      </button>
    </div>
    <p className="radar-project-summary">{projectRailSummary(project)}</p>
    <div className="radar-project-card-actions">
      <button type="button" onClick={openProject}>Open project</button>
      <button type="button" onClick={newThread}><HostIcon name="Plus" aria-hidden="true" />New thread</button>
    </div>
    <div className="radar-project-recent" aria-label={`${project.name} recent threads`}>
      {recent.length === 0 ? <p className="radar-project-empty">No active threads yet.</p> : recent.map(thread => {
        const attention = threadAttention(thread, schedules.get(thread.id));
        const label = attention === "needs-user" || thread.hasPendingInteraction ? "Needs input"
          : attention === "failed" ? "Failed" : attention === "scheduled" ? "Scheduled"
            : attention === "queued" ? "Queued" : isRunningThread(thread) ? "Working"
              : thread.isUnread ? "Unread" : "Idle";
        return <button key={thread.id} type="button" className="radar-project-recent-thread"
          aria-label={`Open ${thread.displayTitle}`} onClick={event => openThread(thread.id, event.metaKey || event.ctrlKey)}>
          <span className="radar-project-thread-title">{thread.displayTitle}</span>
          <span className="radar-project-thread-state">{label}</span>
        </button>;
      })}
    </div>
    <div className="radar-project-card-actions radar-project-secondary-actions">
      <button type="button" disabled={pending || project.unread === 0}
        onClick={() => void perform(() => markRead(visible.filter(thread => thread.isUnread)))}>Mark project read</button>
      <button type="button" aria-expanded={editingCollection} onClick={() => setEditingCollection(value => !value)}>Collection…</button>
      <UrlLink href={project.settingsHref} onClick={onNavigate}>Project settings</UrlLink>
    </div>
    {pinned ? <div className="radar-project-card-actions radar-project-secondary-actions" aria-label="Pin order">
      <button type="button" disabled={pinIndex <= 0 || pending} onClick={() => movePin(project.id, pinIndex - 1)}>Move pin up</button>
      <button type="button" disabled={pinIndex < 0 || pinIndex >= pinCount - 1 || pending}
        onClick={() => movePin(project.id, pinIndex + 1)}>Move pin down</button>
    </div> : null}
    {editingCollection ? <ProjectCollectionForm projectId={project.id} organisation={organisation}
      save={saveOrganisation} onDone={() => setEditingCollection(false)} /> : null}
  </>;
}
