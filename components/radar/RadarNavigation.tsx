import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  experimental_Icon as HostIcon,
  experimental_SidebarNavigationIcon as SidebarNavigationIcon,
  experimental_useSidebarNavigation,
  experimental_useSidebarNavigationSplit,
  type ExperimentalSidebarNavigationItem,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { RadarMenu, type RadarMenuItem } from "./RadarMenu";
function hintFor(item: ExperimentalSidebarNavigationItem): string {
  const parts = [item.label];
  if (item.shortcut) parts.push(`(${item.shortcut.label})`);
  return parts.join(" ");
}

function RowIcon({
  item,
  className,
}: {
  item: ExperimentalSidebarNavigationItem;
  className?: string;
}) {
  return <SidebarNavigationIcon icon={item.icon} className={className} />;
}

function NavigationButton({
  item,
  isActive,
  onActivate,
  className,
  title,
  onContextMenu,
  splitActivation = "sidebar",
  onSplitDragStart,
  children,
}: {
  item: ExperimentalSidebarNavigationItem;
  isActive: boolean;
  onActivate: (
    item: ExperimentalSidebarNavigationItem,
    openInSplit: boolean,
  ) => void;
  className: string;
  title?: string;
  onContextMenu?: React.MouseEventHandler<HTMLButtonElement>;
  splitActivation?: "distance" | "sidebar";
  onSplitDragStart?: () => void;
  children: React.ReactNode;
}) {
  const split = experimental_useSidebarNavigationSplit(
    item.id,
    splitActivation === "distance"
      ? { activation: "distance", onDragStart: onSplitDragStart }
      : undefined,
  );

  return (
    <button
      type="button"
      disabled={item.isDisabled || item.isLoading}
      aria-label={hintFor(item)}
      aria-current={isActive ? "page" : undefined}
      aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
      title={title ?? hintFor(item)}
      {...split.splitProps}
      onClick={(event) => onActivate(item, event.altKey)}
      onContextMenu={onContextMenu}
      className={className}
    >
      {children}
    </button>
  );
}

/**
 * The "More" overflow popover: fixed to the side of the trigger (like BB's
 * stock popover), scrollable, closes on selection, Escape, resize, or an
 * outside pointer-down. All listeners are removed on unmount.
 */
