# Subtask V2-4: Continue Split `use-ai-generation.ts`

**Parent Plan:** [split-top5-large-files-plan-v2.md](./split-top5-large-files-plan-v2.md)  
**Phase:** 4  
**Status:** COMPLETED (February 11, 2026)

---

## Goal

Extract remaining inline logic from `use-ai-generation.ts` into focused hook/modules while preserving `useAIGeneration` return-contract compatibility for `apps/web/src/components/editor/media-panel/views/ai/index.tsx`.

---

## Completion Summary

Implemented all extraction targets from this subtask:

1. `startStatusPolling` extracted to `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-polling.ts`
2. `handleMockGenerate` extracted to `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-mock-generation.ts`
3. Veo 3.1 state/setters extracted to `apps/web/src/components/editor/media-panel/views/ai/hooks/use-veo31-state.ts`
4. Reve Edit state/handlers extracted to `apps/web/src/components/editor/media-panel/views/ai/hooks/use-reve-edit-state.ts`
5. `use-ai-generation.ts` updated to compose those modules and keep public API compatibility

---

## Files Added

- `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-polling.ts`
- `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-mock-generation.ts`
- `apps/web/src/components/editor/media-panel/views/ai/hooks/use-veo31-state.ts`
- `apps/web/src/components/editor/media-panel/views/ai/hooks/use-reve-edit-state.ts`
- `apps/web/src/components/editor/media-panel/views/ai/hooks/__tests__/use-veo31-state.test.ts`
- `apps/web/src/components/editor/media-panel/views/ai/hooks/__tests__/use-reve-edit-state.test.ts`
- `apps/web/src/components/editor/media-panel/views/ai/hooks/__tests__/use-ai-mock-generation.test.ts`
- `apps/web/src/components/editor/media-panel/views/ai/hooks/__tests__/use-ai-polling.test.ts`
- `apps/web/src/components/editor/media-panel/views/ai/hooks/__tests__/use-ai-generation-contract.test.ts`

## Files Updated

- `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts`

---

## Behavior/Contract Notes

- `useAIGeneration` remains the public entrypoint.
- `export type UseAIGenerationReturn = ReturnType<typeof useAIGeneration>` remains intact.
- Polling lifecycle parity preserved:
  - clears previous interval before start
  - immediate first poll before periodic interval
  - clears interval on completion/failure
  - resolve-once behavior
- Mock generation now reuses validation via `validateGenerationInputs` where applicable.
- Reve Edit URL lifecycle preserved (`URL.revokeObjectURL` on clear/reset paths).

---

## Verification Performed

1. Targeted hook tests:

```bash
bun x vitest run --config apps/web/vitest.config.ts \
  apps/web/src/components/editor/media-panel/views/ai/hooks/__tests__/use-ai-generation-helpers.test.ts \
  apps/web/src/components/editor/media-panel/views/ai/hooks/__tests__/use-veo31-state.test.ts \
  apps/web/src/components/editor/media-panel/views/ai/hooks/__tests__/use-reve-edit-state.test.ts \
  apps/web/src/components/editor/media-panel/views/ai/hooks/__tests__/use-ai-mock-generation.test.ts \
  apps/web/src/components/editor/media-panel/views/ai/hooks/__tests__/use-ai-polling.test.ts \
  apps/web/src/components/editor/media-panel/views/ai/hooks/__tests__/use-ai-generation-contract.test.ts
```

Result: **6 files passed, 47 tests passed**.

2. Type-check (`apps/web`):

```bash
bun x tsc -p apps/web/tsconfig.json --noEmit
```

Result: **passed**.

3. Lint/format check on touched files:

```bash
bun x @biomejs/biome check <touched files>
```

Result: **passed**.

4. Workspace `check-types`:

```bash
bun run check-types
```

Result: turbo reported **no tasks executed** in this environment; explicit `tsc` check above used for verification.

---

## Follow-up

- Optional: run manual `electron:dev` smoke flow for text/image/avatar/upscale generation from UI before merge.
