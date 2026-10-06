---
name: radar-sidebar
description: Use the Radar Sidebar plugin's thread list and navigation. Use when the user asks about the sidebar's groups, filters, pins, sections, or how to switch back to BB's list.
---

# Radar Sidebar

Replaces BB's sidebar thread list and the navigation above it. There is no
CLI; plugin settings are stored on the server. Everything below is UI in the BB app, and thread mutations go
through BB's own flows (pins, reads, renames, archives, deletes).

## Surfaces

- **Thread list** (`experimental_threadList`, id `radar`): pinned threads,
  then Today / Yesterday / Previous 7 days / Previous 30 days / Older — or
  group by project, or by **section** for drag-to-organise. The header holds
  a text filter, an Active / Archived / All switch, grouping + expand-all +
  density toggles, status chips, and the smart-views bar (New thread lives
  in the nav above, so the list keeps no duplicate). Preferences persist per
  client in `localStorage` (`radar-sidebar:*:v1` keys).
- **Navigation** (`experimental_sidebarNavigation`, id `radar`): a primary
  New thread button, inline destination rows, and a **More** popover (count
  badge, highlighted while the current page lives in it). Search threads is
  not rendered: the list filter and the ⌘K palette cover it. Inline vs More
  and the row order follow BB's
  own stock arrangement exactly — the server-synced `sidebar.pluginPanelOrder`
  and `sidebar.visiblePluginPanels` preferences behind Settings →
  Customize sidebar — so More holds precisely what the user put there.
  The host navigation hook supplies the live arrangement, and its actions
  save visibility changes. Right-click a destination for Keep in sidebar /
  Move to More (so arranging in either nav carries over) and Open in
  split for panels. Option-click opens in a split. New thread is the fixed
  Radar header — always inline — while destinations follow the stock
  arrangement exactly.

## Navigation rail

Enable **Navigation rail** (`railNav`, default `false`) under Settings →
Installed plugins → Radar Sidebar. Both slots keep id `radar`. Off restores
navigation above the list, including the touch toolbar, and ignores the
remembered rail project filter. Turning it back on restores that choice.

The rail sits beside the list on desktop (60px) and in the mobile drawer
(56px). BB still supplies destination order, visibility and actions. Search
stays on the rail; **Home** only clears the project filter and never creates
or opens a thread. **New thread** in the list heading starts in the scoped
project, or BB's own action when no project is scoped (Option-click opens a
split without the project preset).
Project tiles show visible, unarchived threads, newest project first (projects
with a needs-you thread stay on top until it is resolved), with
count badges: amber halo-pulse needs-you, green spinner-ring working (blocked threads are
counted as needs-you, not working), and primary-coloured unread. The
`projectBadges` setting (default `true`, needs `railNav`) turns the badges and
the needs-you ordering off. `projectStyle` (default `"Tiles"`, needs
`railNav`) redraws them as `Rings` (amber glow / working arc in the ring,
unread count only) or `Chips` (pill edged by the loudest state, waiting
count only); the labelled rail keeps the full end counts in every style. Click a
tile to filter, click it again or Home/the heading to clear. A project with
only archives keeps its scope. A deleted project clears once the directory
is ready; loading/error snapshots preserve the saved choice. When using
another navigation provider with `railNav` enabled, the list has its own
clear-project button.

Desktop hover/focus tooltips include shortcuts, accessories and project
counts (including queued/background work). Arrow keys wrap between enabled
controls; Home/End focus the first/last. Right-click destinations for Move to
More / Keep in sidebar, Move up/down, Open in split and Plugin details.
Customize opens BB's editor beside the desktop rail; mobile uses BB's full
editor. Narrow lists fold status chips at 284px while keeping accessible labels.

