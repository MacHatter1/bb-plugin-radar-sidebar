import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import Home01Icon from "@hugeicons/core-free-icons/Home01Icon";
import ArrowLeftDoubleIcon from "@hugeicons/core-free-icons/ArrowLeftDoubleIcon";
import ArrowRightDoubleIcon from "@hugeicons/core-free-icons/ArrowRightDoubleIcon";
import { toast } from "sonner";
import {
  experimental_Icon as HostIcon,
  experimental_useSidebarNavigation,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useSdk,
  type ExperimentalSidebarNavigationItem,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { RadarMenu, type RadarMenuItem } from "./RadarMenu";
import {
  monogram,
  projectHue,
  setRailScope,
  useValidatedRailScope,
} from "./railScope";
import { activityTime, isLiveThread, isWaitingThread } from "./time";
import {
  hintFor,
  RowIcon,
  RailItemIcon,
  NavigationButton,
  MorePopover,
} from "./navigationControls";
import { RailTooltip, moveRailFocus, type RailTip } from "./railTooltip";
import { useRailHostStructure, useRailMeasurements } from "./railLayout";
import { railHostCss } from "./railHostStyles";
import { useSetRailLiveStatus, useSettingValues } from "./settingsStore";
import { isRailLiveStatus } from "@/lib/settings";
import { isMacosDesktop, openProjectInFinder } from "./projectFinder";

export type RailProject = {
  id: string;
  name: string;
  threads: number;
  live: number;
  /** Live work that isn't blocked on you; the badge's count, so no thread is in two badges. */
  active: number;
  waiting: number;
  unread: number;
  latest: number;
};

function sameRailProjects(
  a: readonly RailProject[],
  b: readonly RailProject[],
): boolean {
  return (
    a.length === b.length &&
    a.every((project, index) => {
      const other = b[index]!;
      return (
        project.id === other.id &&
        project.name === other.name &&
        project.threads === other.threads &&
        project.live === other.live &&
        project.active === other.active &&
        project.waiting === other.waiting &&
        project.unread === other.unread
      );
    })
  );
}

/** Projects with at least one visible thread: needs-you first, then most recently active. */
function useRailProjects(pinNeedsYou: boolean) {
  const { threads, projects, status } = experimental_useSidebarThreads();
  const previous = useRef<RailProject[]>([]);
  const railProjects = useMemo(() => {
    const now = Date.now();
    const byId = new Map<string, RailProject>();
    for (const thread of threads) {
      if (thread.isHidden || thread.isArchived) continue;
      let entry = byId.get(thread.projectId);
      if (!entry) {
        const project = projects.find(
          (candidate) => candidate.id === thread.projectId,
        );
        if (!project) continue;
        entry = {
          id: project.id,
          name: project.isPersonal ? "Personal" : project.name,
          threads: 0,
          live: 0,
          active: 0,
          waiting: 0,
          unread: 0,
          latest: 0,
        };
        byId.set(project.id, entry);
      }
      entry.threads += 1;
      const live = isLiveThread(thread);
      const waiting = isWaitingThread(thread);
      if (live) entry.live += 1;
      if (waiting) entry.waiting += 1;
      if (live && !waiting && !thread.hasPendingInteraction) entry.active += 1;
      if (thread.isUnread) entry.unread += 1;
      entry.latest = Math.max(entry.latest, activityTime(thread, now));
    }
    // With badges on, a project that needs you stays on top until that's
    // resolved; the rest (and ties among those that need you) follow recent
    // activity.
    const next = [...byId.values()].sort(
      (a, b) =>
        (pinNeedsYou ? Number(b.waiting > 0) - Number(a.waiting > 0) : 0) ||
        b.latest - a.latest,
    );
    // Every thread update lands here. Keep the previous list when nothing
    // the tiles show moved, so they skip rendering.
    return sameRailProjects(previous.current, next) ? previous.current : next;
  }, [threads, projects, pinNeedsYou]);
  previous.current = railProjects;
  return { railProjects, projects, status };
}

function projectTally(project: RailProject): string {
  const parts = [
    `${project.threads} ${project.threads === 1 ? "thread" : "threads"}`,
    project.waiting > 0 ? `${project.waiting} waiting` : null,
    project.live > 0 ? `${project.live} live` : null,
    project.unread > 0 ? `${project.unread} unread` : null,
  ].filter((part): part is string => part !== null);
  return parts.join(" · ");
}

function badgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** Needs you, working, unread. Decorative: the tile's description carries the tally. */
export function ProjectBadges({ project }: { project: RailProject }) {
  if (project.waiting + project.active + project.unread === 0) return null;
  return (
    <span className="radar-rail-badges" aria-hidden="true">
      {project.waiting > 0 ? (
        <span className="radar-rail-badge radar-rail-badge-waiting">
          {badgeCount(project.waiting)}
        </span>
      ) : null}
      {project.active > 0 ? (
        <span className="radar-rail-badge radar-rail-badge-active">
          {badgeCount(project.active)}
        </span>
      ) : null}
      {project.unread > 0 ? (
        <span className="radar-rail-badge radar-rail-badge-unread">
          {badgeCount(project.unread)}
        </span>
      ) : null}
    </span>
  );
}

/** The loudest thing a project tile shows: needs you beats working beats unread. */
export function projectRailState(project: Pick<RailProject, "waiting" | "active" | "unread">): "waiting" | "working" | "unread" | "quiet" {
  if (project.waiting > 0) return "waiting";
  if (project.active > 0) return "working";
  if (project.unread > 0) return "unread";
  return "quiet";
}

/**
 * A project tile's leading glyph in the chosen style. Tiles keep the hue
 * monogram; Rings carry state in the ring (amber glow, working arc) with
 * the monogram inside; Chips are a dot-plus-monogram pill edged by state.
 * Wide rows reuse the same end counts, so only the glyph and chrome vary.
 */
export function ProjectGlyph({ project, style }: {
  project: Pick<RailProject, "name" | "waiting" | "active" | "unread">;
  style: string;
}) {
  const letters = monogram(project.name);
  if (style === "Rings") {
    if (projectRailState(project) === "working") {
      return (
        <span className="radar-rail-ringwrap" aria-hidden="true">
          <span className="radar-rail-arc" />
          <span className="radar-rail-ringcore">{letters}</span>
        </span>
      );
    }
    return (
      <span
        className={cn(
          "radar-rail-ring",
          projectRailState(project) === "waiting" && "radar-rail-ring-waiting",
        )}
        aria-hidden="true"
      >
        {letters}
      </span>
    );
  }
  if (style === "Chips") {
    return (
      <span className="radar-rail-chip" aria-hidden="true">
        <span className="radar-rail-chipdot" />
        <span className="radar-rail-chipmono">{letters}</span>
      </span>
    );
  }
  return (
    <span className="radar-rail-monogram" aria-hidden="true">
      {letters}
    </span>
  );
}

const RAIL_WIDE_KEY = "radar-sidebar:rail-wide:v1";

function readRailWide(): boolean {
  try {
    return localStorage.getItem(RAIL_WIDE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeRailWide(wide: boolean): void {
  try {
    localStorage.setItem(RAIL_WIDE_KEY, wide ? "1" : "0");
  } catch {
    // Preference simply won't persist.
  }
}
/**
 * Radar navigation that honors BB's own sidebar arrangement:
 * inline rows and the More popover follow the user's stock "Customize
 * sidebar" order + visibility exactly (server-synced UI preferences), and
 * Keep in sidebar / Move to More writes back to that same store — so
 * arranging in either nav carries over to the other.
 */
function RailNavigationBody({
  isCompactViewport,
}: ExperimentalSidebarNavigationProps) {
  const { items, activeItemId, actions, isShortcutModifierHeld } =
    experimental_useSidebarNavigation();
  const threadActions = experimental_useSidebarThreadActions();
  const sdk = useSdk();
  const canOpenFinder = isMacosDesktop();
  const { wideRail, projectBadges, projectStyle, railLiveStatus } = useSettingValues();
  const saveLiveStatus = useSetRailLiveStatus();
  // The rail is the layout on every viewport; compact only changes what
  // rides on it (no hover tooltips, no wide mode) and the gutter width.
  const [moreAt, setMoreAt] = useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    itemId: string;
  } | null>(null);
  const [projectMenu, setProjectMenu] = useState<{
    x: number;
    y: number;
    projectId: string;
  } | null>(null);
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  const [wideChoice, setWide] = useState(readRailWide);
  const {
    railProjects,
    projects,
    status: projectStatus,
  } = useRailProjects(projectBadges);
  const scope = useValidatedRailScope({ projects, status: projectStatus });
  const project = scope
    ? projects.find((candidate) => candidate.id === scope)
    : null;
  const scopedProject = project
    ? { id: project.id, name: project.isPersonal ? "Personal" : project.name }
    : null;

  const toggleWide = () => {
    setWide((previous) => {
      writeRailWide(!previous);
      return !previous;
    });
  };
  // Wide mode restyles BB's own sidebar markup, so it ships off and needs
  // the plugin setting on, plus the host structure it relies on. Without
  // either, the toggle is hidden and the rail stays narrow.
  const wideAllowed = wideRail && !isCompactViewport;
  const hostSupportsWide = useRailHostStructure(railRef);
  const wide = wideChoice && wideAllowed && hostSupportsWide;
  // BB's sidebar is restyled from the rail's own <style> element below,
  // never by writing to BB's elements, so unmounting releases it.
  const scoped = scopedProject !== null;
  const hostCss = useMemo(
    () => railHostCss({ wide, compact: isCompactViewport, scoped }),
    [wide, isCompactViewport, scoped],
  );

  // Rail tooltip: armed on hover/focus after a short delay, dropped on
  // leave, blur, click, right-click, or when any overlay opens.
  const [tip, setTip] = useState<RailTip | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTip = useCallback(() => {
    if (tipTimer.current !== null) clearTimeout(tipTimer.current);
    tipTimer.current = null;
    setTip(null);
  }, []);
  const showTip = useCallback(
    (
      target: HTMLElement,
      next: Omit<RailTip, "top" | "left">,
      delay: number,
    ) => {
      if (tipTimer.current !== null) clearTimeout(tipTimer.current);
      const show = () => {
        tipTimer.current = null;
        const rect = target.getBoundingClientRect();
        setTip({
          ...next,
          top: rect.top + rect.height / 2,
          left: rect.right + 10,
        });
      };
      if (delay === 0) show();
      else tipTimer.current = setTimeout(show, delay);
    },
    [],
  );
  useEffect(() => hideTip, [hideTip]);
  useEffect(() => {
    if (isCompactViewport) hideTip();
  }, [isCompactViewport, hideTip]);

  // Callbacks and derived lists stay stable across thread updates so the
  // memoized destination buttons and project tiles below skip rendering.
  const activate = useCallback(
    (item: ExperimentalSidebarNavigationItem, openInSplit: boolean) => {
      if (item.isDisabled || item.isLoading) return;
      hideTip();
      setMoreAt(null);
      setMenu(null);
      setProjectMenu(null);
      actions.activate(item.id, { openInSplit });
    },
    [actions, hideTip],
  );
  // With a project scoped, New thread starts in that project. openNewThread
  // can't open a split, so a split activation keeps the host's behaviour.
  const scopedProjectId = scopedProject?.id ?? null;
  const activateNewThread = useCallback(
    (item: ExperimentalSidebarNavigationItem, openInSplit: boolean) => {
      if (scopedProjectId === null || openInSplit) {
        activate(item, openInSplit);
        return;
      }
      if (item.isDisabled || item.isLoading) return;
      hideTip();
      setMoreAt(null);
      setMenu(null);
      setProjectMenu(null);
      threadActions.openNewThread({
        projectId: scopedProjectId,
        focusPrompt: true,
      });
    },
    [activate, hideTip, scopedProjectId, threadActions],
  );
  const closeMore = useCallback(() => setMoreAt(null), []);

  const { inlineDestinations, overflow, newThread } = useMemo(() => {
    const destinations = items.filter(
      (item) => item.action.kind !== "new-thread",
    );
    return {
      inlineDestinations: destinations.filter((item) => item.isVisible),
      overflow: destinations.filter((item) => !item.isVisible),
      newThread: items.find((item) => item.action.kind === "new-thread"),
    };
  }, [items]);

  useRailMeasurements(railRef, items, railProjects.length);

  const overflowActive =
    activeItemId !== null && overflow.some((item) => item.id === activeItemId);

  const openMenu = useCallback(
    (clientX: number, clientY: number, item: ExperimentalSidebarNavigationItem) => {
      hideTip();
      setProjectMenu(null);
      setMenu({ x: clientX, y: clientY, itemId: item.id });
    },
    [hideTip],
  );

  const openProjectMenu = useCallback((clientX: number, clientY: number, projectId: string) => {
    hideTip();
    setMoreAt(null);
    setMenu(null);
    setProjectMenu({ x: clientX, y: clientY, projectId });
  }, [hideTip]);
  const projectMenuItem = projectMenu ? projects.find((candidate) => candidate.id === projectMenu.projectId) : null;

  // Tooltip wiring for one rail control. Hover waits briefly so sweeping the
  // pointer down the rail doesn't flicker; keyboard focus shows at once.
  const tipProps = useCallback(
    (next: Omit<RailTip, "top" | "left">) =>
      !isCompactViewport
        ? {
            onPointerEnter: (event: React.PointerEvent<HTMLElement>) =>
              showTip(event.currentTarget, next, 220),
            onPointerLeave: hideTip,
            onFocus: (event: React.FocusEvent<HTMLElement>) =>
              showTip(event.currentTarget, next, 0),
            onBlur: hideTip,
          }
        : {},
    [isCompactViewport, showTip, hideTip],
  );

  const menuItem = menu
    ? (items.find((item) => item.id === menu.itemId) ?? null)
    : null;
  // Neighbours within the same bucket (inline or More), so "Move up/down"
  // visibly swaps with what sits next to the item on screen.
  const menuSiblings = menuItem
    ? menuItem.isVisible
      ? inlineDestinations
      : overflow
    : [];
  const menuIndex = menuItem ? menuSiblings.indexOf(menuItem) : -1;
  const menuItems = useMemo<RadarMenuItem[]>(() => {
    if (!menuItem) return [];
    const list: RadarMenuItem[] = [];
    if (menuItem.experimental_Accessory) {
      const mode = railLiveStatus[menuItem.id] ?? "off";
      list.push({ kind: "header", label: "Live status" });
      for (const [value, label] of [
        ["off", "Off (dot indicator)"],
        ["badge", "As a badge"],
        ["icon", "Instead of the icon"],
      ] as const) list.push({ kind: "item", id: `live-status:${value}`, label, checked: mode === value });
      list.push({ kind: "separator" });
    }
    if (menuItem.action.kind === "open-plugin-panel") {
      list.push({
        kind: "item",
        id: "open-split",
        label: "Open in split",
        icon: "Columns2",
      });
      list.push({ kind: "separator" });
    }
    const isInline = menuItem.isVisible;
    list.push({
      kind: "item",
      id: "toggle",
      label: isInline ? "Move to More" : "Keep in sidebar",
      icon: isInline ? "PinOff" : "Pin",
      checked: isInline,
    });
    if (menuSiblings.length > 1) {
      list.push({ kind: "separator" });
      list.push({
        kind: "item",
        id: "move-up",
        label: "Move up",
        icon: "ArrowUp",
        disabled: menuIndex <= 0,
      });
      list.push({
        kind: "item",
        id: "move-down",
        label: "Move down",
        icon: "ArrowDown",
        disabled: menuIndex === -1 || menuIndex >= menuSiblings.length - 1,
      });
    }
    if (menuItem.pluginId) {
      list.push({ kind: "separator" });
      list.push({
        kind: "item",
        id: "details",
        label: "Plugin details",
        icon: "Puzzle",
      });
    }
    return list;
  }, [menuItem, menuSiblings, menuIndex, railLiveStatus]);

  // Swap the item with its on-screen neighbour inside BB's full order.
  const moveMenuItem = (direction: -1 | 1) => {
    const neighbour = menuSiblings[menuIndex + direction];
    if (!menuItem || !neighbour) return;
    const order = items.map((item) => item.id);
    const from = order.indexOf(menuItem.id);
    const to = order.indexOf(neighbour.id);
    if (from === -1 || to === -1) return;
    order.splice(from, 1);
    order.splice(to, 0, menuItem.id);
    actions.setOrder(order);
  };

  const openMore = (event: MouseEvent<HTMLButtonElement>) => {
    hideTip();
    setProjectMenu(null);
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 248;
    const x =
      rect.right + 8 + width <= window.innerWidth
        ? rect.right + 8
        : Math.max(8, rect.left - width - 8);
    setMoreAt({ x, y: rect.top });
  };

  const renderMoreRow = () => {
    if (overflow.length === 0) return null;

    return (
      <button
        key="__more"
        ref={moreTriggerRef}
        type="button"
        aria-label={`More navigation, ${overflow.length} items`}
        aria-expanded={moreAt !== null}
        title={!isCompactViewport ? undefined : `More (${overflow.length})`}
        onClick={(event) =>
          moreAt !== null ? setMoreAt(null) : openMore(event)
        }
        className={cn(
          "radar-nav-icon-button",
          (moreAt !== null || overflowActive) && "radar-nav-row-active",
        )}
        {...tipProps({
          key: "__more",
          label: "More",
          shortcut: null,
          hint: `${overflow.length} hidden ${overflow.length === 1 ? "destination" : "destinations"}`,
          Accessory: null,
        })}
      >
        <HostIcon name="MoreHorizontal" aria-hidden="true" />
        <span className="radar-rail-label">More</span>
        <span className="radar-nav-count" aria-hidden="true">
          {overflow.length}
        </span>
      </button>
    );
  };

  const renderOverlays = () => (
    <>
      {moreAt !== null && overflow.length > 0 ? (
        <MorePopover
          x={moreAt.x}
          y={moreAt.y}
          items={overflow}
          activeItemId={activeItemId}
          onActivate={activate}
          onOpenMenu={openMenu}
          onClose={closeMore}
          triggerRef={moreTriggerRef}
        />
      ) : null}
      {menu && menuItem ? (
        <RadarMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onSelect={(id) => {
            const target = menuItem;
            setMenu(null);
            const mode = id.startsWith("live-status:") ? id.slice("live-status:".length) : null;
            if (target.experimental_Accessory && isRailLiveStatus(mode)) {
              void saveLiveStatus(target.id, mode);
            } else if (id === "open-split") {
              activate(target, true);
            } else if (id === "toggle") {
              actions.setVisible(target.id, !target.isVisible);
            } else if (id === "move-up") {
              moveMenuItem(-1);
            } else if (id === "move-down") {
              moveMenuItem(1);
            } else if (id === "details") {
              actions.openDetails(target.id);
            }
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {canOpenFinder && projectMenu && projectMenuItem ? (
        <RadarMenu
          x={projectMenu.x}
          y={projectMenu.y}
          label="Project actions"
          items={[
            { kind: "header", label: projectMenuItem.isPersonal ? "Personal" : projectMenuItem.name },
            { kind: "item", id: "open-finder", label: "Open in Finder", icon: "Folder" },
          ]}
          onSelect={() => {
            const projectId = projectMenu.projectId;
            setProjectMenu(null);
            void openProjectInFinder(sdk, projectId).catch((error: unknown) => {
              toast.error("Couldn’t open project in Finder", {
                description: error instanceof Error ? error.message : undefined,
              });
            });
          }}
          onClose={() => setProjectMenu(null)}
        />
      ) : null}
      {!isCompactViewport && tip && !moreAt && !menu && !projectMenu ? <RailTooltip tip={tip} /> : null}
    </>
  );

  const destinationButtons = useMemo(
    () =>
      inlineDestinations.map((item) => {
        const hasMenu = item.action.kind !== "search-threads";
        return (
          <NavigationButton
            key={item.id}
            item={item}
            isActive={item.id === activeItemId}
            onActivate={activate}
            title={!isCompactViewport ? null : hintFor(item)}
            className={cn(
              "radar-nav-icon-button",
              item.id === activeItemId && "radar-nav-row-active",
            )}
            onContextMenu={
              hasMenu
                ? (event) => {
                    event.preventDefault();
                    openMenu(event.clientX, event.clientY, item);
                  }
                : undefined
            }
            {...tipProps({
              key: item.id,
              label: item.label,
              shortcut: item.shortcut?.label ?? null,
              hint: hasMenu ? "Right-click to arrange" : null,
              Accessory: item.experimental_Accessory,
              accessoryFallback: <RowIcon item={item} />,
            })}
          >
            <RailItemIcon item={item} mode={railLiveStatus[item.id] ?? "off"} />
            <span className="radar-rail-label">{item.label}</span>
            {isShortcutModifierHeld && item.shortcut ? (
              <kbd className="radar-double-shortcut">
                {item.shortcut.label}
              </kbd>
            ) : null}
          </NavigationButton>
        );
      }),
    [
      inlineDestinations,
      activeItemId,
      isCompactViewport,
      isShortcutModifierHeld,
      activate,
      openMenu,
      tipProps,
      railLiveStatus,
    ],
  );

  const projectTiles = useMemo(
    () =>
      railProjects.length > 0 ? (
        <div role="group" aria-label="Projects" className="radar-rail-projects">
          <span className="radar-rail-divider" aria-hidden="true" />
          {railProjects.map((project) => {
            const isScoped = project.id === scope;
            return (
              <button
                key={project.id}
                type="button"
                aria-pressed={isScoped}
                aria-label={`${project.name}: ${isScoped ? "show every project" : "show only this project"}`}
                aria-description={projectTally(project)}
                className={cn(
                  "radar-nav-icon-button radar-rail-project",
                  projectStyle === "Rings" && "radar-rail-style-rings",
                  projectStyle === "Chips" && "radar-rail-style-chips",
                  `radar-rail-state-${projectRailState(project)}`,
                  isScoped && "radar-rail-project-active",
                )}
                style={
                  {
                    "--radar-project-hue": projectHue(project.id),
                  } as React.CSSProperties
                }
                onClick={() => {
                  hideTip();
                  setRailScope(isScoped ? null : project.id);
                }}
                onContextMenu={canOpenFinder ? (event) => {
                  event.preventDefault();
                  openProjectMenu(event.clientX, event.clientY, project.id);
                } : undefined}
                {...tipProps({
                  key: `project:${project.id}`,
                  label: project.name,
                  shortcut: null,
                  hint: `${projectTally(project)}${isScoped ? " — click to clear" : ""}`,
                  Accessory: null,
                })}
              >
                <ProjectGlyph project={project} style={projectStyle} />
                <span className="radar-rail-label">{project.name}</span>
                {projectBadges ? <ProjectBadges project={project} /> : null}
              </button>
            );
          })}
        </div>
      ) : null,
    [railProjects, scope, hideTip, tipProps, projectBadges, projectStyle, canOpenFinder, openProjectMenu],
  );

  return (
    <div
      className={cn(
        "radar-double-navigation",
        wide && "radar-double-navigation-wide",
        isCompactViewport && "radar-double-navigation-compact",
      )}
    >
      <nav
        ref={railRef}
        aria-label="Primary"
        className={cn("radar-nav radar-nav-compact", "radar-double-rail")}
        onKeyDown={moveRailFocus}
      >
        <div className={"radar-double-rail-items"}>
          <button
            type="button"
            aria-label="Home"
            aria-pressed={scope === null}
            title={isCompactViewport ? "Show every project" : undefined}
            className="radar-nav-icon-button radar-nav-icon-primary"
            onClick={() => {
              hideTip();
              setMoreAt(null);
              setMenu(null);
              setProjectMenu(null);
              setRailScope(null);
            }}
            {...tipProps({
              key: "__home",
              label: "Home",
              shortcut: null,
              hint: "Show every project",
              Accessory: null,
            })}
          >
            <HugeiconsIcon icon={Home01Icon} aria-hidden="true" />
            <span className="radar-rail-label">Home</span>
          </button>
          {destinationButtons}
          {renderMoreRow()}
          {projectTiles}
        </div>
        <div className="radar-double-rail-footer">
          <span className="radar-rail-divider" aria-hidden="true" />
          {wideAllowed && hostSupportsWide ? (
            <button
              type="button"
              className="radar-nav-icon-button radar-rail-toggle"
              aria-label={wide ? "Hide labels" : "Show labels"}
              aria-pressed={wide}
              onClick={() => {
                hideTip();
                toggleWide();
              }}
              {...tipProps({
                key: "__wide",
                label: wide ? "Hide labels" : "Show labels",
                shortcut: null,
                hint: wide ? "Back to the icon rail" : "Widen the rail",
                Accessory: null,
              })}
            >
              <HugeiconsIcon
                icon={wide ? ArrowLeftDoubleIcon : ArrowRightDoubleIcon}
                aria-hidden="true"
              />
              <span className="radar-rail-label">Collapse</span>
            </button>
          ) : null}
          <button
            type="button"
            className="radar-nav-icon-button"
            aria-label="Customize sidebar"
            onClick={() => {
              hideTip();
              actions.openCustomize();
            }}
            {...tipProps({
              key: "__customize",
              label: "Customize",
              shortcut: null,
              hint: "Reorder and hide destinations",
              Accessory: null,
            })}
          >
            <HostIcon name="SlidersHorizontal" aria-hidden="true" />
            <span className="radar-rail-label">Customize</span>
          </button>
        </div>
      </nav>
      <div className="radar-double-heading">
        {scopedProject ? (
          <button
            type="button"
            className="radar-double-heading-scope"
            aria-label={`Showing ${scopedProject.name} only. Show every project`}
            title="Show every project"
            onClick={() => setRailScope(null)}
          >
            <span
              className="radar-rail-monogram"
              aria-hidden="true"
              style={
                {
                  "--radar-project-hue": projectHue(scopedProject.id),
                } as React.CSSProperties
              }
            >
              {monogram(scopedProject.name)}
            </span>
            <span className="radar-double-heading-title">
              {scopedProject.name}
            </span>
            <HostIcon
              name="X"
              aria-hidden="true"
              className="radar-double-heading-clear"
            />
          </button>
        ) : (
          <span className="radar-double-heading-title">Threads</span>
        )}
        {newThread ? (
          <NavigationButton
            item={newThread}
            isActive={false}
            onActivate={activateNewThread}
            className="radar-double-new-thread"
            title={`${hintFor(newThread)} — Option-click opens in a split`}
          >
            <RowIcon item={newThread} />
            <span>New thread</span>
          </NavigationButton>
        ) : null}
      </div>
      {renderOverlays()}
      <style>{hostCss}</style>
    </div>
  );
}

export function RadarRailNavigation(props: ExperimentalSidebarNavigationProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [bodyVisible, setBodyVisible] = useState(true);

  // BB retains the app sidebar beneath a hidden body while Settings is
  // shown. Unmount the rail in that body so its :has() styles and layout
  // effects release the gutter and labelled width.
  // Observe the sidebar's direct child, not the provider's own wrapper:
  // Customize hides that inner wrapper while intentionally keeping the rail.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const sidebar = root?.closest('[data-sidebar="sidebar"]');
    if (!root || !sidebar) return;
    let body: HTMLElement = root;
    while (body.parentElement && body.parentElement !== sidebar) {
      body = body.parentElement;
    }
    const sync = () => setBodyVisible(!body.hidden);
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(body, { attributes: true, attributeFilter: ["hidden"] });
    return () => observer.disconnect();
  }, []);

  // BB still owns and renders the footer as a bottom bar under the thread
  // list, to the right of the rail. The rail runs the full height beside it.
  return (
    <div ref={rootRef}>
      {bodyVisible ? <RailNavigationBody {...props} /> : null}
    </div>
  );
}
