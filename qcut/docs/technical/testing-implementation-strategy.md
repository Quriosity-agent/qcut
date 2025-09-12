# QCut Testing Implementation Strategy

**Document Version**: 3.0  
**Last Updated**: 2025-01-12  
**Status**: Phase 0-3 ✅ COMPLETED | Phase 4 (E2E) 📅 PLANNED | 60+ test files implemented  
**Test Suite Health**: ✅ 100% PASS RATE

## Current Implementation Status

### ✅ What's Already Working

The testing infrastructure has been successfully implemented with:
- **Test Runner**: Vitest 3.2.4 with UI visualization
- **React Testing**: @testing-library/react 16.3.0 with user-event
- **Environment**: JSDOM with comprehensive browser API mocks
- **Coverage Reporting**: @vitest/coverage-v8 configured
- **Mock Infrastructure**: Complete mocks for Electron, FFmpeg, storage, router
- **Test Utilities**: Store helpers, render wrappers, cleanup utilities
- **Memory Management**: Blob manager cleanup and performance monitoring
- **Browser API Support**: MutationObserver, ResizeObserver, IntersectionObserver mocks

### ✅ Completed Test Suites (60+ test files - 100% PASSING)

#### Component Tests (10 files)
- ✅ Button component - variants, states, events
- ✅ Checkbox component - checked states, controlled
- ✅ Dialog component - lifecycle, content rendering
- ✅ Dropdown Menu - trigger, items, selection
- ✅ Input component - types, validation, controlled
- ✅ Progress component - value, indeterminate states
- ✅ Slider component - range, steps, controlled
- ✅ Tabs component - tab switching, content
- ✅ Toast component - variants, actions, dismissal

#### Hook Tests (7 files)
- ✅ useDebounce - basic and advanced variations
- ✅ useDebounceCallback - callback debouncing
- ✅ useMobile - responsive detection
- ✅ useAspectRatio - basic and advanced ratio calculations
- ✅ useToast - basic and advanced notification hooks

#### Utility Tests (8 files)
- ✅ Time formatting - formatTimeCode, parseTimeCode
- ✅ UUID generation - generateUUID, generateFileBasedId
- ✅ Platform detection - OS detection and key mapping
- ✅ Memory utils - file size formatting
- ✅ Timeline calculations - overlap detection
- ✅ Image utils - dimension calculations
- ✅ Asset paths - Electron vs web path resolution
- ✅ Error handling - error capture and reporting

#### Store Tests (3 files)
- ✅ Media store - file management operations
- ✅ Timeline store - track and element operations
- ✅ Export store - settings validation

#### Integration Tests (11 files)
- ✅ Store initialization - all stores setup
- ✅ Media addition workflow - file upload process
- ✅ Timeline element creation - element manipulation
- ✅ Export settings - configuration validation
- ✅ Storage mock verification - persistence layer
- ✅ Playback state management - play/pause/seek
- ✅ Keybinding registration - shortcut handling
- ✅ Project creation - new project workflow
- ✅ Sticker overlay addition - sticker management
- ✅ Integration suite runner - full test execution

#### Migration Tests (5 files)
- ✅ Router verification - TanStack Router migration
- ✅ Navigation tests - routing functionality
- ✅ Post-cleanup tests - migration cleanup
- ✅ Sounds API - audio integration
- ✅ Transcription API - subtitle generation

### 🚀 How to Run Tests

⚠️ **CRITICAL**: Do NOT use `bun test` directly - it bypasses Vitest configuration!

```bash
# CORRECT ways to run tests:
cd apps/web

# Run all tests with Vitest
npx vitest run

# Run tests with UI (recommended for development)
npx vitest --ui

# Run tests with coverage report
npx vitest run --coverage

# Run tests in watch mode
npx vitest --watch

# Run specific test file
npx vitest run button.test.tsx

# Using configured npm scripts (also works):
bun run test       # Calls vitest internally
bun run test:ui    # Calls vitest --ui
bun run test:coverage
```

### ❌ Common Mistake
```bash
# WRONG - This will fail with "document is not defined"
bun test

# WHY IT FAILS:
# - Bun's native test runner doesn't use vitest.config.ts
# - No JSDOM environment setup
# - Missing browser API mocks
# - Different module resolution
```

### 📁 Test File Organization

```
qcut/apps/web/src/test/
├── fixtures/           # ✅ Test data and mock objects
├── mocks/              # ✅ External service mocks
├── utils/              # ✅ Test utilities and helpers
├── integration/        # 🔄 Integration test suites
├── unit/              # 🔄 Unit test suites
├── e2e/               # 📅 End-to-end test suites
└── setup.ts           # ✅ Global test configuration
```

