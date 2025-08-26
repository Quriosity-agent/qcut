import { vi } from 'vitest';

/**
 * Mock performance APIs for testing
 */
export const mockPerformance = {
  now: vi.fn(() => Date.now()),
  mark: vi.fn((name: string) => undefined),
  measure: vi.fn((name: string, startMark?: string, endMark?: string) => undefined),
  clearMarks: vi.fn((name?: string) => undefined),
  clearMeasures: vi.fn((name?: string) => undefined),
  getEntries: vi.fn(() => []),
  getEntriesByName: vi.fn((name: string) => []),
  getEntriesByType: vi.fn((type: string) => []),
  
  // Memory monitoring (Chrome/Edge only)
  memory: {
    usedJSHeapSize: 100000000,  // 100MB
    totalJSHeapSize: 200000000, // 200MB
    jsHeapSizeLimit: 500000000, // 500MB limit
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
  Object.defineProperty(global, 'performance', {
    value: mockPerformance,
    writable: true,
    configurable: true,
  });
  
  // Mock PerformanceObserver
  (global as any).PerformanceObserver = MockPerformanceObserver;
  
  return () => {
    // Restore original performance
    delete (global as any).performance;
    delete (global as any).PerformanceObserver;
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
  mockPerformance.memory.usedJSHeapSize = Math.floor(limit * (usagePercent / 100));
  mockPerformance.memory.totalJSHeapSize = Math.floor(limit * 0.8);
}