/**
 * Shared browser API mocks for test environment
 * Provides consistent implementations across all test files
 */

// MutationObserver mock implementation
export class MockMutationObserver implements MutationObserver {
  constructor(_callback: MutationCallback) {}
  observe(_target: Node, _options?: MutationObserverInit) {}
  disconnect() {}
  takeRecords(): MutationRecord[] { return []; }
}

// ResizeObserver mock implementation
export class MockResizeObserver implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}
  observe(_target: Element, _options?: ResizeObserverOptions) {}
  unobserve(_target: Element) {}
  disconnect() {}
}

// IntersectionObserver mock implementation
export class MockIntersectionObserver implements IntersectionObserver {
  root: Element | Document | null = null;
  rootMargin: string = '0px';
  thresholds: ReadonlyArray<number> = [0];
  
  constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}
  observe(_target: Element) {}
  unobserve(_target: Element) {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

// Helper function to install all mocks on a global context
export function installBrowserMocks(context: any) {
  if (!context) return;
  
  // Force override using Object.defineProperty for better compatibility
  // This ensures we override JSDOM's native implementation
  try {
    Object.defineProperty(context, 'MutationObserver', {
      value: MockMutationObserver,
      writable: true,
      configurable: true,
      enumerable: true
    });
  } catch (e) {
    // Fallback to direct assignment if defineProperty fails
    context.MutationObserver = MockMutationObserver;
  }
  
  try {
    Object.defineProperty(context, 'ResizeObserver', {
      value: MockResizeObserver,
      writable: true,
      configurable: true,
      enumerable: true
    });
  } catch (e) {
    context.ResizeObserver = MockResizeObserver;
  }
  
  try {
    Object.defineProperty(context, 'IntersectionObserver', {
      value: MockIntersectionObserver,
      writable: true,
      configurable: true,
      enumerable: true
    });
  } catch (e) {
    context.IntersectionObserver = MockIntersectionObserver;
  }
}

// Install mocks on all available global contexts
export function installAllBrowserMocks() {
  const contexts = [
    typeof globalThis !== 'undefined' ? globalThis : null,
    typeof global !== 'undefined' ? global : null,
    typeof window !== 'undefined' ? window : null,
    typeof self !== 'undefined' ? self : null,
  ].filter(Boolean);
  
  contexts.forEach(ctx => installBrowserMocks(ctx));
}