function MorePopover({
  x,
  y,
  items,
  activeItemId,
  onActivate,
  onOpenMenu,
  onClose,
  triggerRef,
}: {
  x: number;
  y: number;
  items: readonly ExperimentalSidebarNavigationItem[];
  activeItemId: string | null;
  onActivate: (item: ExperimentalSidebarNavigationItem, openInSplit: boolean) => void;
  onOpenMenu: (
    clientX: number,
    clientY: number,
    item: ExperimentalSidebarNavigationItem,
  ) => void;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = 248;
  const estimatedHeight = Math.min(items.length * 34 + 16, 380);
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - estimatedHeight - 8));

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onScroll = (event: Event) => {
      if (ref.current && ref.current.contains(event.target as Node)) return;
      onClose();
    };
    const onResize = () => onClose();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [onClose]);

  useEffect(() => {
    ref.current?.focus();
    return () => {
      triggerRef.current?.focus();
    };
  }, [triggerRef]);

  return createPortal(
    <div
      ref={ref}
      role="group"
      tabIndex={-1}
      aria-label="More navigation"
      className="radar-nav-more-pop"
      style={{ left, top, width }}
    >
      <div className="radar-nav-more-list">
        {items.map((item) => {
          const isActive = item.id === activeItemId;
          return (
            <NavigationButton
              key={item.id}
              item={item}
              isActive={isActive}
              onActivate={onActivate}
              title={`${hintFor(item)} — Option-click opens in a split`}
              splitActivation="distance"
              onSplitDragStart={onClose}
              onContextMenu={(event) => {
                event.preventDefault();
                onOpenMenu(event.clientX, event.clientY, item);
              }}
              className={cn("radar-nav-row", isActive && "radar-nav-row-active")}
            >
              <RowIcon item={item} className="radar-nav-icon" />
              <span className="radar-nav-label">{item.label}</span>
            </NavigationButton>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Radar navigation that honors BB's own sidebar arrangement:
 * inline rows and the More popover follow the user's stock "Customize
 * sidebar" order + visibility exactly (server-synced UI preferences), and
 * Keep in sidebar / Move to More writes back to that same store — so
 * arranging in either nav carries over to the other.
 */
export function RadarNavigation({
  isCompactViewport,
}: ExperimentalSidebarNavigationProps) {
  const { items, activeItemId, actions } = experimental_useSidebarNavigation();
  const [moreAt, setMoreAt] = useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    itemId: string;
  } | null>(null);
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);

  const activate = (
    item: ExperimentalSidebarNavigationItem,
    openInSplit: boolean,
  ) => {
    if (item.isDisabled || item.isLoading) return;
    setMoreAt(null);
    setMenu(null);
    actions.activate(item.id, { openInSplit });
  };

  const destinations = items.filter(
    (item) =>
      item.action.kind !== "new-thread" && item.action.kind !== "search-threads",
  );
  const inlineDestinations = destinations.filter((item) => item.isVisible);
  const overflow = destinations.filter((item) => !item.isVisible);

  const newThread = items.find((item) => item.action.kind === "new-thread");
  // New thread stays in the fixed header; the list filter and quick palette
  // cover Search. BB owns destination order, visibility and persistence.
  const showNewThread = newThread !== undefined;

  const overflowActive =
    activeItemId !== null && overflow.some((item) => item.id === activeItemId);

  const openMenu = (
    clientX: number,
    clientY: number,
    item: ExperimentalSidebarNavigationItem,
  ) => {
    setMenu({ x: clientX, y: clientY, itemId: item.id });
  };

  const menuItem = menu
    ? (items.find((item) => item.id === menu.itemId) ?? null)
    : null;
  const menuItems = useMemo<RadarMenuItem[]>(() => {
    if (!menuItem) return [];
    const list: RadarMenuItem[] = [];
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
    return list;
  }, [menuItem]);

  const openMore = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 248;
    const x =
      rect.right + 8 + width <= window.innerWidth
        ? rect.right + 8
        : Math.max(8, rect.left - width - 8);
    setMoreAt({ x, y: rect.top });
  };

  const renderDestinationRow = (item: ExperimentalSidebarNavigationItem) => {
    const isActive = item.id === activeItemId;
    return (
      <NavigationButton
        key={item.id}
        item={item}
        isActive={isActive}
        onActivate={activate}
        title={`${hintFor(item)} — Option-click opens in a split`}
        className={cn("radar-nav-row", isActive && "radar-nav-row-active")}
        onContextMenu={(event) => {
          event.preventDefault();
          openMenu(event.clientX, event.clientY, item);
        }}
      >
        <RowIcon item={item} className="radar-nav-icon" />
        <span className="radar-nav-label">{item.label}</span>
      </NavigationButton>
    );
  };

  const renderMoreRow = () => {
    if (overflow.length === 0) return null;
    if (isCompactViewport) {
      return (
        <button
          key="__more"
          ref={moreTriggerRef}
          type="button"
          aria-label={`More navigation, ${overflow.length} items`}
          aria-expanded={moreAt !== null}
          title={`More (${overflow.length})`}
          onClick={(event) =>
            moreAt !== null ? setMoreAt(null) : openMore(event)
          }
          className={cn(
            "radar-nav-icon-button",
            overflowActive && "radar-nav-row-active",
          )}
        >
          <HostIcon name="MoreHorizontal" aria-hidden="true" />
          <span className="radar-nav-count" aria-hidden="true">
            {overflow.length}
          </span>
        </button>
      );
    }
    return (
      <button
        key="__more"
        ref={moreTriggerRef}
        type="button"
        aria-label={`More navigation, ${overflow.length} items`}
        aria-expanded={moreAt !== null}
        title={`More (${overflow.length})`}
        onClick={(event) =>
          moreAt !== null ? setMoreAt(null) : openMore(event)
        }
        aria-current={overflowActive ? "page" : undefined}
        className={cn(
          "radar-nav-row",
          (moreAt !== null || overflowActive) && "radar-nav-row-active",
        )}
      >
        <HostIcon
          name="MoreHorizontal"
          aria-hidden="true"
          className="radar-nav-icon"
        />
        <span className="radar-nav-label">More</span>
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
          onClose={() => setMoreAt(null)}
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
            if (id === "open-split") {
              activate(target, true);
            } else if (id === "toggle") {
              actions.setVisible(target.id, !target.isVisible);
            }
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </>
  );

  if (isCompactViewport) {
    const inlineItems = [
      ...(showNewThread && newThread ? [newThread] : []),
      ...inlineDestinations,
    ];
    return (
      <>
        <nav aria-label="Primary" className="radar-nav radar-nav-compact">
          {inlineItems.map((item) => (
            <NavigationButton
              key={item.id}
              item={item}
              isActive={item.id === activeItemId}
              onActivate={activate}
              title={hintFor(item)}
              className={cn(
                "radar-nav-icon-button",
                item.id === activeItemId && "radar-nav-row-active",
                item.action.kind === "new-thread" &&
                  "radar-nav-icon-primary",
              )}
              onContextMenu={
                item.action.kind !== "new-thread" &&
                item.action.kind !== "search-threads"
                  ? (event) => {
                      event.preventDefault();
                      openMenu(event.clientX, event.clientY, item);
                    }
                  : undefined
              }
            >
              <RowIcon item={item} />
            </NavigationButton>
          ))}
          {renderMoreRow()}
        </nav>
        {renderOverlays()}
      </>
    );
  }

  return (
    <>
      <nav aria-label="Primary" className="radar-nav">
        {showNewThread && newThread ? (
          <NavigationButton
            key={newThread.id}
            item={newThread}
            isActive={newThread.id === activeItemId}
            onActivate={activate}
            title={`${hintFor(newThread)} — Option-click opens in a split`}
            className="radar-nav-primary"
          >
            <RowIcon item={newThread} className="radar-nav-icon" />
            <span className="radar-nav-label">{newThread.label}</span>
            {newThread.shortcut ? (
              <kbd className="radar-kbd radar-kbd-on-primary">
                {newThread.shortcut.label}
              </kbd>
            ) : null}
          </NavigationButton>
        ) : null}

        {inlineDestinations.length > 0 || overflow.length > 0 ? (
          <div role="group" aria-label="Destinations" className="radar-nav-group">
            {inlineDestinations.map(renderDestinationRow)}
            {renderMoreRow()}
          </div>
        ) : null}
      </nav>
      {renderOverlays()}
    </>
  );
}
