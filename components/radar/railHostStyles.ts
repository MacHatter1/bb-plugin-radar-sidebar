/**
 * How the navigation rail restyles BB's own sidebar while it is mounted: the
 * gutter beside the rail, BB's header and Customize editor, the wider
 * panel in labelled mode, and BB's sidebar toggle.
 *
 * BB's footer keeps its default bottom bar under the thread list, to the
 * right of the rail. The gutter offsets it; its controls use the rail's
 * exact metrics (42px boxes, 20px icons, 8px gaps, rail hover) while BB
 * keeps the row layout, overflow and disclosures.
 *
 * RadarRailNavigation renders these as <style> elements in its own markup,
 * so they apply exactly while the rail is mounted and nothing is written to
 * BB's elements. Disabling the rail, switching providers or BB hiding the
 * sidebar body for Settings unmounts it and releases every override. Two
 * earlier designs each cost something: `:has()` anchored on body or the
 * sidebar made the browser restyle the page (or sidebar) on every DOM change
 * in BB, and data attributes stamped on BB's elements were fast but edited
 * host DOM.
 *
 * Blocks keep the cascade order they had in app.css. A block with a state
 * applies only in that state.
 */

export interface RailHostState {
  /** The labelled rail. */
  wide: boolean;
  /** BB's compact viewport: the rail in the mobile drawer. */
  compact: boolean;
  /** The rail's heading shows a project scope. */
  scoped: boolean;
}

