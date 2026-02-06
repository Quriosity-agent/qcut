# Fix: FAL Queue Polling — CORS + URL Structure

## Symptom

After submitting a Kling v3 T2V generation via queue mode, the UI gets stuck at:

```
[AI View] Progress: 0% - Submitting request to FAL.ai queue...
```

Console shows repeated errors on the polling endpoint:

```
Access to fetch at 'https://queue.fal.run/requests/{id}/status' from origin 'app://.'
has been blocked by CORS policy
```

Or after CORS is bypassed:

```
Queue status check failed (attempt N): 405
```

The request never progresses past 0% and eventually times out.

## Root Cause (Two Issues)

### Issue 1: CORS blocking from Electron

`queue.fal.run` does not return `Access-Control-Allow-Origin` headers for Electron's `app://` origin. All `fetch()` calls from the renderer process to `queue.fal.run` are blocked by the browser's CORS enforcement.

**Why `onHeadersReceived` didn't work**: Chromium handles CORS preflight (OPTIONS) at a lower network layer before Electron's `webRequest` interceptors fire. Injecting CORS headers in `onHeadersReceived` cannot fix the preflight rejection.

**Solution**: Proxy queue polling through Electron's main process via IPC (`fal:queue-fetch`). Node.js `fetch` in the main process has no CORS restrictions. This follows the same pattern already used for `fal:upload-video`, `fal:upload-image`, and `fal:upload-audio`.

### Issue 2: Wrong polling URL structure

After CORS was bypassed, polling still failed with **405 Method Not Allowed**. We tried two URL patterns:

| Pattern | Result |
|---------|--------|
| `queue.fal.run/requests/{id}/status` | 405 |
| `queue.fal.run/{endpoint}/requests/{id}/status` | 405 |

**Per [FAL Queue API docs](https://docs.fal.ai/model-apis/model-endpoints/queue)**, the correct REST endpoints are:

```
Submit:  POST https://queue.fal.run/{model_id}
Status:  GET  https://queue.fal.run/{model_id}/requests/{request_id}/status
Result:  GET  https://queue.fal.run/{model_id}/requests/{request_id}
Cancel:  PUT  https://queue.fal.run/{model_id}/requests/{request_id}/cancel
```

The submission response returns four fields:

| Field | Description |
|-------|-------------|
| `request_id` | Unique identifier for tracking the queued task |
| `status_url` | Exact URL to monitor processing progress |
| `response_url` | Exact URL to fetch final results |
| `cancel_url` | URL to cancel before processing begins |

Optional query param: `?logs=1` to enable log output in status responses.

Our second URL pattern (`queue.fal.run/{endpoint}/requests/{id}/status`) matches the documented format, yet still returns 405. This could be due to the `{model_id}` format differing from our `endpoint` variable, or an API-specific behavior. Regardless, **the safest approach is to use the `status_url` and `response_url` returned by the submission response** — they are guaranteed correct.

**Evidence from our codebase**: `video-edit-client.ts` already defines the correct response type:

```ts
interface FalQueueResponse {
  request_id: string;
  status_url?: string;  // FAL provides the exact polling URL
}
```

But `text-to-video.ts` only extracts `request_id` and ignores `status_url`:

```ts
const queueResult = await queueResponse.json();
const requestId = queueResult.request_id;  // only this is used
// queueResult.status_url is ignored!
// queueResult.response_url is ignored!
```

Then `polling.ts` constructs URLs from scratch — which don't match what FAL expects.

## Fix Plan

### Step 1: Use FAL-provided URLs (polling.ts + text-to-video.ts)

1. In `text-to-video.ts`, extract `status_url` and `response_url` from the queue submission response
2. Pass them into `pollQueueStatus()` via `PollOptions`
3. In `polling.ts`, use these URLs directly instead of constructing them
4. Fall back to constructed URLs only if the response doesn't include them

```ts
// text-to-video.ts — pass URLs from submission response
if (requestId) {
  return await pollQueueStatus(requestId, {
    endpoint,
    startTime,
    onProgress,
    statusUrl: queueResult.status_url,    // NEW
    responseUrl: queueResult.response_url, // NEW
    ...
  });
}
```

```ts
// polling.ts — use provided URLs or fall back
const statusUrl = options.statusUrl
  || `${FAL_QUEUE_BASE}/${endpoint}/requests/${requestId}/status`;
const resultUrl = options.responseUrl
  || `${FAL_QUEUE_BASE}/${endpoint}/requests/${requestId}`;
```

### Step 2: IPC proxy (already implemented)

The `fal:queue-fetch` IPC handler is already in place:

| File | Change |
|------|--------|
| `electron/main.ts` | `fal:queue-fetch` IPC handler — proxies GET to queue.fal.run via Node.js |
| `electron/preload.ts` | Exposes `electronAPI.fal.queueFetch()` |
| `apps/web/src/types/electron.d.ts` | Type definition for `queueFetch` |
| `apps/web/src/lib/ai-video/core/polling.ts` | `fetchQueue()` helper uses IPC when available, falls back to direct fetch |

### Step 3: Clean up debug logging

Remove the verbose `console.log` statements added during debugging once the fix is verified.

## Files to Change

| File | Change |
|------|--------|
| `apps/web/src/lib/ai-video/core/polling.ts` | Add `statusUrl`/`responseUrl` to `PollOptions`, use them in poll loop |
| `apps/web/src/lib/ai-video/generators/text-to-video.ts` | Extract and pass `status_url`/`response_url` from queue response (3 call sites) |

## Commits So Far

| Commit | Description |
|--------|-------------|
| `1e8e4b45` | feat: add Kling v3 model routing, queue support, and duration fix |
| `7c02b029` | fix: resolve CORS blocking for FAL queue polling in Electron (onHeadersReceived — didn't work) |
| `14fc91d0` | fix: proxy FAL queue polling through Electron IPC to bypass CORS |
| `0228c314` | fix: add queueFetch mock to electron test mock |
| `d95c2cff` | fix: include endpoint prefix in FAL queue polling URLs (still 405) |

## Key Lessons

1. **Electron CORS preflight**: `session.webRequest.onHeadersReceived` cannot intercept CORS preflight requests — Chromium handles them at a lower network layer. Use IPC proxy instead.
2. **Don't guess API URLs**: When an API returns `status_url`/`response_url` in its response, use them. Constructing URLs by guessing the pattern leads to fragile code that breaks when the API changes.
3. **Build steps matter**: Changes to `electron/main.ts` and `electron/preload.ts` require `bun run build:electron` (TypeScript compilation). The web app build (`bun run build`) alone is not enough.
