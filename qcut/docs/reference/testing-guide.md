# QCut Testing Guide

## Quick Start

```bash
# Run all tests
cd apps/web && bun run test

# Run with UI
bun run test:ui

# Run with coverage
bun run test:coverage

# Watch mode
bun run test:watch
```

## Framework

- **Test Runner**: Vitest with JSDOM environment
- **Testing Library**: @testing-library/react
- **Status**: 230+ tests passing

## Test Categories

| Category | Description | Location |
|----------|-------------|----------|
| **UI Components** | Button, Checkbox, Dialog, Toast, Tabs, Slider, etc. | `src/components/**/*.test.tsx` |
| **Hooks** | Custom React hooks | `src/hooks/**/*.test.ts` |
| **Integration** | Store initialization, project workflows | `src/**/*.integration.test.ts` |
| **Utilities** | Helper functions | `src/lib/**/*.test.ts` |

## Test Environment Setup

The test environment is configured in `vitest.config.ts` with:

### Browser API Mocks
- `MutationObserver` - DOM mutation detection
- `ResizeObserver` - Element resize detection
- `IntersectionObserver` - Viewport intersection
- `matchMedia` - Media queries

### Radix UI Compatibility
Enhanced setup for complex UI components that use Radix primitives.

### Electron API Mocks
All `window.electronAPI` methods are mocked for isolated testing:

```typescript
// Example mock structure
window.electronAPI = {
  sounds: { search: vi.fn() },
  ffmpeg: { process: vi.fn() },
  // ... other APIs
}
```

## Writing Tests

### Component Test Example

```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('renders with text', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button')).toHaveTextContent('Click me')
  })
})
```

### Hook Test Example

```typescript
import { renderHook, act } from '@testing-library/react'
import { useCounter } from './useCounter'

describe('useCounter', () => {
  it('increments count', () => {
    const { result } = renderHook(() => useCounter())
    act(() => result.current.increment())
    expect(result.current.count).toBe(1)
  })
})
```

## Best Practices

1. **Test behavior, not implementation** - Focus on what users see and do
2. **Use accessible queries** - Prefer `getByRole`, `getByLabelText` over `getByTestId`
3. **Mock at boundaries** - Mock Electron IPC, not internal functions
4. **Keep tests isolated** - Each test should run independently

## End-to-End Tests (Electron + Playwright)

Specs live in `apps/web/src/test/e2e/*.e2e.ts` and drive the built app, so run `bun run build` first.

```bash
bun run test:e2e:smoke                 # the smoke set, invisible window
bun run test:e2e:bg -- my-spec.e2e.ts  # any spec, invisible window
bun run test:e2e                       # visible window
bun run test:e2e:visual:update         # refresh screenshot baselines (macOS)
```

The smoke set is listed in `apps/web/src/test/e2e/smoke-specs.ts`: core workflows, editor API/CLI checks and quick export gates that need no private runtime, real-media fixture or recording permission.

**Fixtures** (`helpers/electron-helpers.ts`):
- Every test gets its own profile directory, a free editor API port and a temporary state directory, exported through `QCUT_API_PORT`, `XDG_STATE_HOME` and `QCUT_E2E_USER_DATA_DIR`. Tests never touch your QCut profile and can run while QCut is open. `startElectronApp()` inside a test relaunches on that test's profile.
- The UI runs in Chinese, QCut's default. A spec that checks English copy opts in with `test.use({ appLocale: "en" })`.
- `isolatedElectronTest` (`helpers/isolated-electron-fixture.ts`) also hands the test its `apiPort` and token for CLI and HTTP API checks.

**Options:**
- `QCUT_E2E_SCREEN_VIDEO=1` records each test as a low-frame-rate video from screenshots (off by default).
- `QCUT_E2E_UPDATE_DOCS_EVIDENCE=1` lets `media-lab-properties` refresh the committed reference images under `docs/task/`; by default its screenshots go to `output/playwright/`.
- Screenshot checks mask content that changes between runs, such as the app version and the project path.

**Type checking:** `bun run check-types` includes `apps/web/tsconfig.e2e.json`, so helpers break the build when the APIs they use change.

**Write assertions, not guards.** Wrapping a check in `if (await locator.isVisible())` turns a missing element into a silent pass. If the element should be there, assert it; if the feature is gone, remove the test.
