A thread list you can read at a glance, for BB.

## What you get

- A **Radar thread list** in the left sidebar. Threads group by Today,
  Yesterday, Previous 7 days, Previous 30 days or Older, keyed off real
  activity rather than when you last opened them, so merely reading a thread
  never floats it to the top. Group by project or by section instead with one
  toggle, and reorder projects by dragging them.
- **Attention states you cannot miss.** Working, needs-you, failed and
  finished-but-unread each get their own icon, status word, colour and row
  treatment. Rows needing a decision wash amber or red and breathe a slow
  glow; motion is reserved for things that need action, so movement always
  means something.
- **Nested families.** Child threads sit under their parent with indent
  guides, and a family sorts by its freshest activity. Fold one and the
  summary tells you how many are hidden, how many are unseen, and the loudest
  state inside.
- **Rows that carry their context.** Provider icon, model and thinking level
  while a thread is in flight, plus a branch line you can copy and a
  pull-request badge that opens in your browser. Pause on a row for a peek
  card with the original goal and a stacked context-window meter.
- **For working fast.** Status filter chips, saved smart views, a text
  filter, comfortable or compact density, keyboard traversal with quick
  archive and pin, multi-select bulk actions, and drag a thread onto a section
  header to file it.
- **Compact project navigation on supporting BB forks.** Enable Radar projects
  in Customize rail for project tiles with live activity badges and full
  project cards. Pin, reorder and collect projects, open their recent threads,
  start a new thread or mark a project read. BB clients without the new rail
  section extension keep the thread list working.

## How it works

The sidebar reads BB's live state. Archive and delete run BB's own thread
actions, and pins, reads and renames make the same calls BB's actions do, so
they behave exactly as they do in the stock list, and nothing about your threads changes — only how the sidebar presents
them. A small backend stores shared plugin preferences in BB's plugin KV storage
and syncs them over RPC and realtime. Browser storage holds a settings cache and
per-client view choices. Radar makes no third-party requests, creates no separate
database, and stores no secrets.

Pick it under **Settings → Appearance → Sidebar**; choosing BB there, or
disabling the plugin, restores the stock list immediately. Navigation stays on
BB's own rail. Requires BB 0.46 or later.

Two limits worth knowing: it will not move a thread between projects, because
BB's thread API exposes no project on update, and it shows model and thinking
only while a thread is actually running, because the options endpoint resolves
defaults rather than history.

## For agents

The bundled skill documents the groups, filters, folding, badges, menus,
settings and storage keys, so an agent can explain or troubleshoot the sidebar
without guessing at internals.
