# Native CLI E2E Speed Analysis

Date: 2026-02-28

## Problem

The 8-step native CLI E2E workflow (`native-cli-e2e-fix-report.md`) takes **5+ minutes** end-to-end. Most of that time is avoidable overhead, not actual work.

---

## Step-by-Step Time Breakdown

| Step | Command(s) | Estimated Time | Of Which Overhead |
|------|-----------|---------------|-------------------|
| 1 | `editor:navigator:projects` | ~1s | ~0.7s |
| 2 | `editor:navigator:open` | ~1s | ~0.7s |
| 3 | `editor:screen-recording:start` | ~2s | ~0.7s |
| 4 | `generate-image` x2 (sequential) | **60–180s** | 3–6s polling lag |
| 5 | `editor:media:import` x2 + `editor:timeline:add-element` x2 | ~4s | ~2.8s |
| 6 | `editor:timeline:seek` + `editor:timeline:play` | ~2s | ~1.4s |
| 7 | `editor:screen-recording:stop` | 2–90s | 0–75s (pre-fix) |
| 8 | File verification | ~0.1s | 0 |

**Estimated total**: 72–280s (1.2–4.7 min actual) + overhead = **5+ min observed**

---

## Bottleneck 1: Sequential Image Generation (Step 4)

**Impact: 30–90 seconds wasted**

The two `generate-image` calls run **strictly sequentially** — each one submits to the FAL API, then polls every 3 seconds until completion.

```
Image 1: submit → poll → poll → ... → done (30–60s)
Image 2: submit → poll → poll → ... → done (30–60s)
Total: 60–120s
```

If parallelized:
```
Image 1: submit ──→ poll → poll → ... → done
Image 2: submit ──→ poll → poll → ... → done
Total: 30–60s (same as single image)
```

**Root cause**: The E2E test script calls `generate-image` twice in sequence. The CLI runner (`runner.ts`) handles one command per invocation with no batch/parallel mode.

**Evidence**: `handler-generate.ts` — single `executor.executeStep()` call, awaited, no concurrency.

### Fix

Add a `--batch` or `--count` flag to `generate-image` that submits N jobs to FAL in parallel and polls them concurrently:

```typescript
// handler-generate.ts — parallel batch mode
const jobs = prompts.map(prompt => executor.executeStep(step, { text: prompt }, opts));
const results = await Promise.allSettled(jobs);
```

Alternatively, add a CLI-level `batch` command that accepts a JSON array of commands and runs independent ones in parallel.

**Savings: 30–90 seconds** (50% of image generation time).

---

## Bottleneck 2: Per-Command Health Check + Capability Negotiation

**Impact: ~6–10 seconds wasted across the workflow**

Every `editor:*` command creates a **new `EditorApiClient`** and performs:

1. `GET /api/claude/health` — health check
2. `GET /api/claude/capabilities` — capability negotiation (not cached across instances)

With 10 editor commands in the E2E flow, that's **20 extra HTTP round-trips** doing nothing useful after the first one succeeds.

**Evidence**: `cli-handlers-editor.ts:40-49` — `client.checkHealth()` called before every dispatch. `editor-api-client.ts:95-107` — health check also calls `negotiateCapabilities()`. Cache is per-instance, and each command creates a new instance via `createEditorClient()`.

### Fix

Option A — **Session-mode CLI**: Keep a single `EditorApiClient` alive across multiple commands (REPL or pipe mode).

Option B — **One-shot cache**: Write a health/capabilities result to a temp file with a short TTL (e.g., 10 seconds). Subsequent commands in the same session skip the check.

Option C — **Skip health on chained commands**: Add `--skip-health` flag for use when the caller knows the editor is up (e.g., an E2E test runner that already verified health in step 1).

**Savings: ~5–8 seconds** across the full workflow.

---

## Bottleneck 3: Process Startup Overhead

**Impact: ~8–15 seconds wasted**

Each CLI invocation is a separate process:
- Bun/Node.js process launch: ~200–500ms
- Module loading (TypeScript → JS, imports): ~300–800ms
- `loadEnvFile()` disk read: ~50–100ms
- Total per invocation: **~0.6–1.4s**

With ~12 separate CLI invocations in the E2E flow: **7–17 seconds** just in startup/teardown.

**Evidence**: `runner.ts:73` — `loadEnvFile(options.configDir)` runs on every invocation. Each command imports the full module tree including `ModelRegistry`, `PipelineExecutor`, handlers, etc.

### Fix

Add a **session/REPL mode** to the CLI runner:

```bash
qcut-cli --session <<'EOF'
editor:navigator:projects
editor:navigator:open --project-id abc123
editor:screen-recording:start
generate-image --text "sci-fi city" --model nano_banana_pro
generate-image --text "sci-fi character" --model nano_banana_pro
editor:media:import --project-id abc123 --source /path/to/img1.png
editor:media:import --project-id abc123 --source /path/to/img2.png
editor:timeline:add-element --project-id abc123 --type image --media-id m1
editor:timeline:add-element --project-id abc123 --type image --media-id m2
editor:timeline:seek --project-id abc123 --time 0
editor:timeline:play --project-id abc123
editor:screen-recording:stop
EOF
```

