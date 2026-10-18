# Experimental Radar contribution interface

Radar-owned interface; this does not add public surfaces to the BB Plugin SDK.
BB's existing experimental discovery and lifecycle remain the transport.

## Inventory

- `EXPERIMENTAL_RADAR_METHODS`: discoverable v1 method names.
- `EXPERIMENTAL_RADAR_RPC`: schema-validated backend method contract.
- `experimental_registerRadarContributor(bb, { provide, run })`: contributor
  registration helper.
- `experimental_radarBadgeSchema`, `experimental_radarActionSchema`,
  `experimental_radarHrefSchema`: presentation/link schemas.
- `experimental_radarRequestSchema`, `experimental_radarResponseSchema`:
  batched read schemas.
- `experimental_radarActionRequestSchema`,
  `experimental_radarActionResultSchema`: explicit activation schemas.
- `RadarBadge`, `RadarAction`, `RadarRequest`, `RadarResponse`,
  `RadarActionRequest`, `RadarActionResult`: inferred data types.
- `RADAR_BATCH_SIZE`, `RADAR_MAX_BADGES`, `RADAR_MAX_ACTIONS`: v1 bounds.

Contract package: `packages/contributions/`.
Guide: [Extending Radar](contributions.md).
Integration example: [Agent Teams](../examples/agent-teams-radar.ts).

## Before stabilising

- Activate at least two real contributor plugins in a live BB client, including
  a reload/disable/removal cycle, not only SDK-harness tests.
- Confirm network/row-render cost with large real lists and multiple clients.
- Decide whether 15-second polling needs a BB-owned lifecycle/data-change signal.
- Confirm badge limits and link/action ergonomics with keyboard and mobile.
- Keep arbitrary React extension slots in BB core, not a global Radar registry.
- Publish the standalone contract package only after release/version review.

V1 is additive-only; incompatible changes use `radar.v2.*`. Tests establish
schema validation, identity, batching, deterministic ordering, cancellation,
timeouts, contributor isolation, core-indicator preservation and shared toggles.
They do not certify live multi-plugin behaviour or rendered layout.
