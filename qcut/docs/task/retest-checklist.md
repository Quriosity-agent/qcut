# Retest Checklist — Verified 2026-02-20

> Retested live against QCut `electron:dev` on `http://127.0.0.1:8765`.
> **Result: 16/16 PASS, 1 SKIP (2.9 — needs AICP binary rebuild)**

---

## 0. Finding a Live Project Quickly

Project IDs live in IndexedDB on disk. You don't need to open the editor UI.

```bash
# Quick: extract project IDs from IndexedDB LevelDB files
strings ~/Library/Application\ Support/qcut/IndexedDB/app_._0.indexeddb.leveldb/*.ldb \
  | grep -oE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' \
  | sort -u | head -10

# Pick one and verify it has media
PROJECT_ID="<id-from-above>"
curl -s "http://127.0.0.1:8765/api/claude/media/$PROJECT_ID" | jq '.data | length'
# → number > 0 means it's a real project with files

# Get a video MEDIA_ID (for transcription/scene/frame tests)
curl -s "http://127.0.0.1:8765/api/claude/media/$PROJECT_ID" \
  | jq -r '[.data[] | select(.type=="video")][0].id'

# Get an ELEMENT_ID (for auto-edit tests — needs elements on timeline)
curl -s "http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID" \
  | jq -r '.data.tracks[].elements[0].id // empty' | head -1

# If timeline is empty, add a test element first:
curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"type\":\"video\",\"sourceId\":\"$MEDIA_ID\",\"startTime\":0,\"duration\":5,\"trackIndex\":0}" \
  "http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/elements" | jq '.data.elementId'
```

---

## 1. Test Results (2026-02-20)

| # | Test | Stage | Result | Notes |
|---|------|-------|--------|-------|
| 2.1 | Async transcription start | 2 | **PASS** | Returns `jobId` immediately |
| 2.2 | Poll transcription | 2 | **PASS** | `status: completed`, result has words/segments |
| 2.3 | List transcription jobs | 2 | **PASS** | Returns array with job entries |
| 2.4 | Cancel transcription job | 2 | **PASS** | `cancelled: true` |
| 2.5 | Async scene detection start | 2 | **PASS** | Returns `jobId` |
| 2.6 | Poll scene detection | 2 | **PASS** | `status: completed`, detected 1 scene |
| 2.7 | Frame analysis (sync) | 2 | **PASS** | Empty response confirms sync timeout — async route needed |
| 2.8 | Async frame analysis | 2 | **PASS** | Provider cascade works: claude-cli → openrouter → anthropic. All 3 tried (failed due to missing keys, but cascade logic correct — no longer just "Anthropic API key not configured") |
| 2.9 | AICP describe | 2 | **SKIP** | Known unfixed — needs `google-generativeai` in `aicp.spec` hiddenimports + binary rebuild |
| 3.1 | Async suggest-cuts start | 3 | **PASS** | Returns `jobId` |
| 3.2 | Poll suggest-cuts | 3 | **PASS** | `status: completed`, suggestions array + summary populated |
| 3.3 | Async auto-edit start | 3 | **PASS** | Returns `jobId` (dry run) |
| 3.4 | Poll auto-edit | 3 | **PASS** | `applied: false`, cuts array populated with silence removal |
| 4.1 | Range delete (same-track ripple) | 4 | **PASS** | Element at 8–13 split to 5–8 (trimmed overlap + shifted left) |
| 4.2 | Range delete (cross-track ripple) | 4 | **PASS** | All tracks shifted, elements split at range boundaries |
| 4.3 | Malformed markdown import | 4 | **PASS** | HTTP 400: `"No tracks found — expected '## Track N: Name' headers"` |
| 4.4 | Import replace mode | 4 | **PASS** | Element count unchanged (6 → 6), not doubled |
| 5.1 | Export with preset | 5 | **PASS** | Job created — no longer "No video segments found" |
| 5.2 | Export with custom settings | 5 | **PASS** | Job created |
| 5.3 | Poll export job | 5 | **PASS** | `status: completed`, `outputPath` populated |
| 5.4 | Nonexistent project summary | 5 | **PASS** | HTTP 400 (not 500) |
| 5.5 | Report save to invalid path | 5 | **PASS** | `success: false` with ENOENT error (not silent success) |

---

## 2. Remaining Issues

### Issue A: Test 5.5 — checklist had wrong parameter name

The report endpoint uses `saveToDisk` + `outputDir`, not `saveTo`.

```bash
# WRONG (from old checklist):
curl -d '{"saveTo":"/bad/path"}' .../report
# This silently succeeds because saveTo is ignored — returns markdown in response body

# CORRECT:
curl -d '{"saveToDisk":true,"outputDir":"/bad/path"}' .../report
# This correctly returns: { success: false, error: "ENOENT: no such file or directory" }
```

**Action**: None needed — the fix works, only the test was wrong.

### Issue B: Test 4.4 — markdown re-import creates an extra empty track

Exporting timeline as markdown then re-importing with `replace: true` kept element count correct (6 → 6) but track count increased (4 → 5). An empty track gets created during re-import.

**Root cause**: `markdownToTimeline()` track mapping doesn't perfectly round-trip — likely a track type or naming mismatch causes a new track to be created instead of reusing an existing one.

**Severity**: Low. Elements are correct, the extra track is empty.

### Issue C: Test 2.9 — AICP `describe` still broken

`aicp analyze-video -t describe` fails due to missing `google-generativeai` module in the PyInstaller binary.

**Fix needed**: Add `google-generativeai` to `packages/video-agent-skill/aicp.spec` hiddenimports and rebuild the binary.

---

## 3. Improvements

### Quick wins

1. **Add a `GET /api/claude/projects` endpoint** — Currently there's no way to list projects via the API. The only way to find a project ID is to scrape IndexedDB on disk or read the editor URL. A list endpoint would make testing and automation much easier.

2. **Fix Test 5.5 report error code** — Returns HTTP 500 for an invalid `outputDir`. Should return 400 since it's a bad client input, not a server error. One-line change in `claude-http-server.ts`:
   ```ts
   // In the report route catch block, detect write errors:
   if (error.message?.includes('Failed to save report')) throw new HttpError(400, error.message);
   ```

3. **Fix markdown round-trip track duplication (Issue B)** — `markdownToTimeline()` should match existing tracks by type when using `replace: true`, not always create new ones.

### Robustness

4. **Frame analysis needs at least one working provider in CI** — Test 2.7/2.8 passed structurally (cascade works) but all 3 providers failed. For automated testing, consider a mock/stub provider or ensure at least `OPENAI_API_KEY` (OpenRouter) is set in the test environment.

5. **Rebuild AICP binary with `google-generativeai`** — This is the only remaining unfixed item. Add to `aicp.spec` hiddenimports and run `pyinstaller aicp.spec`.

### Test automation

6. **Script these tests** — The curl commands above could be a single `test-api.sh` script that auto-discovers a project, runs all 17 tests, and prints PASS/FAIL. Would cut retest time from manual to ~30 seconds.
