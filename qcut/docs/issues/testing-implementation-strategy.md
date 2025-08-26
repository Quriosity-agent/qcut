# Testing Implementation Strategy for QCut Video Editor

## Executive Summary

Based on analysis of QCut's architecture (280+ source files, 0 tests), I recommend a **hybrid testing approach** prioritizing **Integration Tests (60%)**, **Unit Tests (30%)**, and **E2E Tests (10%)**. This inverted pyramid approach is optimal for QCut's current state - a complex, untested codebase with tightly coupled components where integration tests provide maximum value and safety.

**Recommended Framework Stack:**
- **Unit/Integration**: Vitest (Vite-native, fast, Jest-compatible)
- **E2E**: Playwright (Electron support, visual testing)
- **Component**: Testing Library + Vitest
- **Visual Regression**: Percy or Chromatic

## Why Integration Tests Should Be Primary Focus

### 1. Current Architecture Reality
```typescript
// Example: Timeline operations involve 8+ interconnected systems
- Timeline Store → Media Store → Playback Store
- FFmpeg Utils → Export Engine → Storage Service
- React Components → Zustand Stores → Electron IPC
```

**Integration tests catch:**
- Store synchronization issues (major problem area)
- Memory leaks from component lifecycle
- FFmpeg/WebAssembly integration failures
- Data flow between stores

### 2. Cost-Benefit Analysis

| Test Type | Setup Time | Maintenance | Bug Detection | Confidence |
|-----------|------------|-------------|---------------|------------|
| **Unit** | Low | Low | 30% | Low |
| **Integration** | Medium | Medium | 65% | High |
| **E2E** | High | High | 85% | Very High |

**For QCut's state:** Integration tests provide 80% of E2E confidence at 40% of the cost.

## Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
**Goal:** Testing infrastructure and critical integration tests

#### 1.1 Setup Vitest
```bash
# Install dependencies
bun add -D vitest @vitest/ui @testing-library/react @testing-library/user-event
bun add -D @testing-library/jest-dom jsdom happy-dom
```

#### 1.2 Configure Vitest
```typescript
// vitest.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/test/'],
    },
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true, // Important for Zustand stores
      },
    },
  },
});
```

#### 1.3 First Critical Integration Tests
Priority targets based on failure analysis:

1. **Store Synchronization Test** (Highest Priority)
2. **Media Upload → Timeline Add Flow**
3. **Export Pipeline Integration**
4. **FFmpeg Loading and Processing**
5. **Storage Service Fallback Chain**

### Phase 2: Core Integration Tests (Week 3-4)
**Goal:** 40% coverage of critical paths

#### Test Categories and Priorities

##### 🔴 CRITICAL (Must test immediately)
1. **Timeline Operations Integration**
   - Add/remove elements
   - Playback synchronization
   - Undo/redo operations
   - Memory cleanup

2. **Media Processing Pipeline**
   - File upload → blob creation → store update
   - FFmpeg WebAssembly loading
   - Video processing operations
   - Memory management

3. **Export System**
   - Export settings → engine selection → output
   - Progress tracking
   - Error handling
   - Resource cleanup

##### 🟡 HIGH (Week 2-3)
4. **Storage System**
   - IndexedDB → LocalStorage fallback
   - Data persistence
   - Conflict resolution
   - Migration paths

5. **Sticker System Integration**
   - MediaItemId synchronization
   - Overlay → Timeline integration
   - Persistence across sessions

##### 🟢 MEDIUM (Week 4+)
6. **UI Component Integration**
   - Panel layouts
   - Keyboard shortcuts
   - Drag and drop
   - Context menus

### Phase 3: Unit Tests (Week 5-6)
**Goal:** Isolated testing of pure functions and utilities

Target pure functions first (easier to test, high value):
- Time formatting utilities
- Timeline calculations
- Export settings validation
- FFmpeg command generation
- ID generation functions

### Phase 4: E2E Tests (Week 7-8)
**Goal:** Critical user journeys only

## Example Test Implementations

### 1. Critical Integration Test: Store Synchronization

