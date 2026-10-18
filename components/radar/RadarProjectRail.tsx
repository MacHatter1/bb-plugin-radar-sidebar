import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  experimental_Icon as HostIcon, experimental_useSidebarThreads, useBbNavigate, useSdk,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { projectHue, projectInitials, projectRailBadge, projectRailProjects, projectRailSummary, type RailProject } from "@/lib/projectRail";
import type { ProjectOrganisationChange } from "@/lib/projectOrganisation";
import { useChangeProjectOrganisation, useSetProjectPinned, useSettingValues } from "./settingsStore";
import { useScheduledThreads } from "./useScheduledThreads";
import { RadarProjectCard } from "./RadarProjectCard";
import { setProjectScope, useProjectScope } from "./projectScope";
import "./projectRail.css";

const tileStyle = (id: string): CSSProperties => ({ "--radar-project-hue": projectHue(id) }) as CSSProperties;

function RailPopover({ id, title, children, className = "" }: {
  id: string; title: string; children: ReactNode; className?: string;
}) {
  return <Popover.Portal><Popover.Content side="right" align="start" sideOffset={10} collisionPadding={12}
    aria-labelledby={id} className={`radar-project-popover ${className}`} onKeyDown={event => event.stopPropagation()}
    onCloseAutoFocus={event => {
      // Moving a tile into a collection unmounts its old popover. Its delayed
      // focus restoration must not dismiss another card the user just opened.
      if (document.activeElement?.closest(".radar-project-popover")) event.preventDefault();
    }}>
    <Popover.Close className="radar-project-close" aria-label={`Close ${title}`}><HostIcon name="X" aria-hidden="true" /></Popover.Close>
    {children}
  </Popover.Content></Popover.Portal>;
}

function ProjectTile({ project, pinned, selected, open, onOpenChange, onSelect, children }: {
  project: RailProject; pinned: boolean; selected: boolean; open: boolean;
  onOpenChange: (open: boolean) => void; onSelect: () => void; children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id, disabled: !pinned });
  const badge = projectRailBadge(project);
  const summary = projectRailSummary(project);
  return <Popover.Root open={open} onOpenChange={onOpenChange}>
    <Popover.Trigger asChild><button ref={setNodeRef} type="button"
      {...(pinned ? attributes : {})} {...(pinned ? listeners : {})}
      className={`radar-project-tile${selected ? " radar-project-tile-selected" : ""}${isDragging ? " radar-project-tile-dragging" : ""}`}
      style={{ ...tileStyle(project.id), transform: CSS.Transform.toString(transform), transition }}
      aria-label={`${project.name}, ${summary}`} aria-pressed={selected}
      aria-description={pinned ? "Pinned project. Press Enter to filter its threads, or Space and arrow keys to reorder. Right-click or press Shift+F10 to open its card." : "Filter this project's threads. Right-click or press Shift+F10 to open its card."}
      title={`${project.name}\n${summary}`}
      onClick={event => {
        // Prevent the popover trigger's automatic toggle when selecting.
        event.preventDefault();
        onSelect();
      }}
      onContextMenu={event => { event.preventDefault(); onOpenChange(true); }}
      onKeyDown={event => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault(); onOpenChange(true);
        } else if (pinned) listeners?.onKeyDown?.(event);
      }}>
      <span aria-hidden="true">{projectInitials(project.name)}</span>
      {pinned ? <span className="radar-project-pin" aria-hidden="true"><HostIcon name="Pin" /></span> : null}
      {badge ? <span className={`radar-project-badge radar-project-badge-${badge.kind}`} aria-hidden="true">
        {badge.kind === "scheduled" || badge.kind === "queued" ? <HostIcon name="Clock" /> : badge.count > 99 ? "99+" : badge.count}
      </span> : null}
    </button></Popover.Trigger>
    {children}
  </Popover.Root>;
}

/** Structural copy of the optional fork contract, so Radar still compiles
 * against the published SDK used by BB clients without this extension. */
export interface RadarProjectRailProps {
  compact?: boolean;
  state?: "expanded" | "collapsed";
  openSidebar?: () => void;
}

/** Project-only contribution. It never reads or rewrites the host rail DOM,
 * and it works when another plugin supplies the thread list. */
