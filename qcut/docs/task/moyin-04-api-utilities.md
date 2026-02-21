# Moyin Integration: API Utilities (Key Rotation, Retry, Rate Limiting)

> **Date:** 2026-02-22
> **Feature:** Port Moyin's API key rotation, retry logic, and rate limiting utilities into QCut
> **Phase:** 1 (Portable Libraries)
> **Priority:** P1
> **Est. total effort:** ~1 hour (3 subtasks)
> **Parent:** [moyin-creator-integration-plan.md](moyin-creator-integration-plan.md)

---

## Summary

Port three self-contained utility modules from Moyin that improve AI API call reliability:
1. **API Key Manager** — rotate between multiple API keys per provider, auto-blacklist failed keys
2. **Retry with backoff** — exponential backoff on 429 (rate limit) and transient errors
3. **Rate limiter + concurrency control** — token bucket, batch processing, staggered parallel execution

These utilities are provider-agnostic and can improve QCut's existing AI pipeline reliability.

---

## Architecture Decision

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Location | `apps/web/src/lib/moyin/utils/` | Self-contained utilities, no UI dependency |
| Key storage | Electron IPC (existing `api-key-handler`) | QCut already stores API keys securely in Electron |
| Usage | Import in AI generation hooks and handlers | Drop-in enhancement to existing API call flows |

---

## Implementation Status

| Subtask | Status | Est. |
|---------|--------|------|
| 1. Port API Key Manager | Pending | 25 min |
| 2. Port retry + rate limiting utilities | Pending | 15 min |
| 3. Add unit tests | Pending | 20 min |

---

## Subtask 1: Port API Key Manager

**Priority:** P1
**Est. time:** 25 min

### Source files
- `/Users/peter/Desktop/code/moyin/moyin-creator/src/lib/api-key-manager.ts`

### Target files
- `apps/web/src/lib/moyin/utils/api-key-manager.ts` (NEW)

### Key exports to port

```typescript
class ApiKeyManager {
  constructor(apiKeyString: string)  // comma-separated keys
  getCurrentKey(): string | null
  rotateKey(): string | null
  markCurrentKeyFailed(): void
  handleError(statusCode: number): boolean  // returns true if key was rotated
  getAvailableKeyCount(): number
  getTotalKeyCount(): number
  hasKeys(): boolean
  reset(apiKeyString: string): void
}

// Standalone helpers
parseApiKeys(apiKey: string): string[]
getApiKeyCount(apiKey: string): number
maskApiKey(key: string): string
classifyModelByName(modelName: string): ModelCapability[]

type ModelCapability = "text" | "vision" | "image_generation" | "video_generation" | "embedding"
```

### Adaptation needed
- Remove `DEFAULT_PROVIDERS` constant (moyin-specific providers like MemeFast, RunningHub)
- Remove `IProvider` interface (QCut has its own provider config)
- Remove `resolveImageApiFormat()` and `resolveVideoApiFormat()` (moyin-specific API format routing)
- Remove `getProviderKeyManager()` / `updateProviderKeys()` / `clearAllManagers()` (global registry pattern — QCut should manage this at the handler level)
- Keep `ApiKeyManager` class and standalone helpers as-is

### Integration point
- QCut's `electron/ai-pipeline-handler.ts` currently gets keys via `getDecryptedApiKeys()`
- `ApiKeyManager` can wrap those keys to provide rotation: `new ApiKeyManager(keys.join(","))`

---

## Subtask 2: Port Retry + Rate Limiting Utilities

**Priority:** P1
**Est. time:** 15 min

### Source files
- `/Users/peter/Desktop/code/moyin/moyin-creator/src/lib/utils/retry.ts`
- `/Users/peter/Desktop/code/moyin/moyin-creator/src/lib/utils/rate-limiter.ts`
- `/Users/peter/Desktop/code/moyin/moyin-creator/src/lib/utils/concurrency.ts`

### Target files
- `apps/web/src/lib/moyin/utils/retry.ts` (NEW)
- `apps/web/src/lib/moyin/utils/rate-limiter.ts` (NEW)
- `apps/web/src/lib/moyin/utils/concurrency.ts` (NEW)
- `apps/web/src/lib/moyin/utils/index.ts` (NEW — barrel export)

### Key exports to port

**retry.ts:**
```typescript
interface RetryOptions {
  maxRetries?: number      // default: 3
  baseDelay?: number       // default: 1000ms
  onRetry?: (attempt: number, delay: number, error: Error) => void
}

isRateLimitError(error: unknown): boolean
retryOperation<T>(operation: () => Promise<T>, options?: RetryOptions): Promise<T>
withRetry<T>(fn: T, options?: RetryOptions): T  // decorator
```

**rate-limiter.ts:**
```typescript
interface RateLimitConfig {
  delayMs?: number      // default: 3000
  delayFirst?: boolean  // delay before first item
}

rateLimitedBatch<T, R>(items: T[], operation: (item: T, index: number) => Promise<R>, config?: RateLimitConfig, onProgress?: (progress: BatchProgress) => void): Promise<R[]>
delay(ms: number): Promise<void>
createRateLimitedFn<T>(fn: T, minDelayMs?: number): T
batchProcess<T, R>(items: T[], operation: (item: T) => Promise<R>, options?: BatchOptions): Promise<R[]>
```

**concurrency.ts:**
```typescript
runStaggered<T>(tasks: (() => Promise<T>)[], maxConcurrent: number, staggerMs?: number): Promise<PromiseSettledResult<T>[]>
```

### Adaptation needed
- None — these are self-contained, framework-agnostic utilities with no external dependencies.

---

## Subtask 3: Unit Tests

**Priority:** P2
**Est. time:** 20 min

### Target files
- `apps/web/src/lib/moyin/utils/__tests__/api-key-manager.test.ts` (NEW)
- `apps/web/src/lib/moyin/utils/__tests__/retry.test.ts` (NEW)
- `apps/web/src/lib/moyin/utils/__tests__/rate-limiter.test.ts` (NEW)

### Test coverage

**api-key-manager.test.ts:**
- `ApiKeyManager` — rotates through multiple keys
- `ApiKeyManager` — `markCurrentKeyFailed()` skips blacklisted keys
- `ApiKeyManager` — `handleError(429)` triggers rotation
- `ApiKeyManager` — returns null when all keys exhausted
- `parseApiKeys()` — splits comma-separated string
- `maskApiKey()` — shows first/last chars only
- `classifyModelByName("veo3")` — includes `"video_generation"`

**retry.test.ts:**
- `retryOperation()` — succeeds on first try (no retry)
- `retryOperation()` — retries on failure up to maxRetries
- `retryOperation()` — calls `onRetry` callback with attempt info
- `retryOperation()` — throws after exhausting retries
- `isRateLimitError()` — detects 429 status codes

**rate-limiter.test.ts:**
- `rateLimitedBatch()` — processes all items with delay between them
- `delay()` — resolves after specified ms
- `runStaggered()` — respects `maxConcurrent` limit
- `runStaggered()` — returns `PromiseSettledResult` for each task

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Provider-specific managers (`getProviderKeyManager`) | QCut manages providers differently |
| `DEFAULT_PROVIDERS` | Moyin-specific provider list |
| `generateId()` | QCut already has UUID generation |
