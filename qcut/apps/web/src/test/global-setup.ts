// Global setup that runs before any test files are loaded
// Note: This runs in Node context, not in the test environment
// DOM-related setup should be in setupFiles, not globalSetup

export function setup() {
  console.log("✓ Global setup: Starting test suite");
  // Global setup runs in Node context, so we can't access DOM/window here
  // All DOM-related setup should be in the setupFiles instead
}

export function teardown() {
  console.log("✓ Global teardown: Test suite complete");
  // Cleanup if needed
}
