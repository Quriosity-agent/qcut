# FAL video download-to-local then upload-to-media flow

## When to use
- For generated videos (e.g., FAL LTX/Sora) we must download the remote URL to a local File, then add to media store to avoid CSP/load issues and to persist in storage.
- Use this flow whenever `response.video_url` is remote (fal.media / v3*.fal.media).

## Steps to implement
1) **Download the video**
   ```ts
   const response = await fetch(videoUrl);
   if (!response.ok) throw new Error(`Video download failed: ${response.status}`);
   const blob = await response.blob();
   const file = new File([blob], `AI-Video-${modelId}-${Date.now()}.mp4`, { type: "video/mp4" });
   ```

2) **Add to media store**
   ```ts
   const newItemId = await addMediaItem(activeProject.id, {
     name: `AI: ${prompt.substring(0, 30)}...`,
     type: "video",
     file,
     url: videoUrl, // keep remote URL as well
     duration: videoMetaDuration ?? 0,
     width: videoMetaWidth ?? 1920,
     height: videoMetaHeight ?? 1080,
   });
   ```

3) **Handle failures gracefully**
   - If download fails: surface a toast with the HTTP status.
   - If `addMediaItem` fails (storage blocked): keep the item in state as URL-only (unsaved) and show a toast; allow retry.

## Where to put the logic
- Primary: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts` inside the media integration block after a successful generation response.
- Uses: `addMediaItem` from media store and `activeProject.id` to scope the media.

## Notes
- Preserve both the local `file` (for persistence) and the remote `url` for reference/playback.
- File naming: include modelId + timestamp for uniqueness.
- Validate `response.ok` before reading the blob to avoid silent partials.
- Ensure CSP allows FAL hosts (media/child/frame-src) so playback works even before download.
