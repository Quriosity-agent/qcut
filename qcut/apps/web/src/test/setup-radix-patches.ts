// Patch Radix UI components to work in test environment
import { vi } from "vitest";

// Define getComputedStyle polyfill
const mockGetComputedStyle = (element: Element): CSSStyleDeclaration => {
  return {
    getPropertyValue: (prop: string) => '',
    setProperty: () => {},
    removeProperty: () => '',
    item: () => '',
    length: 0,
    parentRule: null,
    cssFloat: '',
    cssText: '',
    display: 'block',
    visibility: 'visible',
    opacity: '1',
    transform: 'none',
    transition: 'none',
    animation: 'none',
    position: 'static',
    top: 'auto',
    left: 'auto',
    right: 'auto',
    bottom: 'auto',
    width: 'auto',
    height: 'auto',
  } as any;
};

// Define ResizeObserver polyfill
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Apply polyfills to all possible global contexts
const contexts = [globalThis, global, window, self].filter(Boolean);
contexts.forEach(ctx => {
  if (ctx && typeof ctx === 'object') {
    try {
      if (!ctx.getComputedStyle) {
        Object.defineProperty(ctx, 'getComputedStyle', {
          value: mockGetComputedStyle,
          writable: true,
          configurable: true,
        });
      }
      if (!ctx.ResizeObserver) {
        Object.defineProperty(ctx, 'ResizeObserver', {
          value: MockResizeObserver,
          writable: true,
          configurable: true,
        });
      }
    } catch (e) {
      // Ignore errors
    }
  }
});

// Mock problematic Radix UI modules
vi.mock('@radix-ui/react-presence', () => ({
  Presence: ({ children, present }: any) => {
    return present !== false ? children : null;
  },
}));

vi.mock('@radix-ui/react-dismissable-layer', () => ({
  DismissableLayer: ({ children, ...props }: any) => {
    return children;
  },
  DismissableLayerBranch: ({ children }: any) => children,
}));

vi.mock('@radix-ui/react-focus-scope', () => ({
  FocusScope: ({ children }: any) => children,
}));

vi.mock('@radix-ui/react-focus-guards', () => ({
  FocusGuards: ({ children }: any) => children,
}));

export {};