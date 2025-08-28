// Test setup file for Vitest
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, afterAll, vi } from "vitest";

// Load toast hook mock
import { setupToastMock } from "./mocks/toast";
setupToastMock();

// Mock window.matchMedia - ensure window exists first
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Mock global APIs - check for existence first
if (typeof global !== "undefined") {
  // Mock IntersectionObserver
  global.IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));

  // Mock ResizeObserver
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));

  // Mock URL.createObjectURL and revokeObjectURL
  if (global.URL) {
    global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
    global.URL.revokeObjectURL = vi.fn();
  }

  // Mock localStorage
  const localStorageMock: Storage = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(),
    length: 0,
  };
  global.localStorage = localStorageMock;

  // Mock IndexedDB
  const indexedDBMock: IDBFactory = {
    // Return minimal shaped requests; expand if tests need more
    open: vi.fn(() => ({}) as IDBOpenDBRequest),
    deleteDatabase: vi.fn(() => ({}) as IDBOpenDBRequest),
    cmp: vi.fn(() => 0),
    // Some TS lib.dom versions include `databases`; stub defensively
    databases: vi.fn(async () => [] as IDBDatabaseInfo[]),
  };
  global.indexedDB = indexedDBMock;
}

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks();
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
});

// Setup before all tests
beforeAll(() => {
  // Suppress console errors in tests unless explicitly testing error handling
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

// Cleanup after all tests
afterAll(() => {
  vi.restoreAllMocks();
});
