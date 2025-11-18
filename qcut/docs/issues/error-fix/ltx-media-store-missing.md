# LTX media missing after successful generation (with new console logging)

## What the latest console shows (`ltx_console_v2.md`)
- LTX Video 2.0 Fast T2V request succeeded with job_id and video URL.
- Media integration block executed: download 200 OK, blob size ~7.9 MB, file created `AI-Video-ltxv2_fast_t2v-...mp4`.
- `addMediaItem` was called and returned an item ID (not shown in this log, but earlier traces did).
- After generation, a CSP error appears when previewing: video blocked by Content Security Policy; message says to add `https://fal.media https://v3.fal.media https://v3b.fal.media` to `media-src`.

## Likely causes of “generated but not visible” given these logs
- **CSP blocks playback, not storage**: Even if saved, the preview fails unless CSP allows FAL media hosts. The log explicitly asks to add those hosts to `media-src`.
- **Storage rollback still possible**: If OPFS/IndexedDB writes fail, `addMediaItem` removes the in-memory item after logging a storage error. Check for new console errors emitted by `MediaStore.addMediaItem` (we now log failures with rollback details).
- **Project mismatch / filters**: Items are stored per `activeProject`. Switching projects or having filters/search applied will hide the item.

## Quick checks
1) DevTools console: look for `[MediaStore.addMediaItem] Storage save FAILED` logs or `handleStorageError` right after generation.
2) Verify CSP: ensure `media-src` includes `https://fal.media https://v3.fal.media https://v3b.fal.media`; reload and retry.
3) Confirm `activeProject.id` matches the one used during generation (`91792c80-b639-4b2a-bf54-6b7da08e2ff1` in this log) and clear filters/search.
4) Inspect runtime state after generation: `useMediaStore.getState().mediaItems` in console; if empty, persistence likely failed/rolled back.

## Suggested fixes (actionable)
- Add CSP allowances: update HTML/Electron CSP to permit `media-src` for `fal.media`, `v3.fal.media`, `v3b.fal.media` so previews work.
- Soften rollback: on storage save failure, keep the item in memory and show a toast/banner to inform the user; allow a "URL-only" save mode when OPFS/IndexedDB is blocked.
- Logging already added: use the new `[MediaStore.addMediaItem]` logs to pinpoint save failures; add a toast in `use-ai-generation` when `addMediaItem` rejects.

## Should we fix? Yes — recommended prioritization
1) **Unblock playback (must-do):** Add the FAL hosts to CSP `media-src` (and `child-src`/`frame-src` if embedded). Without this, videos appear broken even if stored.
2) **Keep items visible (should-do):** On storage failures, avoid removing the item from local state; mark as unsaved and notify via toast so the user still sees it.
3) **Fallback mode (nice-to-have):** Provide a “URL-only save” path when OPFS/IndexedDB are blocked (incognito/file:///Electron restrictions) so media remains listed and can be re-downloaded when storage is available.

## Implementation plan
- CSP allowlist (web/Electron): ensure `media-src` (and `child-src`/`frame-src` if embedded) includes `https://fal.media https://v3.fal.media https://v3b.fal.media`. Update the app’s CSP header/meta in the main HTML (web) and the BrowserWindow CSP (Electron).
- Keep items visible on storage failure (`qcut/apps/web/src/stores/media-store.ts`):
  - In `addMediaItem` catch, do **not** remove the item from state. Instead, mark it with `metadata.unsaved = true` and `metadata.storageError` details; keep the file/url so it stays listed.
  - Emit a toast/banner: “Saved locally, storage failed. Item marked unsaved; retry later.”
  - Optional: expose a retry helper that re-calls `storageService.saveMediaItem` for unsaved items.
- URL-only fallback (`qcut/apps/web/src/stores/media-store.ts`):
  - When `saveMediaItem` throws due to OPFS/IndexedDB restrictions, keep the item in state with a placeholder file (empty File) and `url` set to the remote URL, flagged as `metadata.urlOnly = true` and `metadata.unsaved = true`.
  - Emit a toast: “Saved as URL-only; persistent storage blocked. Re-download when storage is available.”
  - Optional retry: allow a “Save locally” action that re-downloads and retries `saveMediaItem` when storage becomes available.
