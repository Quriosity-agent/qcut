// Simplified test setup - consolidates all setup logic in correct order
import { vi, beforeAll, afterEach, afterAll } from "vitest";
import "@testing-library/jest-dom/vitest";

// 1. FIRST: Install browser APIs immediately
console.log("🔧 Installing browser APIs...");

// Mock MutationObserver - critical for Radix UI
globalThis.MutationObserver = class MockMutationObserver implements MutationObserver {
  constructor(private callback: MutationCallback) {}
  observe() {}
  disconnect() {}
  takeRecords(): MutationRecord[] { return []; }
};

// Mock ResizeObserver
globalThis.ResizeObserver = class MockResizeObserver implements ResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock IntersectionObserver
globalThis.IntersectionObserver = class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds: ReadonlyArray<number> = [0];
  constructor(private callback: IntersectionObserverCallback) {}
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
};

// Ensure observers are available on window if it exists
if (typeof window !== 'undefined') {
  window.MutationObserver = globalThis.MutationObserver;
  window.ResizeObserver = globalThis.ResizeObserver;
  window.IntersectionObserver = globalThis.IntersectionObserver;
}

console.log("✅ Browser APIs installed");

// 2. SECOND: Mock Radix UI modules that cause issues
console.log("🔧 Mocking Radix UI modules...");

vi.mock('@radix-ui/react-focus-scope', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => children,
  FocusScope: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock('@radix-ui/react-presence', () => ({
  __esModule: true,
  default: ({ children, present }: { children?: React.ReactNode; present?: boolean }) => {
    return present !== false ? children : null;
  },
  Presence: ({ children, present }: { children?: React.ReactNode; present?: boolean }) => {
    return present !== false ? children : null;
  },
}));

vi.mock('@radix-ui/react-portal', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => children,
  Portal: ({ children }: { children?: React.ReactNode }) => children,
}));

console.log("✅ Radix UI modules mocked");

// 3. THIRD: Setup DOM and window mocks
console.log("🔧 Setting up DOM mocks...");

// Mock getComputedStyle
const mockGetComputedStyle = (element: Element): CSSStyleDeclaration => {
  const styles = {
    getPropertyValue: (prop: string) => {
      const defaults: Record<string, string> = {
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        position: 'static',
        transform: 'none'
      };
      return defaults[prop] || '';
    },
    setProperty: () => {},
    removeProperty: () => '',
    item: () => '',
    length: 0,
    parentRule: null,
    cssFloat: '',
    cssText: '',
    display: 'block',
    visibility: 'visible',
    opacity: '1'
  };
  return styles as CSSStyleDeclaration;
};

// Apply getComputedStyle to all contexts
globalThis.getComputedStyle = mockGetComputedStyle;
if (typeof window !== 'undefined') {
  window.getComputedStyle = mockGetComputedStyle;
}

// Mock window.matchMedia
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

// Mock localStorage
const localStorageMock = {
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

// Mock URL methods
Object.defineProperty(URL, "createObjectURL", {
  writable: true,
  value: vi.fn(() => "blob:mock-url"),
});
Object.defineProperty(URL, "revokeObjectURL", {
  writable: true,
  value: vi.fn(),
});

console.log("✅ DOM mocks configured");

// 4. FOURTH: Test lifecycle hooks
beforeAll(() => {
  // Suppress console errors in tests
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  
  console.log("✅ Test environment ready");
});

afterEach(() => {
  vi.clearAllMocks();
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
});

afterAll(() => {
  vi.restoreAllMocks();
});

console.log("🎯 Simplified setup complete");