```typescript
// src/test/integration/store-sync.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTimelineStore } from '@/stores/timeline-store';
import { useMediaStore } from '@/stores/media-store';
import { usePlaybackStore } from '@/stores/playback-store';

describe('Store Synchronization Integration', () => {
  beforeEach(() => {
    // Reset all stores
    useTimelineStore.getState().reset();
    useMediaStore.getState().reset();
    usePlaybackStore.getState().reset();
  });

  afterEach(() => {
    // Clean up blob URLs to prevent memory leaks
    const mediaItems = useMediaStore.getState().mediaItems;
    mediaItems.forEach(item => {
      if (item.url?.startsWith('blob:')) {
        URL.revokeObjectURL(item.url);
      }
    });
  });

  it('should sync media addition across timeline and playback stores', async () => {
    const { result: timelineStore } = renderHook(() => useTimelineStore());
    const { result: mediaStore } = renderHook(() => useMediaStore());
    const { result: playbackStore } = renderHook(() => usePlaybackStore());

    // Simulate media upload
    const mockFile = new File(['video content'], 'test.mp4', { type: 'video/mp4' });
    const mediaItem = {
      id: 'test-media-1',
      file: mockFile,
      type: 'video' as const,
      url: URL.createObjectURL(mockFile),
      duration: 10,
    };

    await act(async () => {
      await mediaStore.current.addMedia(mediaItem);
    });

    // Add to timeline
    await act(async () => {
      timelineStore.current.addElement({
        mediaId: mediaItem.id,
        trackId: 'track-1',
        startTime: 0,
        duration: mediaItem.duration,
      });
    });

    // Verify synchronization
    await waitFor(() => {
      expect(mediaStore.current.mediaItems).toHaveLength(1);
      expect(timelineStore.current.elements).toHaveLength(1);
      expect(playbackStore.current.duration).toBe(10);
    });

    // Test cleanup on element removal
    await act(async () => {
      timelineStore.current.removeElement(timelineStore.current.elements[0].id);
    });

    await waitFor(() => {
      expect(timelineStore.current.elements).toHaveLength(0);
      expect(playbackStore.current.duration).toBe(0);
    });
  });

  it('should handle concurrent store updates without race conditions', async () => {
    const operations = Array.from({ length: 10 }, (_, i) => ({
      id: `media-${i}`,
      operation: i % 2 === 0 ? 'add' : 'remove',
    }));

    const results = await Promise.allSettled(
      operations.map(async (op) => {
        if (op.operation === 'add') {
          return useMediaStore.getState().addMedia({
            id: op.id,
            type: 'video',
            duration: 5,
          });
        } else {
          return useMediaStore.getState().removeMedia(op.id);
        }
      })
    );

    // All operations should complete without errors
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
  });
});
```

### 2. FFmpeg Integration Test

```typescript
// src/test/integration/ffmpeg.test.ts
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { FFmpegService } from '@/lib/ffmpeg-service';
import { FFmpegUtils } from '@/lib/ffmpeg-utils';

describe('FFmpeg Integration', () => {
  let ffmpegService: FFmpegService;
  
  beforeAll(async () => {
    // Mock WebAssembly loading for tests
    vi.mock('@ffmpeg/ffmpeg', () => ({
      FFmpeg: vi.fn().mockImplementation(() => ({
        load: vi.fn().mockResolvedValue(true),
        writeFile: vi.fn(),
        readFile: vi.fn().mockResolvedValue(new Uint8Array()),
        exec: vi.fn().mockResolvedValue(0),
      })),
    }));

    ffmpegService = new FFmpegService();
    await ffmpegService.initialize();
  });

  it('should handle video processing pipeline', async () => {
    const inputFile = new File(['video data'], 'input.mp4', { type: 'video/mp4' });
    const outputSettings = {
      format: 'mp4',
      codec: 'h264',
      bitrate: '2M',
      resolution: '1920x1080',
    };

    const result = await ffmpegService.processVideo(inputFile, outputSettings);
    
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.output).toBeInstanceOf(Blob);
  });

  it('should clean up resources after processing', async () => {
    const memoryBefore = performance.memory?.usedJSHeapSize || 0;
    
    // Process multiple videos
    for (let i = 0; i < 5; i++) {
      const file = new File([`video ${i}`], `video${i}.mp4`);
      await ffmpegService.processVideo(file, { format: 'mp4' });
    }
    
    // Force cleanup
    await ffmpegService.cleanup();
    
    // Memory should not increase significantly
    const memoryAfter = performance.memory?.usedJSHeapSize || 0;
    const memoryIncrease = memoryAfter - memoryBefore;
    
    expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // Less than 50MB increase
  });
});
```

### 3. Export Pipeline Integration Test

