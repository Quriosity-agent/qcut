// Test setup file for Vitest - enhanced DOM setup for jsdom
console.log("🔧 SETUP.TS EXECUTING - Starting jsdom environment setup...");

// CRITICAL: Set up getComputedStyle IMMEDIATELY as a robust polyfill
// This polyfill must be bulletproof and work across all contexts
const createComputedStylePolyfill = () => {
  const mockGetComputedStyle = (element: Element): CSSStyleDeclaration => {
    const styles: any = {
      // Core methods
      getPropertyValue: (prop: string) => {
        // Handle common properties that Radix UI might check
        const mappings: Record<string, string> = {
          'display': 'block',
          'visibility': 'visible',
          'opacity': '1',
          'transform': 'none',
          'transition': 'none',
          'animation': 'none',
          'position': 'static',
          'top': 'auto',
          'left': 'auto',
          'right': 'auto',
          'bottom': 'auto',
          'width': 'auto',
          'height': 'auto',
          'margin': '0px',
          'padding': '0px',
          'border': '0px',
          'background': 'transparent'
        };
        return mappings[prop] || "";
      },
      setProperty: () => {},
      removeProperty: () => "",
      item: (index: number) => "",
      
      // Common properties
      length: 0,
      parentRule: null,
      cssFloat: "",
      cssText: "",
      
      // Layout properties
      display: "block",
      visibility: "visible", 
      opacity: "1",
      transform: "none",
      transition: "none",
      animation: "none",
      position: "static",
      top: "auto",
      left: "auto",
      right: "auto",
      bottom: "auto",
      width: "auto",
      height: "auto"
    };
    
    // Make it iterable
    Object.defineProperty(styles, Symbol.iterator, {
      value: function* () {
        for (let i = 0; i < this.length; i++) {
          yield this.item(i);
        }
      }
    });
    
    return styles as CSSStyleDeclaration;
  };
  
  return mockGetComputedStyle;
};

const mockGetComputedStyle = createComputedStylePolyfill();

// Apply polyfill to ALL possible global contexts
const globalContexts = [globalThis, window, global].filter(Boolean);

globalContexts.forEach(context => {
  if (context && typeof context === 'object') {
    Object.defineProperty(context, "getComputedStyle", {
      value: mockGetComputedStyle,
      writable: true,
      configurable: true,
    });
  }
});

// Special handling for when window becomes available later
if (typeof window === "undefined") {
  // Set up a proxy that will work when window becomes available
  (globalThis as any).getComputedStyle = mockGetComputedStyle;
} else {
  // Window is available, set up everything
  window.getComputedStyle = mockGetComputedStyle;
  (globalThis as any).getComputedStyle = mockGetComputedStyle;
  (globalThis as any).document = window.document;
  (globalThis as any).window = window;
}

console.log(
  "🔧 Initial DOM check - document available:",
  typeof document !== "undefined"
);
console.log(
  "🔧 Initial DOM check - window available:",
  typeof window !== "undefined"
);
console.log(
  "🔧 getComputedStyle now available:",
  typeof getComputedStyle !== "undefined"
);

console.log(
  "🔧 SETUP.TS COMPLETE - Document available:",
  typeof document !== "undefined"
);
console.log(
  "🔧 SETUP.TS COMPLETE - getComputedStyle available:",
  typeof getComputedStyle !== "undefined"
);
console.log("🔧 SETUP.TS COMPLETE - Environment ready for tests");

// Now that DOM is available, import testing libraries
import "@testing-library/jest-dom/vitest";
import { afterEach, afterAll, beforeAll, vi } from "vitest";

// Load toast hook mock
import { setupToastMock } from "./mocks/toast";
setupToastMock();

// Mock window.matchMedia and window.history for jsdom environment
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

// Mock global APIs for jsdom environment
const makeObserver = () => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
});

// Mock IntersectionObserver
Object.defineProperty(window, "IntersectionObserver", {
  writable: true,
  value: vi.fn().mockImplementation(makeObserver),
});
Object.defineProperty(globalThis, "IntersectionObserver", {
  writable: true,
  value: window.IntersectionObserver,
});

// Mock ResizeObserver
Object.defineProperty(window, "ResizeObserver", {
  writable: true,
  value: vi.fn().mockImplementation(makeObserver),
});
Object.defineProperty(globalThis, "ResizeObserver", {
  writable: true,
  value: window.ResizeObserver,
});

// Mock MutationObserver
Object.defineProperty(window, "MutationObserver", {
  writable: true,
  value: vi.fn().mockImplementation(makeObserver),
});
Object.defineProperty(globalThis, "MutationObserver", {
  writable: true,
  value: window.MutationObserver,
});

// Mock URL methods
Object.defineProperty(URL, "createObjectURL", {
  writable: true,
  value: vi.fn(() => "blob:mock-url"),
});
Object.defineProperty(URL, "revokeObjectURL", {
  writable: true,
  value: vi.fn(),
});

// getComputedStyle mock is already set up earlier in JSDOM setup

// Mock localStorage (should be available in jsdom but ensure it's mocked)
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

// Mock window.location methods without replacing the Location object
try {
  const loc = window.location;
  vi.spyOn(loc, "reload").mockImplementation(() => {});
  vi.spyOn(loc, "assign").mockImplementation(() => {});
  vi.spyOn(loc, "replace").mockImplementation(() => {});

  // Also set globalThis.location to match window.location for consistency
  if (typeof globalThis !== "undefined" && !globalThis.location) {
    Object.defineProperty(globalThis, "location", {
      value: window.location,
      writable: true,
      configurable: true,
    });
  }
} catch {
  // Fallback for environments where spying is not possible
  try {
    Object.defineProperty(window.location, "reload", {
      value: vi.fn(),
      configurable: true,
    });
    Object.defineProperty(window.location, "assign", {
      value: vi.fn(),
      configurable: true,
    });
    Object.defineProperty(window.location, "replace", {
      value: vi.fn(),
      configurable: true,
    });

    // Also set globalThis.location in fallback
    if (typeof globalThis !== "undefined" && !globalThis.location) {
      Object.defineProperty(globalThis, "location", {
        value: window.location,
        writable: true,
        configurable: true,
      });
    }
  } catch {
    // Last-resort: leave as-is; tests that rely on navigation should stub per-test.
  }
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