Single process, single health check, shared `EditorApiClient`, commands dispatched sequentially from a queue.

**Savings: ~7–14 seconds**.

---

## Bottleneck 4: Screen Recording Stop Timeout Cascade (Pre-Fix)

**Impact: 60–90 seconds wasted (before bug fixes)**

Before the fixes in the report, stopping a recording triggered a cascading timeout:

```
Renderer waitForRecorderStop() → hangs forever (no timeout)
  → Main process waits 60s for renderer
    → Force-stop hangs on fileStream.end() + writeQueue
      → CLI times out at 30s
```

**After the fix**: Clean stop in ~1.8s (per verification table). This bottleneck is **resolved** but worth noting since the timeout configuration is still aggressive:

- CLI timeout: 90s
- Utility server timeout: 90s
- Renderer timeout: 30s
- Main process renderer wait: 15s + force-stop fallback

These stacked timeouts mean the **worst case is still 90 seconds** if something goes wrong.

### Remaining Fix

Reduce the renderer timeout from 30s to 10s (MediaRecorder stop should be near-instant). Reduce force-stop FFmpeg transcode timeout to 15s. Net worst case: ~25s instead of ~90s.

---

## Bottleneck 5: Polling Interval Too Coarse

**Impact: ~3–15 seconds wasted**

FAL API polling uses a fixed 3-second interval (`api-caller.ts:163`):

```typescript
const POLL_INTERVAL_MS = 3000;
```

For image generation that takes 20 seconds, the last poll may fire at t=18s, then waits until t=21s to discover completion — **3 seconds of dead time per job**.

With 2 images: ~6 seconds wasted. With editor job polling (also 3s interval): up to ~3s more.

### Fix

Use **adaptive polling** — start aggressive, back off:

```typescript
// Start at 500ms, increase to 3s after 10s, then 5s after 30s
function getPollingInterval(elapsed: number): number {
  if (elapsed < 10_000) return 500;
  if (elapsed < 30_000) return 3_000;
  return 5_000;
}
```

FAL already returns `IN_PROGRESS` vs `IN_QUEUE` status — use this to switch intervals.

**Savings: 3–10 seconds** for the image generation steps.

---

## Bottleneck 6: No Batch Import/Add Operations

**Impact: ~2 seconds wasted**

Step 5 runs 4 separate CLI commands for 2 images:
```
editor:media:import (image 1)
editor:media:import (image 2)
editor:timeline:add-element (image 1)
editor:timeline:add-element (image 2)
```

Each command = new process + new client + health check + capability negotiation + HTTP request.

The editor already supports batch endpoints:
- `POST /api/claude/timeline/{id}/elements/batch` — up to 50 elements in one call
- `POST /api/claude/media/{id}/batch-import` — batch media import

### Fix

Use batch endpoints from the CLI:

```bash
qcut-cli editor:media:batch-import --project-id abc123 --sources img1.png,img2.png
qcut-cli editor:timeline:batch-add --project-id abc123 --elements '[...]'
```

Reduces 4 commands (with 12 HTTP round-trips) to 2 commands (with 6 HTTP round-trips).

**Savings: ~2 seconds**.

---

## Bottleneck 7: Capability Negotiation on Every Request

**Impact: ~1–2 seconds wasted**

Beyond the per-command overhead, `warnIfCapabilityLikelyUnsupported()` is called **on every HTTP request** (`editor-api-client.ts:306-354`). It does linear string matching across ~30+ path patterns, then awaits `negotiateCapabilities()`.

While the capabilities response is cached per-instance, the path-matching runs every time and the `await` creates an unnecessary microtask.

### Fix

Cache the capability lookup result per-path (not just per-instance). Or better: move the warning to debug-only mode. In production E2E runs, capability warnings add no value and should be skippable with `--no-capability-check`.

---

## Summary: Projected Time After All Fixes

| Bottleneck | Current Waste | After Fix |
|-----------|--------------|-----------|
| Sequential image gen | 30–90s | 0s (parallel) |
| Per-command health check | 6–10s | ~0.7s (one check) |
| Process startup x12 | 8–15s | ~1s (session mode) |
| Recording stop cascade | 0s (already fixed) | 0s |
| Polling interval | 3–15s | ~1–3s (adaptive) |
| No batch import/add | ~2s | ~0.5s (batch) |
| Capability check overhead | 1–2s | 0s (skip in E2E) |

**Current observed**: ~5+ minutes (300+ seconds)
**After all fixes**: ~35–70 seconds (image gen dominates)
**Speedup**: ~4–8x

---

## Priority Order

| Priority | Fix | Effort | Savings |
|----------|-----|--------|---------|
| P0 | Parallel image generation | Medium | 30–90s |
| P1 | Session/REPL mode for CLI | Medium-High | 12–25s |
| P2 | Adaptive polling intervals | Low | 3–10s |
| P3 | Batch import/add CLI commands | Low | ~2s |
| P4 | `--skip-health` flag | Low | ~5s |
| P5 | Reduce stacked recording timeouts | Low | Worst-case improvement |
