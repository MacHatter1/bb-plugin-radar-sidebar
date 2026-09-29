import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  experimental_Icon as HostIcon,
  useSdk,
  type ExperimentalSidebarNavigationItem,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { RadarMenu, type RadarMenuItem } from "./RadarMenu";
import {
  computePlacement,
  sameKeys,
  stockKeyFor,
  toggleVisibleKey,
  STOCK_KEY_SEARCH_THREADS,
} from "./navVisibility";

const ORDER_PREF = "sidebar.pluginPanelOrder" as const;
const VISIBLE_PREF = "sidebar.visiblePluginPanels" as const;
const MAX_SAVE_ATTEMPTS = 5;

/** Resolve a host navigation item to a BB icon name. */
function iconNameFor(item: ExperimentalSidebarNavigationItem): string {
  if (item.icon.kind === "host") {
    switch (item.icon.name) {
      case "new-thread":
        return "Plus";
      case "search":
        return "Search";
      case "extensions":
        return "Puzzle";
    }
  }
  return item.icon.icon ?? "Zap";
}

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
  return (
    <HostIcon name={iconNameFor(item)} aria-hidden="true" className={className} />
  );
}

function isConflict(cause: unknown): boolean {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "status" in cause &&
    (cause as { status?: unknown }).status === 409
  ) {
    return true;
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.includes("409");
}

