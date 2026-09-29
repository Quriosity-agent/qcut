# Timeline navigation performance: 2026-09-29

## Scope and findings

Reduce pointer-hover preview work and zoom stalls without changing playhead
scrubbing, clip timing, or rendered media. Work is on `beauty-kpop-v2`, PR #481.

Three avoidable costs were identified in the current frontend:

1. `TimelineHoverAxis` published `previewScrubTime` every animation frame. This
   limited update frequency to display refresh, but still requested expensive
   preview renders continuously while the pointer moved.
2. `TimelineRuler` allocated and mounted ticks for the full duration. The default
   two-hour ruler mounted up to 72,001 ticks at high zoom, including offscreen
   ticks, and reconciled them on zoom changes.
3. Cache-status sampling hashed the timeline even when the requested cache entry
   did not exist. The indicator can sample 2,000 positions per update.

## Implementation

| Area | Change | Preserved behavior |
| --- | --- | --- |
| Hover | Publish the latest snapped frame after 100 ms on that frame; move the axis immediately with an imperative style update. | Hover never moves the playhead. Held-button scrubbing is not debounced. |
| Cancellation | Clear pending hover work on gesture start, leave, blur, document hiding, playback start, and unmount. | No delayed preview override after another interaction starts. |
| Zoom | Accumulate wheel, pinch, keyboard, and toolbar input in a ref; commit React zoom state once per animation frame. | Input deltas accumulate; bounds remain 0.1 through 10. |
| Ruler | Compute first and last visible tick indices directly, with 100 px overscan. | Absolute timestamps, labels, and positions remain stable during scroll/zoom. |
| Viewport | Share a RAF-coalesced scroll/resize measurement hook with the word lane. | Word selection and timing are unchanged. |
| Cache | Resolve the timeline hash lazily only when a cached candidate exists. | Cache hits still validate edits, project/quality scope, and expiry. |

This is not a worker or OffscreenCanvas migration. A stationary hover can still
invoke the existing main-thread preview pipeline once. Continuously moving to
different frames intentionally does not continuously update the video preview.

## Local before/after evidence

Real Electron renderer, viewport 1920 x 1018, isolated temporary user profile:
600 media clips and 1,200 captions over about 20 minutes, with a two-hour ruler.
The media clips reuse the same imported five-second sample video. This stresses
timeline UI size, not decoder diversity or hundreds of unique source files.
The existing Electron test helper disables GPU; results are not a production
hardware, Windows, or cross-platform performance guarantee.

The before run used the pre-change built frontend; the after run rebuilt it with
these changes. Events are reproducible synthetic pointer/wheel bursts delivered
to real application handlers. Preview-seek events and animation-frame timing are
measured without mocking preview rendering. Ruler seeking uses Playwright mouse
down, held movement, and mouse up.

| Measurement | Before | After |
| --- | ---: | ---: |
| Preview requests during 60 moving-pointer events | 59 | 0 |
| Preview requests including final settled position | 60 | 1 |
| Median hover animation-frame gap | 24.405 ms | 16.660 ms |
| Largest hover animation-frame gap | 40.485 ms | 314.290 ms |
| Mounted ruler ticks across six zoom bursts | 7,201-72,001 | 19-81 |
| Zoom burst to second animation frame | 84-13,800 ms | 24-118 ms |

Detailed zoom samples, in the same order:

| Wheel steps | Before ms | After ms | Before ticks | After ticks |
| ---: | ---: | ---: | ---: | ---: |
| +20 | 433.340 | 27.205 | 14,401 | 19 |
| -8 | 84.170 | 25.895 | 14,401 | 26 |
| +10 | 5,808.090 | 24.455 | 72,001 | 81 |
| -10 | 13,799.920 | 118.275 | 14,401 | 26 |
| +6 | 105.530 | 30.255 | 14,401 | 20 |
| -18 | 1,091.645 | 23.990 | 7,201 | 35 |

The after run still has an occasional approximately 314 ms frame gap shortly
after fixture creation, even with zero hover preview requests during movement.
The lazy cache-hash change did not remove it. Its cause is not established; do
not interpret these results as eliminating all stutters or guaranteeing 60 FPS.
Next investigation: profile fresh-project startup and compare warmed runs,
separating thumbnail/preview work, layout, and garbage collection before choosing
another optimization. The screenshot's preview warning badge was not diagnosed
by this navigation test; an empty `pageerror` list is not full render validation.

## Validation

- 31 focused unit-test files, 205 tests passed.
- Web TypeScript check and production build passed.
- Biome check and `git diff --check` passed for the changes.
- Real Electron navigation E2E passed, including hover cancellation on leave,
  unchanged playhead on hover, six zoom bursts, scrolling to `1:00:00`, returning
  to zero, and click/drag seeking to 2 s then 4 s.
- E2E guards fewer than 150 mounted ticks and less than 500 ms for each measured
  zoom burst. These thresholds are regression guards for this fixture, not SLAs.
- Unit coverage includes pending-input accumulation, bounds/invalid values,
  touch cancellation, lifecycle cleanup, stationary-pointer scroll/zoom mapping,
  fractional tick endpoints, resize/scroll updates, and cache invalidation.

Run from the QCut package directory (`qcut/` within the Git root):

```sh
bun run --cwd apps/web build
bun run build:electron
bunx playwright test timeline-navigation-performance.e2e.ts --project=electron --reporter=line
```

Run focused unit tests from `apps/web/`:

```sh
bunx vitest run src/components/editor/timeline/__tests__ src/hooks/timeline/__tests__ src/stores/editor/__tests__/playback-store-preview-scrub.test.ts src/lib/preview/__tests__/shared-frame-cache.test.ts --silent
bunx tsc --noEmit
```

To record a baseline, run the same E2E harness against a separately prepared
pre-change frontend build with `QCUT_TIMELINE_PERF_BASELINE=1`. This flag only
records to `before/` and disables the new performance assertions; it does not
restore old code or select an old build automatically.

Local artifacts (generated, not committed; subsequent runs overwrite them):

- `output/playwright/timeline-navigation/before/metrics.json`
- `output/playwright/timeline-navigation/after/metrics.json`
- `output/playwright/timeline-navigation/after/01-hover-settled.png`
- `output/playwright/timeline-navigation/after/02-zoom-complete.png`
- `output/playwright/timeline-navigation/after/03-hour-scroll.png`
- `output/playwright/timeline-navigation/after/04-ruler-drag.png`

Visual inspection confirmed a rendered video frame, aligned ruler/clip positions,
the distant hour label, and the playhead at 4 s after held-button dragging.
