// Global setup that runs before any test files are loaded
// This ensures browser APIs are available for all modules

import { installAllBrowserMocks } from './mocks/browser-mocks';

// Install all browser mocks on available global contexts
installAllBrowserMocks();

export {};
