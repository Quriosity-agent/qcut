/**
 * Shared browser API mocks for test environment
 * Provides consistent implementations across all test files
 */

// Type definitions for observer constructors
type MutationObserverCtor = new (callback: MutationCallback) => MutationObserver;
type ResizeObserverCtor = new (callback: ResizeObserverCallback) => ResizeObserver;
type IntersectionObserverCtor = new (callback: IntersectionObserverCallback, options?: IntersectionObserverInit) => IntersectionObserver;

// Host context for installing observers
type ObserverHost = Partial<{
  MutationObserver: MutationObserverCtor;
  ResizeObserver: ResizeObserverCtor;
  IntersectionObserver: IntersectionObserverCtor;
}> & object;

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
  readonly root: Element | Document | null = null;
  readonly rootMargin = '0px';
  readonly thresholds: ReadonlyArray<number> = [0];
  
  constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}
  observe(_target: Element) {}
  unobserve(_target: Element) {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

// Helper function to install all mocks on a global context
export function installBrowserMocks(context: ObserverHost | null | undefined): void {
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
// Prioritizes globalThis first, then mirrors to other contexts only if needed
export function installAllBrowserMocks() {
  // Install on globalThis first (the modern standard)
  if (typeof globalThis !== 'undefined') {
    installBrowserMocks(globalThis);
    
    // Mirror to window if it exists and is missing the observers
    if (typeof window !== 'undefined' && window !== globalThis) {
      if (!window.MutationObserver) {
        window.MutationObserver = globalThis.MutationObserver;
      }
      if (!window.ResizeObserver) {
        window.ResizeObserver = globalThis.ResizeObserver;
      }
      if (!window.IntersectionObserver) {
        window.IntersectionObserver = globalThis.IntersectionObserver;
      }
    }
    
    // Mirror to global if it exists and is missing the observers
    if (typeof global !== 'undefined' && global !== globalThis) {
      if (!global.MutationObserver) {
        (global as any).MutationObserver = globalThis.MutationObserver;
      }
      if (!global.ResizeObserver) {
        (global as any).ResizeObserver = globalThis.ResizeObserver;
      }
      if (!global.IntersectionObserver) {
        (global as any).IntersectionObserver = globalThis.IntersectionObserver;
      }
    }
  } else {
    // Fallback: Install on whatever contexts are available
    const contexts = [
      typeof global !== 'undefined' ? global : null,
      typeof window !== 'undefined' ? window : null,
      typeof self !== 'undefined' ? self : null,
    ].filter(Boolean);
    
    contexts.forEach(ctx => installBrowserMocks(ctx));
  }
}