export function RadarProjectRail({ state, openSidebar }: RadarProjectRailProps = {}) {
  const { threads, projects, status } = experimental_useSidebarThreads();
  const projectScope = useProjectScope({ projects, status });
  const navigate = useBbNavigate();
  const sdk = useSdk();
  const settings = useSettingValues();
  const setPinned = useSetProjectPinned();
  const saveOrganisation = useChangeProjectOrganisation();
  const schedules = useScheduledThreads(threads, sdk);
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const submitting = useRef(false);
  const pickerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const { pinnedProjects, projectOrganisation } = settings;
  const railProjects = useMemo(() => projectRailProjects(projects, threads, pinnedProjects, projectOrganisation, schedules, Date.now()),
    [projects, threads, pinnedProjects, projectOrganisation, schedules]);
  const visiblePins = railProjects.filter(project => pinnedProjects[project.id] === true).map(project => project.id);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter", "Tab"] },
    }),
  );
  const changeOpen = (key: string, value: boolean) => setOpen(current => value ? key : current === key ? null : current);
  const finishNavigation = () => { setOpen(null); };
  const selectProject = (projectId: string) => {
    setOpen(null);
    setProjectScope(projectId);
    if (state === "collapsed") openSidebar?.();
  };
  const writePin = async (id: string, value: boolean) => {
    const ok = await setPinned(id, value);
    if (!ok) toast.error("Couldn’t save project pin", { description: "Please try again." });
    return ok;
  };
  const writeOrganisation = async (change: ProjectOrganisationChange) => {
    const ok = await saveOrganisation(change);
    if (!ok) toast.error("Couldn’t save project arrangement", { description: "Please try again." });
    return ok;
  };
  const movePin = (id: string, index: number) => {
    const from = visiblePins.indexOf(id);
    if (from < 0 || index < 0 || index >= visiblePins.length || from === index) return;
    const next = arrayMove(visiblePins, from, index);
    void writeOrganisation({ kind: "move-pin", projectId: id, beforeProjectId: next[index + 1] ?? null });
  };
  const markRead = async (unread: readonly PluginSidebarThread[]) => {
    const results = await Promise.allSettled(unread.map(thread => sdk.threads.markRead({ threadId: thread.id })));
    const failed = results.filter(result => result.status === "rejected").length;
    if (failed) toast.error(`Couldn’t mark ${failed} ${failed === 1 ? "thread" : "threads"} read`);
    const read = results.length - failed;
    if (read) toast.success(`Marked ${read} ${read === 1 ? "thread" : "threads"} read`);
  };
  const renderProject = (project: RailProject) => <ProjectTile key={project.id} project={project}
    pinned={pinnedProjects[project.id] === true} selected={projectScope === project.id}
    onSelect={() => selectProject(project.id)}
    open={open === `project:${project.id}`} onOpenChange={value => changeOpen(`project:${project.id}`, value)}>
    <RailPopover id={`${titleId}-${project.id}`} title={project.name}>
      <div style={tileStyle(project.id)}><RadarProjectCard project={project} threads={threads} schedules={schedules}
        pinned={pinnedProjects[project.id] === true} pinIndex={visiblePins.indexOf(project.id)} pinCount={visiblePins.length}
        organisation={projectOrganisation} setPinned={writePin} saveOrganisation={saveOrganisation} movePin={movePin} markRead={markRead}
        titleId={`${titleId}-${project.id}`} onNavigate={finishNavigation}
        openProject={() => { finishNavigation(); selectProject(project.id); navigate.toProject(project.id); }}
        newThread={() => { finishNavigation(); navigate.toCompose({ projectId: project.id, focusPrompt: true }); }}
        openThread={(id, split) => { finishNavigation(); if (split) navigate.toThread(id, { split: true }); else navigate.toThread(id); }} />
      </div>
    </RailPopover>
  </ProjectTile>;

  const unpinned = railProjects.filter(project => pinnedProjects[project.id] !== true);
  const ungrouped = unpinned.filter(project => !Object.hasOwn(projectOrganisation.collections, projectOrganisation.projectCollections[project.id] ?? ""));
  const availableCards = JSON.stringify([
    "all", ...Object.keys(projectOrganisation.collections).map(id => `collection:${id}`),
    ...railProjects.filter(project => pinnedProjects[project.id] === true ||
      !projectOrganisation.collections[projectOrganisation.projectCollections[project.id] ?? ""]?.collapsed)
      .map(project => `project:${project.id}`),
  ].sort());
  useEffect(() => {
    if (open && !(JSON.parse(availableCards) as string[]).includes(open)) {
      setOpen(null);
      pickerRef.current?.focus();
    }
  }, [open, availableCards]);
  return <div className="radar-project-rail" role="group" aria-label="Radar projects">
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={() => setOpen(null)}
      onDragEnd={({ active, over }) => {
        if (over && typeof active.id === "string" && typeof over.id === "string") movePin(active.id, visiblePins.indexOf(over.id));
      }} accessibility={{ screenReaderInstructions: { draggable: "Press Space to pick up a pinned project, use arrow keys to move it, and Space to drop. Escape cancels. Enter filters its threads. Shift+F10 opens its project card." } }}>
      <SortableContext items={visiblePins} strategy={verticalListSortingStrategy}>
        {railProjects.filter(project => pinnedProjects[project.id] === true).map(renderProject)}
        {Object.entries(projectOrganisation.collections).map(([id, collection]) => {
          const members = unpinned.filter(project => projectOrganisation.projectCollections[project.id] === id);
          return <div key={id} className="radar-project-collection" role="group" aria-label={`${collection.name} collection`}>
            <Popover.Root open={open === `collection:${id}`} onOpenChange={value => changeOpen(`collection:${id}`, value)}>
              <Popover.Trigger asChild><button className="radar-project-collection-trigger" type="button"
                aria-label={`${collection.name} collection, ${members.length} ${members.length === 1 ? "project" : "projects"}${collection.collapsed ? ", collapsed" : ""}`} title={collection.name}>
                <HostIcon name={collection.collapsed ? "Folder" : "FolderOpen"} aria-hidden="true" />
                <span aria-hidden="true">{projectInitials(collection.name)}</span>
              </button></Popover.Trigger>
              <RailPopover id={`${titleId}-collection-${id}`} title={collection.name}>
                <h2 id={`${titleId}-collection-${id}`}>{collection.name}</h2>
                <div className="radar-project-card-actions">
                  <button type="button" disabled={pending === id} onClick={() => void writeOrganisation({ kind: "collapse-collection", collectionId: id, collapsed: !collection.collapsed })}>
                    {collection.collapsed ? "Expand collection" : "Collapse collection"}
                  </button>
                </div>
                <form className="radar-project-collection-form" aria-label={`Rename ${collection.name} collection`}
                  onSubmit={async event => {
                    event.preventDefault();
                    if (submitting.current) return;
                    const name = event.currentTarget.querySelector<HTMLInputElement>('input[name="name"]')?.value.trim();
                    if (!name || name === collection.name) return;
                    submitting.current = true; setPending(id);
                    try { await writeOrganisation({ kind: "rename-collection", collectionId: id, name }); }
                    finally { submitting.current = false; setPending(null); }
                  }}>
                  <label>Collection name<input name="name" aria-label="Collection name"
                    defaultValue={collection.name} maxLength={64} required disabled={pending === id} /></label>
                  <div className="radar-project-card-actions"><button type="submit" disabled={pending === id}>Rename collection</button>
                    <button type="button" disabled={pending === id} onClick={async () => {
                      if (submitting.current) return;
                      submitting.current = true; setPending(id);
                      try { if (await writeOrganisation({ kind: "delete-collection", collectionId: id })) setOpen(null); }
                      finally { submitting.current = false; setPending(null); }
                    }}>Remove collection</button></div>
                </form>
              </RailPopover>
            </Popover.Root>
            {!collection.collapsed ? members.map(renderProject) : null}
          </div>;
        })}
        {ungrouped.map(renderProject)}
      </SortableContext>
    </DndContext>
    <Popover.Root open={open === "all"} onOpenChange={value => changeOpen("all", value)}>
      <Popover.Trigger asChild><button ref={pickerRef} type="button" className="radar-project-picker-trigger" aria-label="All projects" title="All projects">
        <HostIcon name="FolderSearch" aria-hidden="true" />
      </button></Popover.Trigger>
      <RailPopover id={`${titleId}-all`} title="All projects">
        <h2 id={`${titleId}-all`}>Projects</h2>
        <input className="radar-project-search" aria-label="Find a project" placeholder="Find a project…" value={query} onChange={event => setQuery(event.target.value)} />
        <div className="radar-project-picker-list">
          {projects.filter(project => project.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(project => <div className="radar-project-picker-row" key={project.id}>
            <button type="button" className="radar-project-picker-open" onClick={() => { finishNavigation(); selectProject(project.id); }}>
              <span className="radar-project-avatar" style={tileStyle(project.id)} aria-hidden="true">{projectInitials(project.isPersonal ? "Personal" : project.name)}</span>
              <span>{project.isPersonal ? "Personal" : project.name}</span>
            </button>
            <button type="button" disabled={pending === project.id} aria-label={`${pinnedProjects[project.id] ? "Unpin" : "Pin"} ${project.name}`}
              aria-pressed={pinnedProjects[project.id] === true} onClick={async () => {
                if (submitting.current) return;
                submitting.current = true; setPending(project.id);
                try { await writePin(project.id, pinnedProjects[project.id] !== true); }
                finally { submitting.current = false; setPending(null); }
              }}><HostIcon name={pinnedProjects[project.id] ? "PinOff" : "Pin"} aria-hidden="true" /></button>
          </div>)}
          {status !== "ready" ? <p className="radar-project-empty">{status === "loading" ? "Loading projects…" : "Projects are temporarily unavailable."}</p>
            : projects.length === 0 ? <p className="radar-project-empty">No projects yet.</p>
              : !projects.some(project => project.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ? <p className="radar-project-empty">No matching projects.</p> : null}
        </div>
      </RailPopover>
    </Popover.Root>
  </div>;
}