## Executive Summary

QCut's testing strategy breaks down implementation into **150+ micro-tasks**, each completable in under 10 minutes without breaking existing functionality. The approach is:

- ✅ **Non-Breaking**: Each task is isolated and additive
- ✅ **Zero Risk**: No production code modification required
- ✅ **Immediate Value**: Each task provides testing capability
- ✅ **Incremental**: Build confidence with each test added

## Technology Stack

### Core Testing Stack (Already Installed)
- **Vitest 3.2.4**: Vite-native test runner (10x faster than Jest)
- **@testing-library/react 16.3.0**: Component testing
- **JSDOM**: DOM environment with full browser API support
- **@vitest/coverage-v8**: Code coverage reporting
- **@playwright/test 1.48.2**: E2E testing (Chromium for Electron) - Ready for Phase 4

### QCut Architecture Context
- **Hybrid Stack**: Vite + TanStack Router + Electron
- **State Management**: Zustand stores (media, timeline, project, playback, export)
- **Video Processing**: FFmpeg WebAssembly
- **Storage**: Multi-tier (Electron IPC → IndexedDB → localStorage)
- **UI Components**: Radix UI + Tailwind CSS

## Implementation Roadmap

### ✅ Phase 0: Setup & Configuration (COMPLETED)
- Core testing dependencies installed
- Test configuration files created
- Mock infrastructure established
- Test utilities implemented
- Directory structure organized

### ✅ Phase 1: First Tests (COMPLETED - 15 files)
**Completed Areas:**
1. **Utility Function Tests** ✅
   - Time formatting functions
   - UUID generation
   - Platform detection
   - Memory utilities
   - Timeline calculations
   - Image and asset utilities

2. **Hook Tests** ✅
   - Debounce variations
   - Mobile detection
   - Toast notifications
   - Aspect ratio calculations

### ✅ Phase 2: Integration Tests (COMPLETED - 11 files)
- Store test helpers and wrappers ✅
- Component test utilities ✅
- Workflow integration tests ✅
- Memory leak detection ✅

### ✅ Phase 3: Component Tests (COMPLETED - 100% PASS RATE)
- ✅ UI component coverage (10+ components tested)
- ✅ Browser API mocks (MutationObserver, ResizeObserver fixed)
- ✅ Complex UI components (Radix UI Dialog, Dropdown, etc.)
- ✅ All tests passing with proper JSDOM setup
- 🔄 Editor component testing (timeline, preview) - Next priority

### 📅 Phase 4: E2E Testing & Advanced Features (Next Priority)
**E2E Test Roadmap**: See `docs/issues/e2e_test/top-5-e2e-tests-priority.md`

**Priority E2E Tests:**
1. 🎬 Complete Video Project Workflow
2. 📁 Multi-Media Import and Timeline Management  
3. 🎨 Sticker and Text Overlay System
4. 🤖 AI Features Integration
5. 🔄 Cross-Platform File Handling

**Advanced Features:**
- Performance testing with large files
- Visual regression testing
- CI/CD integration
- Coverage optimization (target 80%+)

## Priority Testing Areas

### 1. Critical Business Logic
- Media processing workflows
- Timeline operations
- Export functionality
- Project persistence

### 2. User-Facing Components
- Timeline editor
- Media browser
- Preview canvas
- Export dialog

### 3. State Management
- Store actions and reducers
- Store synchronization
- Error state handling

### 4. Memory Management
- Blob URL lifecycle
- FFmpeg memory usage
- Large file handling
- Resource cleanup

## Coverage Goals

### Target Metrics
- **Statements**: 80%+
- **Branches**: 75%+
- **Functions**: 85%+
- **Lines**: 80%+

### Current Coverage
Run `bun test:coverage` to see current metrics.

## Store Testing Strategy

### Core Stores to Test
1. **Media Store**: File management, thumbnails
2. **Timeline Store**: Track management, history
3. **Project Store**: Lifecycle, persistence
4. **Playback Store**: Video playback state
5. **Export Store**: Settings, progress tracking

### Testing Approach
- Isolate each test with store resets
- Use realistic fixtures
- Test complete workflows
- Verify error handling
- Monitor performance

## Memory Management Testing

### Critical Areas
- **Blob URL Management**: Automatic cleanup between tests
- **FFmpeg WebAssembly**: Memory pressure simulation
- **Large Files**: Handling and cleanup
- **Performance Monitoring**: Memory leak detection

## Known Issues & Solutions

### ⚠️ Test Runner Compatibility

**Issue**: Using `bun test` directly fails with "document is not defined"

**Root Cause**: 
- Bun's native test runner doesn't read `vitest.config.ts`
- No JSDOM environment setup
- Missing browser API polyfills

