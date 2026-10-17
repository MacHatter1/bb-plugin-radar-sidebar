# Extending Radar Sidebar

Radar v1 is an **experimental, data-only contribution interface**. An ordinary
BB plugin can add thread badges and context-menu actions without depending on
Radar's React components, being loaded by Radar, or changing BB core.

Radar keeps BB's original thread state, status, unread indicator, mutations and
navigation. Contributors cannot replace those through this interface.

## Contract package

The publishable package lives in `packages/contributions/` and is named
`bb-radar-contributions`. It is not published to npm by this change.

Build and pack it locally:

```sh
npm install
npm run build:contributions
npm pack ./packages/contributions --pack-destination /tmp
# In a contributor's checkout:
npm install /tmp/bb-radar-contributions-0.1.0.tgz
```

The package exports types, Zod 4 schemas, versioned method names and a
registration helper. It contains no React, UI registry or runtime BB import.
Its SDK import is type-only. Use SDK 0.5.29 or later; Radar feature-detects
discovery and leaves the usual sidebar intact when it is unavailable.

## Minimal contributor

Register on the **contributor's** backend, not Radar's:

```ts
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { experimental_registerRadarContributor } from "bb-radar-contributions";

export default function plugin(bb: BbPluginApi) {
  experimental_registerRadarContributor(bb, {
    async provide({ threadIds }) {
      // Batch your reads. Return only requested threads that have contributions.
      const findings = await readCachedFindings(threadIds);
      return {
        version: 1,
        threads: findings.map((finding) => ({
          threadId: finding.threadId,
          badges: [{
            id: "findings",
            label: `${finding.count} security findings`,
            text: String(finding.count),
            icon: "Shield",
            tone: "warning",
          }],
          actions: [{
            kind: "link",
            id: "open-findings",
            label: "View findings",
            href: `/plugins/${bb.pluginId}/findings`,
          }],
        })),
      };
    },
    run() {
      throw new Error("This contributor supplies links only.");
    },
  });
}
```

`readCachedFindings` is your plugin's own implementation, not a Radar API.
Only include contributions for actual known data; do not invent activity.

The existing Agent Teams plugin has a ready-to-copy adapter in
[`examples/agent-teams-radar.ts`](../examples/agent-teams-radar.ts). Add it to
Agent Teams, replace the source-relative contract import with the installed
package, and register against its existing engine:

```ts
experimental_registerAgentTeamsRadar(bb,
  () => engine.list({ includeArchived: false }));
```

It reads the engine once per batch, matches captain/member threads, shows task
progress and links to Agent Teams' existing panel. It does not mutate teams.
This adapter is tested but **is not installed or activated automatically**;
no Agent Teams source is changed in this repository.

## Thread badges

Each badge has `id`, `label`, and optional `icon`, `text`, `tone`, `order`.
Icons are BB semantic icon names, including host-registered icons. Labels are
accessible text, not HTML. Tones are `neutral`, `info`, `success`, `warning`,
`danger`.

- Maximum 3 badges per contributor per thread.
- Maximum label length 120; badge text 12; IDs 128.
- Radar draws at most 3 contributed badges per row, then an accessible overflow
  count. BB's normal status/unread/draft indicators remain separate.
- IDs use letters, digits, underscores or hyphens. Radar namespaces them as
  `<pluginId>/<id>`; the plugin owner comes from BB discovery, never your data.
- Contributions sort by `order` (integer -100…100, default 0), then plugin ID,
  then contribution ID. Sorting does not depend on discovery/completion order.

## Context-menu actions

Each action has `id`, `label`, `kind`, and optional `icon`, `order`,
`disabled`. Maximum 8 actions per contributor per thread.

**Links** use `kind: "link"` and `href`. Radar renders BB's `UrlLink`, preserving
normal modified-click behaviour. Only HTTP(S) URLs and the contributor's own
`/plugins/<pluginId>/<panelPath>` routes are accepted. JavaScript/data schemes,
protocol-relative URLs, backslashes, control characters and route traversal
are rejected. Opening a link is an explicit user action; Radar never fetches it.

**RPC actions** use `kind: "rpc"`, and can include `confirmation` (up to 240
characters). Selecting one invokes your `run({ threadId, actionId })` handler.
Return `{}` or `{ message: "Updated" }` (up to 240 characters); Radar shows the
message as a success toast and refreshes contributions.

Recheck thread existence, action availability and any permissions in `run`.
Menu data is a presentation snapshot, **not authorisation**. Confirmation is
only a UI guard; another BB client can invoke your RPC directly. Double
activation while the same action is pending is deduplicated. Failed actions
show an error; timed-out mutating actions are never automatically retried.
A timeout/cancellation does not undo work already started on your server.

## Lifecycle, performance and failure rules

BB owns installation, discovery, identity, reload and removal. The helper
publishes two discoverable schema-validated methods:

| Method | Input | Output |
| --- | --- | --- |
| `radar.v1.contributions` | `{ threadIds: string[] }` | `{ version: 1, threads: [{ threadId, badges, actions }] }` |
| `radar.v1.action` | `{ threadId, actionId }` | `{ message?: string }` |

Radar uses `sdk.plugins.experimental_discoverRpc` and `callRpc`; there is no
push-registration handshake, load-order dependency or shared global singleton.

- Only currently shown, unhidden thread IDs are sent. No prompts or thread
  objects are sent to contributors.
- Reads are batched in groups of 64, with up to 4 requests in flight across all
  contributors and a deterministic maximum of 32 contributors.
- Discovery/reads time out after 3 seconds per request. An action times out
  after 10 seconds. Reads and discovery may retry on the next refresh.
- Refresh happens every 15 seconds while mounted, on window focus, reconnect,
  changed visible thread IDs, changed contributor preferences and successful
  actions. Visible-ID/preference changes are debounced for 150ms, with disabled
  badges/actions removed immediately. Disable/removal is reconciled by discovery,
  so it can take one
  refresh cycle; there is no BB plugin-lifecycle push subscription here.
- In-flight reads are deduplicated. Unchanged row data preserves its identity;
  a refresh does not force every memoised thread row to render.
- Unsupported versions, unknown fields, duplicate IDs, excessive values or
  unrequested thread IDs reject that contributor's response, not the sidebar.
  A failed batch drops that contributor's complete result for the refresh.
- Hidden/unmounted lists release timers and listeners. Changed scope,
  preferences, reconnect or disposal invalidate older requests. Late results
  cannot repopulate the view.
- Contributions are ephemeral in-memory data, not persisted records. On
  discovery failure Radar drops stale contributions and keeps normal BB actions.

Under **Settings → Installed plugins → Radar Sidebar → Plugin contributions**,
each discovered owner has a toggle. These preferences are server-synced,
saved atomically per owner and restored on reinstall. Turning a contribution
off does not disable its plugin. Disabled contributors are still discovered
but receive no contribution requests.

## Deliberately outside v1

Arbitrary React renderers, DOM access, custom grouping/filter providers,
replacement status logic and custom plugin loaders are not part of this
interface. Rich UI slots should use a future BB-owned, namespaced registry
rather than a Radar `window` registry. Breaking contract changes get new method
names (`radar.v2.*`), not silently changed v1 payloads.
