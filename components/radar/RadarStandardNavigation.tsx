import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  experimental_Icon as HostIcon,
  experimental_useSidebarNavigation,
  type ExperimentalSidebarNavigationItem,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { RadarMenu, type RadarMenuItem } from "./RadarMenu";
import {
  hintFor,
  RowIcon,
  RowAccessory,
  NavigationButton,
  MorePopover,
} from "./navigationControls";
/**
 * Radar navigation that honors BB's own sidebar arrangement:
 * inline rows and the More popover follow the user's stock "Customize
 * sidebar" order + visibility exactly (server-synced UI preferences), and
 * Keep in sidebar / Move to More writes back to that same store — so
 * arranging in either nav carries over to the other.
 */
export function RadarStandardNavigation({
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
      item.action.kind !== "new-thread" &&
      item.action.kind !== "search-threads",
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
        <RowAccessory item={item} />
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
                item.action.kind === "new-thread" && "radar-nav-icon-primary",
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
              <RowAccessory item={item} />
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
          <div
            role="group"
            aria-label="Destinations"
            className="radar-nav-group"
          >
            {inlineDestinations.map(renderDestinationRow)}
            {renderMoreRow()}
          </div>
        ) : null}
      </nav>
      {renderOverlays()}
    </>
  );
}
