# LTX Video generated but missing in Media Panel

## What happened (from `ltx.md` log)
- LTX Video 2.0 Fast T2V request succeeded, returned job_id and mp4 URL.
- Video was downloaded (HTTP 200), blob size ~2.8 MB, file created: `AI-Video-ltxv2_fast_t2v-1763436029098.mp4`.
- `addMediaItem` ran with projectId `91792c80-b639-4b2a-bf54-6b7da08e2ff1` and completed, returning `newItemId: 23f4be8d-76d1-1928-ad33-dc7feaf7675e`.
- `use-ai-generation` logged `SUCCESS: Video added to media store!` and called `onComplete`.

## Why it can still be invisible in the media panel
- `addMediaItem` saves to local state first, **but removes the item if `storageService.saveMediaItem` throws**. OPFS/IndexedDB failures (common in incognito/blocked storage or file://) will silently drop the item after logging a storage error. If storage failed, the panel shows nothing despite the earlier success logs.
- The media panel shows items for the *current* `activeProject`. If the user switched projects after generation, the newly added item (for `91792c80-b639-4b2a-bf54-6b7da08e2ff1`) is filtered out.
- Panel filters/search can hide it (type filters, text search). Generation adds `type: "video"`; any non-video filter hides it.

## Quick checks
1) Open DevTools console and look for `StorageService.saveMediaItem` errors or `handleStorageError` logs immediately after generation.
2) Confirm `activeProject.id` matches the project in the log (`91792c80-b639-4b2a-bf54-6b7da08e2ff1`).
3) Clear media panel filters/search; ensure the Video tab is visible.
4) In console, inspect `useMediaStore.getState().mediaItems` after generation. If empty, persistence likely failed and the state was rolled back.

## Suggested fixes
- Do not remove from `mediaItems` when persistence fails; instead mark it unsaved and surface a toast so the user still sees the item and can retry.
- Bubble up `storageService.saveMediaItem` errors to the UI (toast + badge) instead of only console logging.
- Add a post-save assertion in `use-ai-generation` to confirm the item remains in `mediaItems`; if missing, re-add with a warning.
- In environments where OPFS/IndexedDB is restricted, allow a “URL-only” add mode that skips file persistence but keeps the entry visible.