**Solution**: Always use `npx vitest run` or configured npm scripts

**Fixed Issues**:
- ✅ MutationObserver not defined (Radix UI components)
- ✅ ResizeObserver missing (responsive components)
- ✅ getComputedStyle polyfills
- ✅ All browser API mocks working

## Quick Reference

### Writing a New Test

```typescript
// Example component test
import { render, screen } from '@testing-library/react';
import { TestWrapper } from '@/test/utils/test-wrapper';

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(
      <TestWrapper>
        <MyComponent />
      </TestWrapper>
    );
    
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });
});
```

### Using Store Mocks

```typescript
import { resetAllStores } from '@/test/utils/store-helpers';

beforeEach(() => {
  resetAllStores(); // Clean slate for each test
});
```

### Common Test Patterns

```typescript
// Async operations
import { waitFor } from '@testing-library/react';

await waitFor(() => {
  expect(screen.getByText('Loaded')).toBeInTheDocument();
});

// User interactions
import userEvent from '@testing-library/user-event';

const user = userEvent.setup();
await user.click(screen.getByRole('button'));
```

## CI/CD Integration (Planned)

### Automated Pipeline Goals
1. Pre-commit hooks for linting
2. PR validation with full test suite
3. Coverage reporting and tracking
4. Performance regression detection
5. Cross-platform E2E testing

## Risk Mitigation

### Zero-Risk Implementation
- All tests are new files only
- No production code changes required
- Tests can be deleted to rollback
- Optional execution during development

### Quality Assurance
- Code review for all tests
- Clear documentation
- Regular maintenance
- Performance monitoring

## Next Steps

### Immediate Actions (Phase 3 - Editor Components)
1. Timeline editor component tests
2. Media browser component tests
3. Preview canvas component tests
4. Property panel tests
5. Context menu tests

### Areas Needing Tests
1. **Editor Components** (High Priority)
   - Timeline manipulation UI
   - Media selection interface
   - Preview controls
   - Export dialog
   
2. **Complex Workflows** (Medium Priority)
   - Multi-track timeline editing
   - Video export process
   - Project save/load cycle
   - Undo/redo system

3. **Performance Tests** (Future)
   - Large file handling
   - Memory leak detection
   - Timeline with many elements

### For Contributors
1. Check existing tests before writing new ones
2. Follow established patterns in test/utils
3. Use fixtures for consistent test data
4. Clean up resources in afterEach blocks
5. Focus on editor components for maximum impact

## Success Metrics

### Quantitative
- Each task < 10 minutes
- Incremental coverage improvement
- No production build impact
- Fast CI/CD feedback

### Qualitative
- Easy test maintenance
- Refactoring confidence
- Early bug detection
- Tests as documentation

## Detailed Implementation Phases

### Phase 1: First Tests (Detailed Breakdown)

#### Utility Function Tests Priority List
1. `formatTimeCode()` - Time display formatting
2. `parseTimeCode()` - Time string parsing
3. `generateUUID()` - Unique ID generation
4. `generateFileBasedId()` - File-based IDs
5. `detectPlatform()` - OS detection
6. `formatFileSize()` - Memory formatting
7. `calculateOverlap()` - Timeline overlaps
8. `useDebounce()` - Debounce hook
9. `useAspectRatio()` - Ratio calculations
10. `useToast()` - Notification hook

### Phase 2: Integration Test Infrastructure

#### Store Test Helpers Implementation
- Individual store reset utilities
- Combined store reset functionality
- Store snapshot utilities
- Test fixture factories
- State transition testing

#### Component Test Helpers
- Render with providers
- Element waiting utilities
- Event simulation helpers
- Drag and drop testing
- Media upload simulation

### Phase 3: Component Tests

#### UI Component Priority
1. Button variants and states
2. Input validation and types
3. Dialog lifecycle
4. Dropdown interactions
5. Slider controls
6. Form submissions
7. Loading states
8. Error boundaries
9. Accessibility compliance
10. Theme switching

#### Editor Component Priority
1. Timeline manipulation
2. Media selection
3. Preview controls
4. Export configuration
5. Sticker positioning
6. Text editing
7. Audio waveforms
8. Keyboard shortcuts
9. Undo/redo system
10. Project management

### Phase 4: Advanced Testing & CI/CD

#### Performance Testing Focus
- Memory leak detection
- Large file handling
- Timeline performance
- Export stress testing
- WebAssembly management

#### E2E Testing Scenarios
- Complete project workflow
- Multi-format exports
- Cross-platform compatibility
- Error recovery
- Visual regression

---

**For questions or issues**: Create an issue in the repository or consult the team lead.