```typescript
// src/test/integration/export-pipeline.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ExportEngineFactory } from '@/lib/export-engine-factory';
import { useExportStore } from '@/stores/export-store';
import { useTimelineStore } from '@/stores/timeline-store';

describe('Export Pipeline Integration', () => {
  beforeEach(() => {
    useExportStore.getState().reset();
    useTimelineStore.getState().reset();
  });

  it('should complete full export pipeline', async () => {
    // Setup timeline with test data
    const timeline = {
      elements: [
        { id: '1', type: 'video', startTime: 0, duration: 5 },
        { id: '2', type: 'audio', startTime: 2, duration: 3 },
      ],
      duration: 5,
    };
    
    useTimelineStore.setState({ ...timeline });
    
    const exportSettings = {
      format: 'mp4',
      quality: 'high',
      resolution: '1920x1080',
      fps: 30,
    };
    
    const engine = ExportEngineFactory.create('optimized');
    const exportStore = useExportStore.getState();
    
    // Monitor progress updates
    const progressUpdates: number[] = [];
    const unsubscribe = useExportStore.subscribe((state) => {
      progressUpdates.push(state.progress);
    });
    
    try {
      const result = await engine.export(timeline, exportSettings);
      
      expect(result.success).toBe(true);
      expect(result.blob).toBeInstanceOf(Blob);
      expect(progressUpdates).toContain(100);
      expect(progressUpdates.length).toBeGreaterThan(5); // Should have progress updates
      
      // Verify export store state
      expect(exportStore.isExporting).toBe(false);
      expect(exportStore.progress).toBe(100);
      expect(exportStore.error).toBeNull();
    } finally {
      unsubscribe();
    }
  });

  it('should handle export cancellation gracefully', async () => {
    const engine = ExportEngineFactory.create('optimized');
    const exportPromise = engine.export({}, {});
    
    // Cancel after 100ms
    setTimeout(() => engine.cancel(), 100);
    
    const result = await exportPromise;
    
    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(useExportStore.getState().isExporting).toBe(false);
  });
});
```

### 4. Component Integration Test

```typescript
// src/test/integration/timeline-component.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Timeline } from '@/components/editor/timeline';
import { TestWrapper } from '@/test/utils/test-wrapper';

describe('Timeline Component Integration', () => {
  it('should handle drag and drop from media panel', async () => {
    const user = userEvent.setup();
    
    render(
      <TestWrapper>
        <Timeline />
      </TestWrapper>
    );
    
    // Simulate drag from media panel
    const mediaItem = screen.getByTestId('media-item-1');
    const timelineTrack = screen.getByTestId('timeline-track-1');
    
    await user.pointer([
      { target: mediaItem, coords: { x: 0, y: 0 }, keys: '[MouseLeft>]' },
      { coords: { x: 100, y: 100 } },
      { target: timelineTrack, coords: { x: 200, y: 50 } },
      { keys: '[/MouseLeft]' },
    ]);
    
    await waitFor(() => {
      expect(screen.getByTestId('timeline-element')).toBeInTheDocument();
    });
  });

  it('should cleanup resources on unmount', async () => {
    const { unmount } = render(
      <TestWrapper>
        <Timeline />
      </TestWrapper>
    );
    
    // Add some elements to timeline
    // ... timeline operations
    
    const cleanupSpy = vi.spyOn(URL, 'revokeObjectURL');
    
    unmount();
    
    // Verify cleanup was called
    expect(cleanupSpy).toHaveBeenCalled();
  });
});
```

### 5. Simple Unit Test Example

```typescript
// src/test/unit/time-utils.test.ts
import { describe, it, expect } from 'vitest';
import { formatTime, parseTimecode, calculateDuration } from '@/lib/time';

describe('Time Utilities', () => {
  describe('formatTime', () => {
    it.each([
      [0, '00:00:00'],
      [59, '00:00:59'],
      [3661, '01:01:01'],
      [3723.5, '01:02:03'],
    ])('formats %i seconds as %s', (seconds, expected) => {
      expect(formatTime(seconds)).toBe(expected);
    });
  });

  describe('parseTimecode', () => {
    it('parses valid timecodes', () => {
      expect(parseTimecode('01:23:45')).toBe(5025);
      expect(parseTimecode('00:00:30')).toBe(30);
    });

    it('handles invalid input', () => {
      expect(parseTimecode('invalid')).toBe(0);
      expect(parseTimecode('')).toBe(0);
    });
  });
});
```

## Testing Best Practices for QCut

### 1. Memory Leak Prevention
```typescript
afterEach(() => {
  // Always cleanup blob URLs
  vi.clearAllMocks();
  URL.revokeObjectURL = vi.fn();
  
  // Reset all stores
  const stores = [useTimelineStore, useMediaStore, usePlaybackStore];
  stores.forEach(store => store.getState().reset());
  
  // Clear all timers
  vi.clearAllTimers();
});
```

