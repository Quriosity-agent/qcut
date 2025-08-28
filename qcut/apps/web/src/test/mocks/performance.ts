import { vi } from "vitest";

/**
 * Mock performance APIs for testing
 */
export const mockPerformance = {
  now: vi.fn(() => Date.now()),
  mark: vi.fn((name: string) => {}),
  measure: vi.fn((name: string, startMark?: string, endMark?: string) => {}),
  clearMarks: vi.fn((name?: string) => {}),
  clearMeasures: vi.fn((name?: string) => {}),
  getEntries: vi.fn(() => []),
  getEntriesByName: vi.fn((name: string) => []),
  getEntriesByType: vi.fn((type: string) => []),

  // Memory monitoring (Chrome/Edge only)
  memory: {
    usedJSHeapSize: 100_000_000, // 100MB
    totalJSHeapSize: 200_000_000, // 200MB
    jsHeapSizeLimit: 500_000_000, // 500MB limit
  },
};

/**
 * Create performance observer mock
 */
export class MockPerformanceObserver {
  callback: PerformanceObserverCallback;

  constructor(callback: PerformanceObserverCallback) {
    this.callback = callback;
  }

  observe = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
}

/**
 * Setup performance mocks
 */
export function setupPerformanceMocks() {
  // Override performance object
  Object.defineProperty(global, "performance", {
    value: mockPerformance,
    writable: true,
    configurable: true,
  });

  // Mock PerformanceObserver
  (global as any).PerformanceObserver = MockPerformanceObserver;

  return () => {
    // Restore original performance
    (global as any).performance = undefined;
    (global as any).PerformanceObserver = undefined;
  };
}

/**
 * Helper to track memory usage in tests
 */
export function getMemoryUsage() {
  return mockPerformance.memory.usedJSHeapSize;
}

/**
 * Helper to simulate memory pressure
 */
export function simulateMemoryPressure(usagePercent: number) {
  const limit = mockPerformance.memory.jsHeapSizeLimit;
  mockPerformance.memory.usedJSHeapSize = Math.floor(
    limit * (usagePercent / 100)
  );
  mockPerformance.memory.totalJSHeapSize = Math.floor(limit * 0.8);
}
