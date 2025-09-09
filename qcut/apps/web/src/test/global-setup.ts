// Global setup that runs before any test files are loaded
// This ensures browser APIs are available for all modules

import { installAllBrowserMocks } from './mocks/browser-mocks';

export function setup() {
  // Install all browser mocks on available global contexts
  installAllBrowserMocks();
  console.log('✓ Global setup: Browser mocks installed');
}

export function teardown() {
  // Cleanup if needed
}
