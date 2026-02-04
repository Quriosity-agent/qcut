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