**Labelled rail** (`wideRail`, default `false`) requires `railNav`. It adds a
Show labels / Hide labels control on desktop. The 168px rail expands the
sidebar by its extra width so the thread list keeps its room. It probes the
host sidebar/footer/width structure and hides the toggle when unavailable.
The gutter, footer surface and Customize layout use host `data-sidebar`
selectors in `components/radar/railHostStyles.ts`. The rail renders them
as a `<style>` element in its own markup, by state (wide, compact, scoped).
BB's footer keeps its default bar under the thread list. Disabling the rail
unmounts the style and releases those overrides. It never
writes to BB's elements, and it avoids `:has()` on the page or sidebar,
which restyled the whole page on every DOM change.
A BB shell update can require selector adjustments. Wide mode and tooltips
are desktop-only; safe-area padding and reduced motion are respected.


## Live plugin status on the rail

For a navigation item with `experimental_Accessory`, right-click its rail button
(or its row in More) and choose under **Live status**: **Off (dot indicator)**,
**As a badge**, or **Instead of the icon**. Off is the default for every item.
The plugin persists these choices by item id in its `railLiveStatus` settings
map (`off`, `badge`, `icon`), shared across devices. Do not change other entries
when setting one item's mode. Items without accessories have no Live status menu.

The icon replacement slot is 28×28px; the badge is 16×16px at the icon's bottom
trailing corner. Both clip their contents. Accessories are no-props decorative
components, made inert inside the button. Every accessory placement has its
own error boundary; a failed replacement shows the static icon, and failed
badges/row accessories leave the existing icon. Standard navigation, More and
tooltips use a trailing slot capped at 4rem by 1.25rem. If a plugin's accessory
doesn't adapt to the rail slot, report the dimensions to its owner.

## Organisation tools

- **Grouping modes** (`Clock` / `Folder` / `SectionMove` icons): time,
  project, or section. Project groups are drag-reorderable by their header
  (order persisted in `radar-sidebar:project-order:v1`; right-click a header
  to reset). Each project header also carries a New-thread-in-project button.
- **Create a section**: switch to section grouping, choose **New section**,
  enter its name and submit with **Create section** or Enter. Cancel or Escape
  closes the form without creating anything. Names are trimmed; blank names
  are rejected. Creation uses `sdk.threadSections.create({ name })`, with
  duplicate submissions blocked while pending and inline API errors that keep
  the name for retry. BB's realtime sidebar state supplies the new section;
  empty sections stay visible even with no threads or no filter matches.
- **Drag to file**: in section grouping, hover a root thread to reveal its
  grip, then drag it onto a section header (or **Unfiled**) to set its
  `sectionId` through BB's own thread update — the drop target highlights,
  the thread's own section is marked as a no-op, and a toast confirms.
  Dragging a selected thread files the whole selection. For keyboard filing,
  focus the grip, press Space, move with arrow keys, and press Enter to drop
  or Escape to cancel.
  Threads cannot be moved between *projects*: BB's update API has no
  `projectId` field, so project grouping is view-only.
- **Smart views** (`RadarSmartViews.tsx`): the bar under the filters offers a
  Pinned preset plus any saved view. Configure query + status chip +
  lifecycle, hit **Save view**, name it — stored in
  `radar-sidebar:smart-views:v1`. Click a pill to apply (click again to
  clear).
- **Hover preview** (`RadarHoverCard.tsx`): pausing on a row opens a portal'd
  card (portaled because row `content-visibility` containment would clip a
  fixed-position child) with an arrow pointing at the row. Sections: title +
  provider + status word + time; the initial goal; chips for model, thinking,
  section, project, host; branch (click to copy) and PR (click to open);
  a **stacked context meter** built from `threads.context` snapshot
  categories (used / reserved / deferred, with a legend of the four biggest)
  plus a marker at the auto-compaction threshold; folded-family names; and
  Open / Split / Pin / Archive actions. It is interactive, so it stays open
  while pointed at. **The context section is omitted entirely when BB records
  no usage** (a thread that never ran a turn) rather than showing a zeroed
  bar. Placement is measured in a pre-paint layout effect: the card prefers
  the row's right, flips left when that would overflow, and clamps to an 8px
  viewport inset on both axes, so no part of it can leave the screen; the
  arrow tracks the row's mid-height even after the card is nudged. It
  measures `offsetWidth`/`offsetHeight` (not `getBoundingClientRect`) so the
  entrance `scale()` can't skew the maths, and re-places when the context
  section arrives and changes its height.

