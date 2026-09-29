# Changelog

All notable changes to Radar Sidebar are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## Unreleased

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
- Empty sections remain visible as drag-and-drop destinations.
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
