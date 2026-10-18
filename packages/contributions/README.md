# bb-radar-contributions

Experimental data-only contracts for extending BB's Radar Sidebar with thread
badges and context-menu actions. No React or Radar internals are imported.

```ts
import {
  experimental_registerRadarContributor,
  type RadarResponse,
} from "bb-radar-contributions";

experimental_registerRadarContributor(bb, {
  provide: ({ threadIds }): RadarResponse => ({
    version: 1,
    threads: threadIds.map((threadId) => ({
      threadId,
      badges: [{ id: "team", label: "Build team", icon: "UserMultiple", tone: "info" }],
      actions: [{ kind: "link", id: "open", label: "Open team", href: `/plugins/${bb.pluginId}/teams` }],
    })),
  }),
  run() { throw new Error("Links only."); },
});
```

Register on your own BB plugin's backend. BB owns discovery and lifecycle.
Radar namespaces contribution IDs by the discovered owner. Prefer cached,
batched reads; return only real known data. Validate action availability in
`run` rather than trusting menu data.

Limits: 64 thread IDs per request, 3 badges and 8 actions per thread; label 120,
badge text 12, confirmation/action result 240 characters. IDs use letters,
digits, underscores or hyphens. Ordering is `order` (-100…100), owner ID,
contribution ID. Links allow HTTP(S) or your own BB plugin-panel routes.

The helper publishes `radar.v1.contributions` and `radar.v1.action`.
All `experimental_*` exports remain experimental; incompatible changes require
new versioned method names.

This package is prepared for local packing but not yet published to npm.
From the Radar repository:

```sh
npm install
npm run build:contributions
npm pack ./packages/contributions --pack-destination /tmp
```

See the full [authoring guide](https://github.com/MacHatter1/bb-plugin-radar-sidebar/blob/dev/docs/contributions.md)
and the tested Agent Teams integration example in that repository.

MIT.
