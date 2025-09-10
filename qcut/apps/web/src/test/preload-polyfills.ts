// This file MUST be loaded before any React or Radix UI imports
// It provides critical polyfills for the test environment

import {
  installAllBrowserMocks,
  MockMutationObserver,
  MockResizeObserver,
  MockIntersectionObserver,
} from "./mocks/browser-mocks";

// Install browser mocks before any imports that might use them
installAllBrowserMocks();

// CRITICAL: Ensure MutationObserver is available immediately
// This is the most aggressive installation possible
const installCriticalObservers = (target: any) => {
  if (!target) return;

  try {
    // Check if properties are configurable before trying to modify
    const mutationObserverDesc = Object.getOwnPropertyDescriptor(
      target,
      "MutationObserver"
    );
    const resizeObserverDesc = Object.getOwnPropertyDescriptor(
      target,
      "ResizeObserver"
    );
    const intersectionObserverDesc = Object.getOwnPropertyDescriptor(
      target,
      "IntersectionObserver"
    );

    // Only set if not defined or configurable
    if (!mutationObserverDesc || mutationObserverDesc.configurable) {
      Object.defineProperty(target, "MutationObserver", {
        value: MockMutationObserver,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }

    if (!resizeObserverDesc || resizeObserverDesc.configurable) {
      Object.defineProperty(target, "ResizeObserver", {
        value: MockResizeObserver,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }

    if (!intersectionObserverDesc || intersectionObserverDesc.configurable) {
      Object.defineProperty(target, "IntersectionObserver", {
        value: MockIntersectionObserver,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
  } catch (e) {
    // Silently skip if we can't modify the properties
    console.log("Could not install observers on target:", e);
  }
};

// Install on all possible contexts IMMEDIATELY
// Only process contexts that actually exist
const contexts = [
  typeof globalThis !== "undefined" ? globalThis : null,
  typeof global !== "undefined" ? global : null,
  typeof window !== "undefined" ? window : null,
  typeof self !== "undefined" ? self : null,
].filter(Boolean);

contexts.forEach((ctx) => installCriticalObservers(ctx));

// Create a comprehensive mock CSSStyleDeclaration
class MockCSSStyleDeclaration {
  [key: string]: any;

  constructor() {
    // Add all common CSS properties
    this.display = "block";
    this.visibility = "visible";
    this.opacity = "1";
    this.transform = "none";
    this.transition = "none";
    this.animation = "none";
    this.position = "static";
    this.top = "auto";
    this.left = "auto";
    this.right = "auto";
    this.bottom = "auto";
    this.width = "auto";
    this.height = "auto";
    this.margin = "0px";
    this.padding = "0px";
    this.border = "0px";
    this.background = "transparent";
    this.cssFloat = "";
    this.cssText = "";
    this.length = 0;
    this.parentRule = null;
  }

  getPropertyValue(prop: string): string {
    const normalizedProp = prop.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
    return this[normalizedProp] || "";
  }

  setProperty(prop: string, value: string): void {
    const normalizedProp = prop.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
    this[normalizedProp] = value;
  }

  removeProperty(prop: string): string {
    const normalizedProp = prop.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
    const oldValue = this[normalizedProp];
    this[normalizedProp] = "";
    return oldValue || "";
  }

  item(index: number): string {
    return "";
  }

  *[Symbol.iterator]() {
    // Make it iterable
  }
}

// Create the mock function
const mockGetComputedStyle = (element: Element): CSSStyleDeclaration => {
  return new MockCSSStyleDeclaration() as any;
};

// Aggressive patching strategy
const patchGlobal = (target: any, name: string) => {
  if (!target) return;

  try {
    // Try multiple ways to set the property
    target.getComputedStyle = mockGetComputedStyle;

    Object.defineProperty(target, "getComputedStyle", {
      value: mockGetComputedStyle,
      writable: true,
      configurable: true,
      enumerable: true,
    });

    // Also set on prototype if exists
    if (target.prototype) {
      target.prototype.getComputedStyle = mockGetComputedStyle;
    }
  } catch (e) {
    // Ignore errors
  }
};

// Apply to all possible contexts immediately
patchGlobal(globalThis, "globalThis");
if (typeof global !== "undefined") patchGlobal(global, "global");
if (typeof window !== "undefined") patchGlobal(window, "window");
if (typeof self !== "undefined") patchGlobal(self, "self");

// Intercept property access
if (typeof Proxy !== "undefined") {
  const handler = {
    get(target: any, prop: string) {
      if (prop === "getComputedStyle") {
        return mockGetComputedStyle;
      }
      return target[prop];
    },
  };

  try {
    if (typeof window !== "undefined") {
      window = new Proxy(window, handler);
    }
  } catch (e) {
    // Can't proxy window in some environments
  }
}

// Re-apply periodically to catch late initializations
const intervals = [0, 1, 10, 100];
intervals.forEach((delay) => {
  setTimeout(() => {
    patchGlobal(globalThis, "globalThis");
    patchGlobal(global, "global");
    patchGlobal(window, "window");
    patchGlobal(self, "self");
  }, delay);
});