## Selecting it

Settings → Appearance → **Sidebar** (list) and **Navigation** (controls).
Choosing BB there restores the stock experience; disabling this plugin falls
back to BB's list automatically.

## Row behaviour

- Status visual: spinning green loader = thread working; distinct pulsing
  green icons for background agent (bot), background command (terminal),
  workflow, goal (target), and plan mode (checklist); amber dot =
  needs input / message waiting to send, red X icon = error / failed send,
  green check-circle = finished but unseen. Rows that need you are the
  loudest: waiting-for-input gets an amber wash + bar + glow pulse, failed
  gets the red equivalents — both stay until resolved, whether read or
  not. Finished-unseen gets the green wash + bar + semibold title + blue
  pip, clearing once opened. Auto-resolving queued states keep just the
  dot/pulse. Motion is reserved for action items (off under
  prefers-reduced-motion); finished-unseen and everything else stays
  static. Drafts show no status dot
  (the pencil badge covers them). Unknown indicators draw nothing
  (forward-compatible), and the row's accessible name appends the host's
  status label.
- Row lead: just the provider icon (14px, hard-capped).
- Right-side badges, in order: status visual (spinner, dot, or icon) plus
  its explicit word (WORKING, AGENT, COMMAND, WORKFLOW, GOAL, PLAN,
  NEEDS YOU, QUEUED, FAILED, DONE — coloured to match), jump shortcut
  while the app command modifier is held (only rows on screen get one:
  rows in a folded family or collapsed group are skipped), another
  plugin's row status (takes the draft slot, as BB's list does), amber pip
  for an unsent composer draft, blue pip for unread.
- State changes animate: washes fade, badges pop in, quiet rows fold
  smoothly, and groups + families expand/collapse with an animated roll
  (rows stay mounted only while the fold closes, hidden from keyboard and
  screen readers, then unmount so a folded group or family costs nothing;
  all off under prefers-reduced-motion).
  Threads flipping from live work to done get a one-time springy
  check-pop on their status badge.
- Adaptive rows (`adaptiveCollapse`): quiet read-idle rows collapse to the
  title line (title, project chip, time) and drop the subtitle, keeping
  only the branch line (which always shows). Anything worth a glance
  (unread, working, needs-you, failed, drafts, plugin statuses, PRs needing
  attention, unknown states) keeps the full row. Editing never collapses.
- Compact density compresses **vertically only** — inline padding and the
  child indent stay identical to comfortable so tree guides keep lining up.
  Titles stay on one line by default; **Two-line titles** also applies to
  compact density and the forced-compact touch layout.
  It uses `margin-block` rather than `margin`, since the shorthand also
  zeroes `margin-left` and wipes `.radar-row-child` / `.radar-row-deep`.
  `css.test.ts` guards both as static assertions (jsdom does not resolve the
  real cascade).
