# TovarNet Labs · Mexico Transit

This fork keeps Mexican transit work isolated from the upstream application and from the currently deployed ATLAS build.

## Baseline

- Production reference: `ad009ea1ebf56345d5be69a61a567c3aeeb9fa02`.
- Production baseline branch: `production/atlas-ad009ea`.
- Development branch: `feature/mexico-transit`.
- No production deployment is implied by commits on this branch.

## Metrobús CDMX · phase 1

Phase 1 adds a native, static network layer derived from the official 2026 Metrobús GTFS:

- 7 lines.
- 89 route/shape variants.
- 378 stations.
- Route geometry simplified at approximately 5 m tolerance before bundling.
- Station points are displayed only inside 60 km camera distance.
- Runtime data is gzip-compressed and loaded only after the layer is enabled.
- Phase 1 is `local-only`: it is intentionally excluded from shared/persisted layer-state tokens until the realtime integration is mature.
- Original high-volume schedule and stop-time tables are not bundled.

The layer is intentionally static. It shows infrastructure, not live buses.

## Phase 2 · realtime

When official Metrobús API / GTFS-Realtime access is available, live vehicle positions should plug into the existing Transit engine rather than duplicate its playback, stale-fix and motion logic. Static GTFS metadata can then enrich realtime vehicles with line, route and station context.

## Next providers

The same architecture is intended for:

- MOBI · Quintana Roo.
- Va-y-Ven · Yucatán.

Those providers require an official realtime interface or a documented read-only adapter before permanent integration.