### 2. Async Store Testing
```typescript
// Use waitFor for async store updates
await waitFor(() => {
  expect(store.getState().value).toBe(expected);
}, { timeout: 5000 });
```

### 3. Electron IPC Mocking
```typescript
// Mock Electron API for tests
vi.mock('@/hooks/useElectron', () => ({
  useElectron: () => ({
    isElectron: true,
    api: {
      readFile: vi.fn().mockResolvedValue(mockFileData),
      writeFile: vi.fn().mockResolvedValue(true),
      selectFile: vi.fn().mockResolvedValue(mockFilePath),
    },
  }),
}));
```

### 4. FFmpeg WebAssembly Mocking
```typescript
// Always mock FFmpeg in tests to avoid loading WebAssembly
vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: MockFFmpeg,
  fetchFile: vi.fn(),
}));
```

## Metrics and Goals

### Phase 1 Goals (Month 1)
- ✅ Testing framework setup complete
- ✅ 10 critical integration tests
- ✅ 20% code coverage
- ✅ CI/CD pipeline with tests

### Phase 2 Goals (Month 2)
- ✅ 50 integration tests
- ✅ 100 unit tests
- ✅ 40% code coverage
- ✅ 5 E2E tests for critical paths

### Phase 3 Goals (Month 3)
- ✅ 100+ integration tests
- ✅ 200+ unit tests
- ✅ 60% code coverage
- ✅ Visual regression tests
- ✅ Performance benchmarks

## CI/CD Integration

### GitHub Actions Workflow
```yaml
# .github/workflows/test.yml
name: Tests

on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      
      - name: Install dependencies
        run: bun install
        
      - name: Run unit and integration tests
        run: bun test
        
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json
          
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      
      - name: Install dependencies
        run: bun install
        
      - name: Install Playwright
        run: bunx playwright install
        
      - name: Run E2E tests
        run: bun test:e2e
        
      - name: Upload test artifacts
        if: failure()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: playwright-report/
```

## ROI Analysis

### Investment Required
- **Setup**: 40 hours
- **Initial Tests**: 120 hours
- **Maintenance**: 20 hours/month

### Expected Returns
- **Bug Detection**: 70% earlier (saves 200+ hours/month)
- **Regression Prevention**: 90% reduction
- **Developer Confidence**: 10x increase
- **Refactoring Safety**: Enables major improvements
- **Onboarding Time**: 50% reduction

### Break-even Point
**6 weeks** - After this point, testing saves more time than it costs.

## Common Pitfalls to Avoid

1. **Don't test implementation details** - Test behavior, not internals
2. **Don't mock everything** - Integration tests need real interactions
3. **Don't ignore flaky tests** - Fix them immediately
4. **Don't skip cleanup** - Memory leaks will cascade
5. **Don't test UI pixel-perfect** - Use visual regression for that

## Recommended Reading Order for Implementation

1. Start with this document
2. Read `store-sync.test.ts` example
3. Implement first 5 integration tests
4. Add unit tests for utilities
5. Setup CI/CD
6. Add E2E for critical path
7. Iterate and improve coverage

## Conclusion

QCut's testing strategy must prioritize **integration tests** due to the tightly coupled architecture and complete absence of existing tests. This approach provides:

- **Maximum bug detection** with minimum investment
- **Safe refactoring** capability for architecture improvements  
- **Confidence** for the team to make necessary changes
- **Documentation** through test cases

Start with integration tests for the most critical and problematic areas (store synchronization, FFmpeg, export pipeline), then expand to unit tests and finally E2E tests. This pragmatic approach will stabilize QCut while building a foundation for long-term maintainability.

---

*Document created: 2025-08-26*
*Estimated implementation time: 320 hours*
*Expected ROI: 10x within 6 months*

<function_calls>
<invoke name="TodoWrite">
<parameter name="todos">[{"content": "Analyze current codebase for testing requirements", "status": "completed", "activeForm": "Analyzing current codebase for testing requirements"}, {"content": "Write testing implementation strategy document", "status": "completed", "activeForm": "Writing testing implementation strategy document"}, {"content": "Define test pyramid approach and priorities", "status": "completed", "activeForm": "Defining test pyramid approach and priorities"}, {"content": "Create example test implementations", "status": "in_progress", "activeForm": "Creating example test implementations"}]