- Pinned rows carry a small pin marker at the start of the title, so
  pinned children nested under unpinned parents stay recognisable (and
  `pinned` joins the row's accessible name).
- Hover cards (`hoverCard`): pausing on a row (hover-capable pointers only)
  opens the interactive preview described under **Hover preview**. It
  closes on leave, scroll, window blur, or when a menu opens.
- Responsive: container-query width tiers shed load as the sidebar
  narrows (status words first, then project chips, then badges down to
  status + unread); compact touch viewports pin the ⋯ menu inline since
  hover doesn't exist there, and filters wrap.
- Title line: title, then a project chip in the project's own muted hue
  (stable per project id, readable light and dark — always shown, even on
  collapsed rows and children, hidden only when it would echo the project
  group header), then a muted tabular last-activity time that never
  truncates.
  Choose **Two-line titles** to wrap the whole title, including mention
  chips, before truncating at two lines. Metadata stays beside short titles
  when it fits, or wraps below aligned with the text after child/pin markers.
  Groups, sorting, and timestamps all key off activity — live threads
  (executing, background work, queued messages, waiting on you) count as
  now, everything else keys off latest attention — so merely opening a
  thread never floats it to Today.
- Subtitle: model and thinking each in an outlined chip (bot icon +
  semibold model name, brain icon + uppercase level), then a section chip
  in the section's own muted hue (stable per section id) and host.
  **Shown only while the thread is in flight** (`isLiveThread`):
  `threads.defaultExecutionOptions` resolves *defaults*, so it answers with a
  model and reasoning level for any thread at all — including idle and
  never-started ones. Idle rows skip the fetch and render no chips. The provider name is not echoed in the row (the icon
  says it) unless no icon is available; `Off` thinking and the home host
  (whichever host runs the most threads) are omitted as noise — branches
  live on line three, away-from-home hosts always show. Model names
  resolve through each provider's catalog; a shimmer stub holds the place
  while loading. The full text is always in the tooltip. Model info
  refreshes when a thread starts a new run, records newer activity, or the
  window regains focus; regrouping within the same run reuses cached values.
- Threads on a branch grow a third line: icon + branch name (a git-folder
  icon for worktrees, a branch icon for plain checkouts, with `(worktree)`
  in the tooltip), plus a PR badge when the branch has one (`#123 · Open`,
  coloured by attention: red for failed checks/conflicts, amber for changes
  requested/blocked, blue for review pending, green for ready/merged).
  Clicking the badge opens the PR. The branch never appears on line two.
- Hover actions: pin, rename (pencil), archive/unarchive, and a menu (⋯).
  They never resize the row. In one-line mode they sit at its top right. In
  two-line mode they sit on its last line of plain text (the subtitle, or
  the chip and time where the subtitle is folded away), lifted clear of the
  branch line so the PR badge stays clickable; only a row one line tall
  still has them over the end of its title.
  Right-click opens the fuller menu: open in split, pin, mark read/unread,
  mark family read (whole tree, for threads with parents or children —
  a child's completion lands as the parent's own notification turn, so
  clearing one often means clearing both), rename, move to section,
  archive/unarchive, copy link, delete (host confirmation).
- Double-click a row to rename inline; Enter commits, Escape cancels.
- Child threads nest directly under their parent (indented, person icon,
  deeper indent past one level, VS Code-style indent guides with stubs on
  last children), and child activity bubbles up: a family
  groups/sorts by its freshest activity, so an active child floats its
  parent. Children show model • thinking + time only — no branch line, no
  echoed context (the tooltip keeps everything). Placement follows the
  root's pin state; orphans whose parent is hidden promote to roots.
  Filtering keeps matching branches plus their ancestor context. Families
  fold via the gutter chevron (persisted per client; group headers stick
  while scrolling; filtering forces everything open). A collapsed
  parent swaps its subtitle
  for an inline
  summary of who's folded (stacked people faces + remainder, names in
  the tooltip), keeps its branch line, and shows a pill
  only when the fold hides unseen threads (blue count) or loud states
  (red failed, amber needs-you, pulsing green live rollup dot). Group
  counts/rollups always include folded members and count each thread. Failed
  work takes priority over input waits, which take priority over running work.
- Hidden helper threads (`isHidden`) are filtered out, as in BB's list.

## Keyboard and selection

- `/` focuses the text filter. In the filter, ↓ moves to the first row,
  Enter opens it, and Escape clears the query (or leaves the field when it
  is already empty).
- ↑ / ↓ walk the rows, Enter opens, and Space, ← or → fold or unfold a
  family. E archives and P pins or unpins the focused row.
