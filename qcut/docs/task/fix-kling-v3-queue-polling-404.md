# Fix: Kling v3 Queue Polling 404 Errors

## Symptom

After submitting a Kling v3 T2V generation, the UI gets stuck at:

```
[AI View] Progress: 0% - Submitting request to FAL.ai queue...
```

Console shows repeated 404s on the polling endpoint:

```
GET https://fal.run/queue/requests/6b2e584e-…/status 404 (Not Found)
Queue status check failed (attempt 2): 404
Queue status check failed (attempt 3): 404
…
```

The request never progresses past 0% and eventually times out.

## Root Cause

The **submission** (POST) was already fixed to use `queue.fal.run`:

```
POST https://queue.fal.run/fal-ai/kling-video/v3/… → 200 OK, returns { request_id }
```

But the **polling** code in `polling.ts` still constructs URLs using `FAL_API_BASE` (`https://fal.run`):

| Operation | Current (broken) URL | Correct URL |
|-----------|---------------------|-------------|
| Status check (line 104) | `https://fal.run/queue/requests/{id}/status` | `https://queue.fal.run/requests/{id}/status` |
| Result fetch (line 134) | `https://fal.run/queue/requests/{id}` | `https://queue.fal.run/requests/{id}` |

The FAL queue API lives on a separate subdomain (`queue.fal.run`). The path `fal.run/queue/…` does not exist, hence the 404.

## Fix

In `apps/web/src/lib/ai-video/core/polling.ts`:

1. Import `FAL_QUEUE_BASE` instead of (or in addition to) `FAL_API_BASE`
2. Replace both polling URLs to use `FAL_QUEUE_BASE`:

```ts
// Line 104 - status polling
const statusResponse = await fetch(
  `${FAL_QUEUE_BASE}/requests/${requestId}/status`,
  …
);

// Line 134 - result fetch
const resultResponse = await fetch(
  `${FAL_QUEUE_BASE}/requests/${requestId}`,
  …
);
```

Note the path change: `FAL_QUEUE_BASE` is `https://queue.fal.run`, so the URLs become:
- `https://queue.fal.run/requests/{id}/status` (was `https://fal.run/queue/requests/{id}/status`)
- `https://queue.fal.run/requests/{id}` (was `https://fal.run/queue/requests/{id}`)

## Files to Change

| File | Change |
|------|--------|
| `apps/web/src/lib/ai-video/core/polling.ts` (line 10) | Import `FAL_QUEUE_BASE` from `./fal-request` |
| `apps/web/src/lib/ai-video/core/polling.ts` (line 104-105) | Use `FAL_QUEUE_BASE` for status URL |
| `apps/web/src/lib/ai-video/core/polling.ts` (line 134-135) | Use `FAL_QUEUE_BASE` for result URL |

## Why It Wasn't Caught

The original plan marked `polling.ts` as "no changes needed" because the polling *logic* (retry, progress mapping, error handling) is correct. The bug is specifically in the base URL used to construct the polling endpoints — a one-character-level oversight (`FAL_API_BASE` vs `FAL_QUEUE_BASE`).

## CSP Note

`queue.fal.run` is already allowed in both `electron/main.ts` and `index.html` Content Security Policy headers, so no CSP changes are needed.
