// Global setup that runs before any test files are loaded
// This ensures browser APIs are available for all modules

import { installAllBrowserMocks, MockMutationObserver } from './mocks/browser-mocks';

export function setup() {
  // Install all browser mocks on available global contexts
  installAllBrowserMocks();
  
  // Aggressively ensure MutationObserver is available everywhere
  const contexts = [globalThis, global, window, self].filter(ctx => 
    ctx && typeof ctx === 'object'
  );
  
  for (const ctx of contexts) {
    try {
      if ((ctx as any).MutationObserver !== MockMutationObserver) {
        (ctx as any).MutationObserver = MockMutationObserver;
        console.log(`✓ Forced MutationObserver override on ${ctx.constructor.name || 'context'}`);
      }
    } catch (e) {
      // Continue with other contexts
    }
  }
  
  console.log('✓ Global setup: Browser mocks installed and verified');
  console.log('✓ MutationObserver available:', typeof globalThis.MutationObserver === 'function');
}

export function teardown() {
  // Cleanup if needed
}