- These shortcuts stay out of text fields, open dialogs and menus, and
  buttons or links outside the list, and never apply to a key another handler already consumed or one held
  with ⌘, Ctrl or Alt. The focused row (or the last one reached with ↑ / ↓)
  is the target.
- X toggles the focused row into the selection (⇧ adds the range).
  ⌘- or Ctrl-click does the same with the mouse; ⇧-click adds the range
  from the last selected row. A bulk bar then offers Archive, Pin and Read,
  and E and P act on the whole selection. Selection only ever holds rows the
  list still shows: filtering one out deselects it.
- Escape clears the selection first, then the focused row, then the query.

## Settings

Settings → Installed plugins → Radar Sidebar. The plugin keeps its own
settings in its server KV storage (`getSettings` and `setSetting` over RPC;
`setRailLiveStatus` patches just one accessory item), shared by every device.
RPC replies and the `settings` realtime channel carry the full saved choices
with a monotonically increasing `revision`. The frontend keeps pending edits
visible without discarding remote changes, and refetches after reconnecting or
returning to a previously unmounted sidebar. Earlier unversioned saved choices
remain readable.
BB's plugin settings are not used, so there is no `bb plugin config` for them
and BB draws no flat list. The frontend reads them from `useSettingValues()`;
every value has a default, and the last values this browser saw are cached so
the first paint is right and the list never waits on the server.

The settings page shows these as four cards (Navigation rail, Thread rows,
Attention and feedback, Swipe actions) with live previews, and greys out
settings whose requirement is off. The keys and defaults below are unchanged.

| Key | Default | Effect |
| --- | --- | --- |
| `railNav` | `false` | Navigation rail beside the list, with project filters; off keeps navigation above the list. |
| `wideRail` | `false` | Experimental labelled desktop rail; requires `railNav` and a recognised host shell. |
| `projectBadges` | `true` | Needs-you, working and unread badges on the rail's project tiles, and needs-you projects kept on top; requires `railNav`. |
| `projectStyle` | `"Tiles"` | How rail projects look: `Tiles`, `Rings` or `Chips`; requires `railNav`. |
| `hoverCard` | `true` | Show the hover peek card. |
| `celebrate` | `true` | Pop the check badge once when a thread finishes. |
| `motion` | `true` | Pulse rows that need input or have failed; off under `prefers-reduced-motion` regardless. |
| `loudUnread` | `true` | Wash and accent bar on finished-but-unseen rows; off keeps the icon and pip only. |
| `adaptiveCollapse` | `true` | Fold quiet read-idle rows to their title line. |
| `defaultDensity` | `comfortable` | `comfortable` or `compact`, until the header toggle is used; that choice is remembered per client. |
| `twoLineTitles` | `false` | Enable to wrap long titles, including mentions, in both densities; metadata wraps below when needed. |
| `swipeActions` | `true` | Swipe a row left or right to act on it, by touch or with two fingers on a trackpad. |
| `swipeRight` | `Mark read / unread` | Rightward swipe action: `Mark read / unread`, `Pin / unpin`, `Archive / unarchive`, `Open in split`, `Rename`, `More actions`, `Delete…` or `Nothing`. |
| `swipeLeft` | `Archive / unarchive` | Leftward swipe action, same options. |

## Rail storage keys

- `radar-sidebar:rail-scope:v1`: selected project id; absence means all projects.
- `radar-sidebar:rail-wide:v1`: `1` for expanded labels, `0` for icons.

These are client preferences inside the same plugin, alongside the existing
filter, density, smart-view, project-order and collapse keys.

## Rules

- Never edit `localStorage` or `bb.db` to change sidebar state; use the UI.
- The list renders no virtualisation: very large thread counts (thousands)
  may scroll slowly on low-end machines. Prefer the text filter or Archived
  separation in that case.
- `app.css` is custom CSS against BB theme tokens; Tailwind utilities in
  `components/radar/*.tsx` compile in the plugin build. Keep new styles
  behind the `radar-` prefix.
