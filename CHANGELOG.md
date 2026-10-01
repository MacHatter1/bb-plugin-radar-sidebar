# Changelog

All notable changes to Radar Sidebar are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- **Swipe actions** (`swipeActions`, default `true`): swipe a thread row left
  or right to act on it, with one finger on a touch screen or two fingers on
  a trackpad (a Mac, or an iPad with a Magic Keyboard). Each side is
  configurable (`swipeRight`, default mark read / unread; `swipeLeft`,
  default archive / unarchive) from: mark read / unread, pin / unpin,
  archive / unarchive, open in split, rename, more actions, delete
  (host-confirmed), or nothing.
  - The row tracks the input, a colored pill grows from the edge with its
    icon growing alongside, and the icon pops when the swipe arms (a third
    of the row by touch, over half by trackpad), with a short haptic tick
    where supported. On release a spring carries the input's speed home, so
    a flick flows into the settle; a swipe that rests before release carries
    no speed. The pill keeps the label of what was done while it closes.
  - Archiving (or unarchiving from the Archived tab) slides the row away and
    folds its space before the host acts; on the All tab the row stays and
    springs back, and so does a thread with replies, whose archive the host
    confirms first.
  - Trackpads report no lift-off, so a trackpad swipe stopped short of
    arming rests open with its action as a button, as in Mail on a Mac:
    click it to act; press elsewhere, scroll or press Escape to close; move
    again to carry on. One row stays open at a time. A swipe keeps following
    after the row slides out from under the cursor, and the momentum tail
    after a release is swallowed.
  - Vertical movement stays a scroll, the host drawer does not react to a
    row swipe, releasing a swipe never opens the thread, and mouse clicks
    and drags are unaffected.

## 0.3.0 - 2026-09-30

### Added

- **Two-line titles** (`twoLineTitles`, default `false`): long thread titles,
  including mentions, wrap before truncating. Project chip and time stay
  beside short titles when they fit, or wrap below aligned with the text.
  Applies in both densities. Hover actions move to the row's last line of
  plain text, off a wrapped title and clear of the PR badge. Rows use taller
  offscreen height estimates, and the row-height settings (`defaultDensity`,
  `twoLineTitles`) are remembered per client so the first paint uses them
  before settings finish loading.
- Tests use jsdom storage explicitly so Node 26's native `localStorage`
  does not cause preference and sidebar tests to fail.

## 0.2.1 - 2026-09-29

### Fixed

- Folding groups or families clears hidden selections and keyboard targets,
  and restores focus when the focused row disappears.
- Group status prioritizes failures and input waits over running work, counts
  each descendant, and excludes queued or blocked work from running counts.
- Folded-family status describes only hidden descendants, excluding the parent.
- Mounted rows react to changes in celebration, hover-card and adaptive-collapse
  settings, and reuse unchanged provider records to preserve row memoization.
- Navigation follows BB's live order and visibility hook and delegates saves to
  host actions, removing duplicate preference fetches, races and merge logic.
- Section grip drags move the selected threads together and report partial
  failures. Keyboard section dragging works and exposes its grip to assistive
  technology while project sorting retains its own keyboard behavior.
- Archive shortcuts and bulk actions leave completion feedback to BB, which
  may require confirmation before archiving a family.
- Opening a row menu closes its hover preview and cancels pending previews.
- Time buckets use local calendar boundaries across daylight-saving changes.

## 0.2.0 - 2026-09-29

### Added

- Create sections directly in Radar's section view with **New section**:
  inline naming, keyboard cancellation, pending-state protection and retryable
  error feedback through BB's section API.

### Changed

- Update to BB 0.44 navigation API: use host sidebar navigation hooks, split
  drag handles, and support dedicated skills panel actions.

### Fixed

- Keyboard shortcuts no longer take over the rest of BB. They stay out of
  text fields, open dialogs and menus and controls outside the list, ignore keys another handler already
  handled or that carry ⌘/Ctrl/Alt, and no longer swallow arrow keys when
  the list is empty. Enter keeps its native behaviour on links and buttons;
  Space folds a focused thread family without taking over nested buttons.
- Arrow navigation moves DOM focus with the highlight, so archive, pin and
  selection shortcuts act on the displayed target rather than a stale row.
- Mark family read includes the selected child and its descendants, not just
  its root and siblings.
- Text and status filters reveal matches inside collapsed groups without
  overwriting saved fold preferences.
- Archived pagination stays available when loaded threads do not match the
  active filters.
- Empty sections remain visible as drag-and-drop destinations, including
  when there are no threads or the current filters match nothing.
- Execution details refresh for new runs and newer activity, including rows
  returning from a filter, without stale requests overwriting the cache.
- Completion celebrations expire despite intervening thread updates and
  overlapping completions; pending timers are cleared on unmount.
- The Pinned smart view now filters to pinned threads instead of just
  resetting the filters, and "Save view" only appears when a filter is active.
- Selection is pruned to rows the list still shows, so bulk actions can no
  longer hit threads a filter has hidden. X toggles selection from the
  keyboard, and dragging a selected row now carries the whole selection.
- Bulk pin, bulk mark-read and the pin shortcut report failures instead of
  announcing success, and pin errors from the row and peek card are shown.
- Saved smart views are validated on load, so a corrupt entry no longer
  crashes the list.
- The filtered-count label no longer includes hidden helper threads.
- The preference migration is retried on the next launch when a key could not
  be moved, instead of being marked done.
- Menus: Home focuses the first item and End the last; the More popover no
  longer uses invalid menu/list roles.
- Renaming a thread is no longer overwritten when its title changes
  underneath you.
- Threads whose parents form a cycle no longer disappear from the list.
- Thread rows skip re-rendering when nothing they show changed, and the
  filter box no longer blocks typing on large lists.
- Removed about 1,600 lines of unused UI code and the unused `zod` and
  `@radix-ui/react-checkbox` dependencies.
- BB now shows the radar icon for the plugin. `bb.branding.icon` named an icon
  BB's own set does not have, so BB fell back to its default; it now points
  at `assets/icon.svg`.

## 0.1.0 - 2026-09-28

### Added

- Activity-grouped thread list: Today / Yesterday / Previous 7 days / Previous
  30 days / Older, keyed off real activity rather than last-read time, so
  opening a thread never floats it to Today.
- Group by project or by section, with sticky headers, expand/collapse all,
  and drag-to-reorder projects.
- Nested thread families: indent guides, gutter folding, and a folded summary
  that rolls up hidden counts, unread state and the loudest hidden status.
- Attention system that separates working, needs-you, failed and
  finished-unread by icon, status word, wash, accent bar and motion; a
  one-time check pop when a thread finishes.
- Per-row provider icon, model and thinking chips (shown only while a thread
  is in flight), pull-request badges, and click-to-copy branches.
- Hover peek card with the initial goal, branch, PR and a stacked
  context-window meter with an auto-compaction marker.
- Smart views: save the current query, status filter and lifecycle as a named
  one-click preset.
- Status filter chips (all / live / waiting / unread), multi-select with bulk
  archive, pin and mark-read, full keyboard traversal, and comfortable or
  compact density.
- Navigation that follows BB's own server-synced sidebar arrangement, so
  arranging destinations in either surface carries over.
- Six settings: five that turn down the louder visuals, and a default row
  density.
- A one-time migration of preferences from the `codex-sidebar:` era.
