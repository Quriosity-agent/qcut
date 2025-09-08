// Global setup that runs before any test files are loaded
// This ensures MutationObserver is available for all modules

// MutationObserver polyfill for JSDOM
if (typeof global !== "undefined" && !global.MutationObserver) {
  class MockMutationObserver {
    constructor(callback: MutationCallback) {}
    observe(target: Node, options?: MutationObserverInit) {}
    unobserve(target: Node) {}
    disconnect() {}
    takeRecords(): MutationRecord[] { return []; }
  }
  
  (global as any).MutationObserver = MockMutationObserver;
}

// Also set on globalThis for consistency
if (typeof globalThis !== "undefined" && !globalThis.MutationObserver) {
  (globalThis as any).MutationObserver = (global as any).MutationObserver;
}

// And on window if it exists
if (typeof window !== "undefined" && !window.MutationObserver) {
  (window as any).MutationObserver = (global as any).MutationObserver;
}

export {};