const BLOCKS: readonly (readonly [keyof RailHostState | null, string])[] = [
  [null, `
/* Widths are shared by the rail, host gutter and host panel expansion. */
:is(html, .group.peer, [data-sidebar="sidebar"]) {
  --radar-rail-narrow: 60px;
  --radar-rail-mobile: 56px;
  --radar-rail-wide: 168px;
  --radar-rail-width: var(--radar-rail-narrow);
}
`],
  ["wide", `
:is(.group.peer, [data-sidebar="sidebar"]) {
  --radar-rail-width: var(--radar-rail-wide);
}
`],
  [null, `
@media (min-width: 768px) {
  /* BB's toggle is a fixed control outside the sidebar. On desktop macOS
     it is offset 84px to clear the traffic lights, which lands it in the
     thread column. Center it on the rail's icon column, under the lights,
     only while that sidebar is expanded. The toggle is a later sibling of
     the sidebar's .group.peer, so a sibling selector reads BB's own state. */
  div.group.peer[data-state="expanded"] ~ :is([data-testid="app-sidebar-trigger-overlay"], [data-testid="app-desktop-sidebar-trigger"]) {
    left: 0;
    width: calc(var(--radar-rail-narrow) - 1px);
    padding-left: 0;
    justify-content: center;
  }
  div.group.peer[data-state="expanded"] ~ [data-testid="app-desktop-sidebar-trigger"] {
    top: 22px;
    height: fit-content;
  }
}
`],
  ["wide", `
@media (min-width: 768px) {
  /* Labelled buttons place their icons 30px from the rail's left edge. */
  div.group.peer[data-state="expanded"] ~ :is([data-testid="app-sidebar-trigger-overlay"], [data-testid="app-desktop-sidebar-trigger"]) {
    width: var(--radar-rail-narrow);
  }
}
`],
  [null, `
@media (min-width: 768px) {
  [data-sidebar="sidebar"] {
    position: relative;
    padding-inline-start: var(--radar-rail-width);
  }
  /* BB's header row (sidebar trigger, history arrows) stays clickable
     above the rail surface that now runs behind it. The rail itself runs
     the full height; BB's footer keeps its default bar under the thread
     list, offset by the gutter. */
  [data-sidebar="sidebar"] > div:first-child {
    position: relative;
    z-index: 1;
  }
  /* Footer bar controls with the rail's exact metrics: 42px boxes, 20px
     icons at full opacity, 8px gaps. BB keeps its row layout, overflow
     and disclosure behaviour. */
  [data-sidebar="sidebar"] > [data-sidebar="footer"] {
    border-top: 1px solid var(--border);
    background: color-mix(in srgb, var(--sidebar, var(--background)) 94%, var(--foreground));
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu"] {
    gap: 8px;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-button"] {
    width: 42px;
    height: 42px;
    border-radius: 12px;
    color: var(--muted-foreground);
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-button"] [data-icon-root] {
    width: 20px;
    height: 20px;
    opacity: 1;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-button"]:hover:not(:disabled) {
    background: var(--sidebar-accent, var(--accent));
    color: var(--foreground);
  }
  /* Updates pill keeps BB's badge shape, tinted like the rail's accents. */
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"] > a:not([data-sidebar="menu-button"]) {
    background: color-mix(in srgb, var(--primary) 10%, transparent);
    color: var(--primary);
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"] > a:not([data-sidebar="menu-button"]):hover {
    background: color-mix(in srgb, var(--primary) 18%, transparent);
  }
}
`],
  [null, `
@container radar-thread-list (max-width: 300px) {
  /* Preserve title space when the rail shares a narrow host sidebar. */
  [data-sidebar="sidebar"] .radar-status-word,
  [data-sidebar="sidebar"] .radar-row-project {
    display: none;
  }
}
`],
  [null, `
[data-sidebar="sidebar"] .radar-status-chips {
  flex-wrap: wrap;
  overflow: visible;
}
`],
  ["scoped", `
[data-sidebar="sidebar"] .radar-list-scope { display: none; }
`],
  ["wide", `
@media (min-width: 768px) {
  [data-sidebar="sidebar"] { padding-inline-start: var(--radar-rail-width); }
  /* Grow the whole sidebar by the extra rail width so the thread list keeps
     its room. Targets the host's --sidebar-width wrappers (gap + fixed
     panel); both animate with the host's own 200ms width transition. */
  /* Respect BB's offcanvas collapse: its gap goes to zero and its panel
     returns to the host width, which matches the host's offscreen offset. */
  .group.peer[data-state="expanded"] > [data-sidebar="gap"],
  .group.peer[data-state="expanded"] > [data-sidebar="panel"] {
    width: calc(var(--sidebar-width) + var(--radar-rail-wide) - var(--radar-rail-narrow)) !important;
  }
}
`],
  [null, `
@media (min-width: 768px) {
  /* Same curve and duration as BB's own sidebar width transition, so the
     gutter, the rail and the host panel all move as one. */
  [data-sidebar="sidebar"] { transition: padding-inline-start 200ms linear; }
}
`],
  [null, `
@media (prefers-reduced-motion: reduce) {
  [data-sidebar="sidebar"] { transition: none; }
}
`],
  [null, `
@media (min-width: 768px) {
  @layer base {
    /* ---- BB's Customize editor beside the rail. ----
       Opening Customize makes BB hide this provider's wrapper and render its
       arrangement editor in the navigation region, which for a single-column
       nav is "in place". Here that region is the top of the thread column, so
       the editor shoved the list down and the rail blinked out. Keep the rail
       visible (so the user can see what they are arranging) and float the
       editor as a panel beside it. */
    /* BB's preflight hides [hidden] with an !important rule inside
       @layer base; important declarations in a layer outrank unlayered
       ones, so this joins that same layer (names are document-global) and
       wins there on specificity. */
    [data-sidebar="sidebar"] > nav > [hidden]:has(> [data-bb-plugin-root]) {
      display: contents !important;
    }
  }
}
`],
  [null, `
@media (min-width: 768px) {
  [data-sidebar="sidebar"] [data-sidebar-navigation-customize-mode="true"] {
    position: absolute;
    top: 56px;
    left: 68px;
    z-index: 4;
    width: min(300px, calc(100vw - 92px));
    padding: 0;
    pointer-events: auto;
  }
}
`],
  ["wide", `
@media (min-width: 768px) {
  [data-sidebar="sidebar"] [data-sidebar-navigation-customize-mode="true"] {
    left: calc(var(--radar-rail-width) + 8px);
  }
}
`],
  [null, `
@media (min-width: 768px) {
  [data-sidebar="sidebar"] [data-sidebar-navigation-customize-mode="true"] > div {
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--popover, var(--sidebar, var(--background)));
    box-shadow:
      0 12px 32px rgb(0 0 0 / 0.18),
      0 2px 6px rgb(0 0 0 / 0.08);
  }
  /* The rail's own Customize button reads as "open" while editing. */
  [data-sidebar="sidebar"]:has([data-sidebar-navigation-customize-mode="true"]) .radar-double-rail-footer button[aria-label="Customize sidebar"] {
    background: color-mix(in srgb, var(--primary) 12%, transparent);
    color: var(--primary);
  }
}
`],
  ["compact", `
@media (max-width: 767px) {
  :is([data-testid="app-sidebar-trigger-overlay"], [data-testid="app-desktop-sidebar-trigger"]) {
    width: calc(var(--radar-rail-mobile) - 1px);
    padding-left: 0;
    justify-content: center;
  }
  [data-sidebar="sidebar"]:not(:has([data-sidebar-navigation-customize-mode="true"])) {
    position: relative;
    --radar-rail-width: var(--radar-rail-mobile);
    padding-inline-start: var(--radar-rail-width);
  }
  /* BB's mobile Customize is a full-drawer screen that replaces the
     navigation (the drawer wraps it differently from desktop), so the
     gutter steps aside while it is open rather than floating a panel. */
}
`],
];

export function railHostCss(state: RailHostState): string {
  return BLOCKS.filter(([when]) => when === null || state[when])
    .map(([, css]) => css)
    .join("");
}
