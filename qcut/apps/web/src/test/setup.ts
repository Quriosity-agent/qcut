// Test setup file for Vitest - setup DOM first before any other imports
import { JSDOM } from "jsdom";

console.log("Setting up JSDOM environment...");

// Create DOM environment immediately
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: "http://localhost:3000",
  pretendToBeVisual: true,
  resources: "usable"
});

// Set up DOM globals immediately at module level
Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, writable: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true });
Object.defineProperty(globalThis, 'location', { value: dom.window.location, writable: true });
Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, writable: true });
Object.defineProperty(globalThis, 'Element', { value: dom.window.Element, writable: true });
Object.defineProperty(globalThis, 'Node', { value: dom.window.Node, writable: true });

console.log("JSDOM setup complete. Document available:", typeof globalThis.document !== "undefined");

// Test global availability immediately
console.log("Global document test:", typeof document !== "undefined" ? "AVAILABLE" : "NOT AVAILABLE");

// Now that DOM is available, import testing libraries
import "@testing-library/jest-dom/vitest";
import { afterEach, afterAll, beforeAll, vi } from "vitest";

// Load toast hook mock
import { setupToastMock } from "./mocks/toast";
setupToastMock();

// Mock window.matchMedia and window.history for happy-dom environment
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

// Mock window.history for TanStack Router
Object.defineProperty(window, "history", {
  writable: true,
  value: {
    pushState: vi.fn(),
    replaceState: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    go: vi.fn(),
    length: 1,
    scrollRestoration: "auto",
    state: null,
  },
});

// Mock global APIs for happy-dom environment
const makeObserver = () => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
});

// Mock IntersectionObserver
Object.defineProperty(window, "IntersectionObserver", { writable: true, value: vi.fn().mockImplementation(makeObserver) });
Object.defineProperty(globalThis, "IntersectionObserver", { writable: true, value: window.IntersectionObserver });

// Mock ResizeObserver
Object.defineProperty(window, "ResizeObserver", { writable: true, value: vi.fn().mockImplementation(makeObserver) });
Object.defineProperty(globalThis, "ResizeObserver", { writable: true, value: window.ResizeObserver });

// Mock URL methods
Object.defineProperty(URL, "createObjectURL", {
  writable: true,
  value: vi.fn(() => "blob:mock-url"),
});
Object.defineProperty(URL, "revokeObjectURL", {
  writable: true,
  value: vi.fn(),
});

// Mock localStorage (should be available in happy-dom but ensure it's mocked)
const localStorageMock: Storage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  key: vi.fn(),
  length: 0,
};
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// Mock IndexedDB
const indexedDBMock: IDBFactory = {
  open: vi.fn(() => ({}) as IDBOpenDBRequest),
  deleteDatabase: vi.fn(() => ({}) as IDBOpenDBRequest),
  cmp: vi.fn(() => 0),
  databases: vi.fn(async () => [] as IDBDatabaseInfo[]),
};
Object.defineProperty(window, "indexedDB", {
  value: indexedDBMock,
  writable: true,
});

// Mock navigator.clipboard
Object.defineProperty(navigator, "clipboard", {
  value: {
    writeText: vi.fn(() => Promise.resolve()),
    readText: vi.fn(() => Promise.resolve("")),
  },
  writable: true,
});

// Mock window.location methods
Object.defineProperty(window, "location", {
  value: {
    href: "http://localhost:3000",
    origin: "http://localhost:3000",
    reload: vi.fn(),
    assign: vi.fn(),
    replace: vi.fn(),
  },
  writable: true,
});

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