interface PrefsSnapshot {
  order: string[];
  orderRev: number;
  visible: string[] | null;
  visibleRev: number;
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
            <button
              key={item.id}
              type="button"
              disabled={item.isDisabled}
              aria-label={hintFor(item)}
              aria-current={isActive ? "page" : undefined}
              title={`${hintFor(item)} — Option-click opens in a split`}
              {...item.experimental_splitProps}
              onClick={(event) => {
                if (item.isDisabled) return;
                onActivate(item, event.altKey);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                onOpenMenu(event.clientX, event.clientY, item);
              }}
              className={cn("radar-nav-row", isActive && "radar-nav-row-active")}
            >
              <RowIcon item={item} className="radar-nav-icon" />
              <span className="radar-nav-label">{item.label}</span>
            </button>
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
  items,
  activeItemId,
  isCompactViewport,
  experimental_activate,
}: ExperimentalSidebarNavigationProps) {
  const sdk = useSdk();
  const [prefs, setPrefs] = useState<PrefsSnapshot | null>(null);
  const [prefsSettled, setPrefsSettled] = useState(false);
  const [moreAt, setMoreAt] = useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    itemId: string;
  } | null>(null);
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);

  const loadPrefs = useCallback(async () => {
    try {
      const list = await sdk.system.uiPreferences.list();
      const orderEntry = list.preferences[ORDER_PREF];
      const visibleEntry = list.preferences[VISIBLE_PREF];
      if (!orderEntry || !visibleEntry) return;
      setPrefs({
        order: [...orderEntry.value],
        orderRev: orderEntry.revision,
        visible: visibleEntry.value === null ? null : [...visibleEntry.value],
        visibleRev: visibleEntry.revision,
      });
    } catch {
      // Fall through to the stock-default layout below.
    } finally {
      setPrefsSettled(true);
    }
  }, [sdk]);

  useEffect(() => {
    let abandoned = false;
    void loadPrefs().catch(() => {
      if (!abandoned) setPrefsSettled(true);
    });
    const onFocus = () => {
      if (!abandoned) void loadPrefs();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      abandoned = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [loadPrefs]);

  const activate = (
    item: ExperimentalSidebarNavigationItem,
    openInSplit: boolean,
  ) => {
    if (item.isDisabled) return;
    setMoreAt(null);
    setMenu(null);
    experimental_activate(item.id, { openInSplit });
  };

  const placement = useMemo(() => {
    if (!prefsSettled) return null;
    if (!prefs) {
      // Prefs unavailable: stock defaults — everything except Search inline.
      const ordered = [...items];
      const visible = ordered.filter(
        (item) => stockKeyFor(item) !== STOCK_KEY_SEARCH_THREADS,
      );
      return {
        ordered,
        visible,
        visibleKeys: visible.map(stockKeyFor),
        normalizedOrder: ordered.map(stockKeyFor),
        normalizedVisibleKeys: null as string[] | null,
      };
    }
    return computePlacement(items, prefs.order, prefs.visible);
  }, [items, prefs, prefsSettled]);

  const visibleKeys = useMemo(
    () => new Set(placement?.visibleKeys ?? []),
    [placement],
  );
  const inline = placement?.visible ?? [];
  const overflow = useMemo(() => {
    if (!placement) return [];
    const visibleSet = new Set(placement.visibleKeys);
    return placement.ordered.filter(
      (item) =>
        item.action.kind !== "new-thread" &&
        item.action.kind !== "search-threads" &&
        !visibleSet.has(stockKeyFor(item)),
    );
  }, [placement]);

  const newThread = items.find((item) => item.action.kind === "new-thread");
  // New thread is the fixed header, always inline. Search threads is
  // deliberately not rendered anywhere: the thread list's own filter plus
  // the ⌘K quick palette cover it. Only destinations follow the stock
  // inline/More arrangement. (Placement is still computed over all items so
  // visibility writes preserve the stock keys we don't render.)
  const showNewThread = newThread !== undefined;
  const inlineDestinations = inline.filter(
    (item) =>
      item.action.kind !== "new-thread" && item.action.kind !== "search-threads",
  );

  const overflowActive =
    activeItemId !== null && overflow.some((item) => item.id === activeItemId);

  const setRowVisible = useCallback(
    async (key: string, show: boolean) => {
      for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
        const list = await sdk.system.uiPreferences.list();
        const orderEntry = list.preferences[ORDER_PREF];
        const visibleEntry = list.preferences[VISIBLE_PREF];
        if (!orderEntry || !visibleEntry) {
          throw new Error("Sidebar preferences are unavailable.");
        }
        const current = computePlacement(
          items,
          orderEntry.value,
          visibleEntry.value,
        );
        const base =
          current.normalizedVisibleKeys ?? current.visibleKeys;
        const nextVisible = toggleVisibleKey(base, key, show);
        try {
          const visibleResult = await sdk.system.uiPreferences.set({
            key: VISIBLE_PREF,
            value: nextVisible,
            expectedRevision: visibleEntry.revision,
          });
          if (!sameKeys(current.normalizedOrder, orderEntry.value)) {
            try {
              const orderResult = await sdk.system.uiPreferences.set({
                key: ORDER_PREF,
                value: current.normalizedOrder,
                expectedRevision: orderEntry.revision,
              });
              setPrefs({
                order: [...orderResult.value],
                orderRev: orderResult.revision,
                visible: [...nextVisible],
                visibleRev: visibleResult.revision,
              });
            } catch {
              // Order normalization is best-effort; visibility already saved.
              setPrefs({
                order: [...orderEntry.value],
                orderRev: orderEntry.revision,
                visible: [...nextVisible],
                visibleRev: visibleResult.revision,
              });
            }
          } else {
            setPrefs({
              order: [...orderEntry.value],
              orderRev: orderEntry.revision,
              visible: [...nextVisible],
              visibleRev: visibleResult.revision,
            });
          }
          return;
        } catch (cause) {
          if (isConflict(cause) && attempt + 1 < MAX_SAVE_ATTEMPTS) continue;
          throw cause;
        }
      }
      throw new Error("Couldn’t save sidebar visibility (conflict).");
    },
    [sdk, items],
  );

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
    const isInline = visibleKeys.has(stockKeyFor(menuItem));
    list.push({
      kind: "item",
      id: "toggle",
      label: isInline ? "Move to More" : "Keep in sidebar",
      icon: isInline ? "PinOff" : "Pin",
      checked: isInline,
    });
    return list;
  }, [menuItem, visibleKeys]);

  const openMore = (event: MouseEvent<HTMLButtonElement>) => {
    void loadPrefs();
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
      <button
        key={item.id}
        type="button"
        disabled={item.isDisabled}
        aria-label={hintFor(item)}
        aria-current={isActive ? "page" : undefined}
        aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
        title={`${hintFor(item)} — Option-click opens in a split`}
        {...item.experimental_splitProps}
        onClick={(event) => activate(item, event.altKey)}
        onContextMenu={(event) => {
          event.preventDefault();
          openMenu(event.clientX, event.clientY, item);
        }}
        className={cn("radar-nav-row", isActive && "radar-nav-row-active")}
      >
        <RowIcon item={item} className="radar-nav-icon" />
        <span className="radar-nav-label">{item.label}</span>
      </button>
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
              const key = stockKeyFor(target);
              const show = !visibleKeys.has(key);
              setRowVisible(key, show).catch((cause: unknown) => {
                toast.error(
                  cause instanceof Error ? cause.message : String(cause),
                );
              });
            }
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </>
  );

  const renderLoadingDestinations = () => (
    <div
      role="group"
      aria-label="Destinations"
      className="radar-nav-group"
      aria-busy="true"
    >
      {[0, 1, 2].map((index) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={index} className="radar-nav-loading-bar" aria-hidden="true" />
      ))}
    </div>
  );

  if (isCompactViewport) {
    const inlineItems = [
      ...(showNewThread && newThread ? [newThread] : []),
      ...inlineDestinations,
    ];
    return (
      <>
        <nav aria-label="Primary" className="radar-nav radar-nav-compact">
          {prefsSettled ? (
            <>
              {inlineItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={item.isDisabled}
                  aria-label={hintFor(item)}
                  aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
                  title={hintFor(item)}
                  {...item.experimental_splitProps}
                  onClick={(event) => activate(item, event.altKey)}
                  onContextMenu={
                    item.action.kind !== "new-thread" &&
                    item.action.kind !== "search-threads"
                      ? (event) => {
                          event.preventDefault();
                          openMenu(event.clientX, event.clientY, item);
                        }
                      : undefined
                  }
                  className={cn(
                    "radar-nav-icon-button",
                    item.id === activeItemId && "radar-nav-row-active",
                    item.action.kind === "new-thread" &&
                      "radar-nav-icon-primary",
                  )}
                >
                  <RowIcon item={item} />
                </button>
              ))}
              {renderMoreRow()}
            </>
          ) : (
            <div className="radar-nav-loading-compact" aria-hidden="true">
              {[0, 1, 2].map((index) => (
                // eslint-disable-next-line react/no-array-index-key
                <div key={index} className="radar-nav-loading-dot" />
              ))}
            </div>
          )}
        </nav>
        {renderOverlays()}
      </>
    );
  }

  return (
    <>
      <nav aria-label="Primary" className="radar-nav">
        {showNewThread && newThread ? (
          <button
            key={newThread.id}
            type="button"
            disabled={newThread.isDisabled}
            aria-label={hintFor(newThread)}
            aria-keyshortcuts={newThread.shortcut?.ariaKeyShortcuts}
            title={`${hintFor(newThread)} — Option-click opens in a split`}
            {...newThread.experimental_splitProps}
            onClick={(event) => activate(newThread, event.altKey)}
            className="radar-nav-primary"
          >
            <RowIcon item={newThread} className="radar-nav-icon" />
            <span className="radar-nav-label">{newThread.label}</span>
            {newThread.shortcut ? (
              <kbd className="radar-kbd radar-kbd-on-primary">
                {newThread.shortcut.label}
              </kbd>
            ) : null}
          </button>
        ) : null}

        {!prefsSettled ? (
          renderLoadingDestinations()
        ) : inlineDestinations.length > 0 || overflow.length > 0 ? (
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
