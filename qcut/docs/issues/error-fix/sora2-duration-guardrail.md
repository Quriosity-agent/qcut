# Sora 2 Duration Guardrail (Prevent 422 on duration)

## TL;DR
- FAL `fal-ai/sora-2/text-to-video` only accepts durations **4, 8, 12**.
- Our UI previously offered 2-6s and defaulted to 5-6s, letting users pick invalid values that cause 422.
- Fix applied: lock the UI to valid options and sanitize the outgoing payload before submission.

## Implemented changes
- `qcut/apps/web/src/components/editor/media-panel/views/text2video-models-config.ts`: Sora 2 `supportedDurations` is now `[4, 8, 12]`; `defaultDuration` is `4`.
- `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`: Text-to-video UI defaults `t2vDuration` to `4`, and the select fallback now also defaults to `4`.
- `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`: Added `getSafeDuration` to clamp any outgoing duration to the model's allowed list (uses `defaultDuration` or the first allowed). Logs `T2V_DURATION_SANITIZED` when a stale/invalid duration is corrected. Hook default prop for `t2vDuration` is now `4`.

## Why this prevents the error
- Duration dropdown only renders allowed durations, so users cannot pick invalid values.
- Payload guard ensures we never send `duration` outside `[4, 8, 12]`, even if a stale value sneaks in (e.g., saved preset, stale session, or future config mismatch).

## Quick regression checks
- Sora 2 request sends `duration` ∈ {4, 8, 12}; no `value_error.const` in logs.
- Other models still render their own valid duration options and combined selections use the intersection as before.
- Debug log shows `T2V_DURATION_SANITIZED` only when an invalid persisted value was corrected.
