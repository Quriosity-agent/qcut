# FAL API vs QCut Implementation Differences — Kling v3 Standard T2V

## Source

FAL API docs: `https://fal.ai/models/fal-ai/kling-video/v3/standard/text-to-video/api`

## Differences Found

### 1. Timeout Too Short (likely cause of generation failure)

- **FAL `subscribe()`** waits indefinitely until the job completes
- **Our implementation**: 60 attempts × 5s = **5 minutes max**
- Kling v3 can take longer than 5 minutes under load, which is exactly why the generation timed out with `Maximum polling attempts reached`

### 2. Missing `logs: true` Parameter

- **FAL docs**: Pass `logs: true` when checking status to get progress logs
- **Our implementation**: We don't pass `logs: true` in status polling — that's why `logs` is always an empty array in the console output (`logs: Array(0)`)

### 3. `resolution` vs `aspect_ratio`

- **FAL docs**: Uses `aspect_ratio` (enum: `"16:9"`, `"9:16"`, `"1:1"`)
- **Our implementation**: Sends `resolution` — FAL may silently ignore this unknown parameter

### 4. Missing `generate_audio` Parameter

- **FAL docs**: `generate_audio` defaults to `true`, costs more ($0.252/s vs $0.168/s)
- **Our implementation**: Doesn't send it, so FAL defaults to audio ON — paying ~50% more per generation unnecessarily if audio is not needed

### 5. Raw HTTP vs FAL Client

- **FAL docs**: Uses `@fal-ai/client` library (`fal.queue.submit()`, `fal.queue.status()`, `fal.queue.result()`)
- **Our implementation**: Raw HTTP with `X-Fal-Queue: true` header to `queue.fal.run`. Functionally equivalent but misses any retry/timeout logic the client handles internally

### 6. Pricing Discrepancy

- **FAL docs say per-second**: $0.168/s (no audio), $0.252/s (with audio), $0.308/s (voice control)
- **MEMORY.md** says flat per-generation — may be outdated or only applies to I2V models

## FAL API Reference (for fixing)

### Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prompt` | string | required | Text prompt for video generation |
| `duration` | enum | "5" | Video length in seconds (3-15s) |
| `aspect_ratio` | enum | "16:9" | Options: 16:9, 9:16, 1:1 |
| `generate_audio` | boolean | true | Whether to generate native audio |
| `negative_prompt` | string | "blur, distort, and low quality" | Undesired elements |
| `cfg_scale` | float | 0.5 | How close to stick to prompt |
| `multi_prompt` | list | optional | Multi-shot video generation |
| `voice_ids` | list | optional | Voice IDs for generation |
| `shot_type` | enum | "customize" | Options: customize, intelligent |

### Queue API Usage

**Submit:**
```javascript
const { request_id } = await fal.queue.submit(
  "fal-ai/kling-video/v3/standard/text-to-video",
  { input: { prompt: "...", duration: "5" } }
);
```

**Check Status:**
```javascript
const status = await fal.queue.status(
  "fal-ai/kling-video/v3/standard/text-to-video",
  { requestId: "...", logs: true }
);
```

**Fetch Result:**
```javascript
const result = await fal.queue.result(
  "fal-ai/kling-video/v3/standard/text-to-video",
  { requestId: "..." }
);
```

## Root Cause of Timeout

The **5-minute polling limit** is too short for Kling v3. FAL's own client doesn't impose a timeout. The job was likely still generating on FAL's servers when QCut gave up polling.
