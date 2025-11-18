# Sora 2 Duration Guardrail (Prevent 422 on duration)

## TL;DR
- FAL `fal-ai/sora-2/text-to-video` only accepts durations **4, 8, 12**.
- Our UI offered 2-6s and defaulted to 5-6s, letting users pick invalid values that cause 422.
- Fix: lock the UI to valid options and sanitize the outgoing payload.

## Required changes
1) `qcut/apps/web/src/components/editor/media-panel/views/text2video-models-config.ts`
   - Set `supportedDurations` for `sora2_text_to_video` to `[4, 8, 12]`.
   - Set `defaultDuration` to `4` (shortest valid value).
2) `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
   - Initialize `t2vDuration` state to `4` so the default selection is always valid.
3) `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
   - Before submitting, if `duration` is not in the model's `supportedDurations`, fall back to `defaultDuration` (or the first supported value). This guards against stale state or saved presets.

## Why this prevents the error
- Duration dropdown only renders allowed durations, so users cannot pick invalid values.
- Payload guard ensures we never send `duration` outside `[4, 8, 12]`, even if a stale value sneaks in.

## Quick regression checks
- Sora 2 request sends `duration` ∈ {4, 8, 12}; no `value_error.const` in logs.
- Other models still render their own valid duration options and combined selections use the intersection as before.
