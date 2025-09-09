// Patch Radix UI components to work in test environment
import { vi } from "vitest";
import type { ReactNode } from 'react';

// Define getComputedStyle polyfill
const mockGetComputedStyle = (element: Element): CSSStyleDeclaration => {
  const styles = {
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
  };
  return styles as unknown as CSSStyleDeclaration;
};

// Browser mocks (MutationObserver, ResizeObserver) are already installed 
// via browser-mocks.ts in global-setup.ts
// We only need to add getComputedStyle if missing

// Apply getComputedStyle polyfill to all possible global contexts
const contexts: Array<Record<string, unknown>> = [
  globalThis as unknown as Record<string, unknown>,
];
if (typeof global !== 'undefined') {
  contexts.push(global as unknown as Record<string, unknown>);
}
if (typeof window !== 'undefined') {
  contexts.push(window as unknown as Record<string, unknown>);
}
if (typeof self !== 'undefined') {
  contexts.push(self as unknown as Record<string, unknown>);
}

for (const ctx of contexts) {
  if (ctx && typeof ctx === 'object') {
    try {
      if (!('getComputedStyle' in ctx)) {
        Object.defineProperty(ctx, 'getComputedStyle', {
          value: mockGetComputedStyle,
          writable: true,
          configurable: true,
        });
      }
    } catch (e) {
      // Ignore errors
    }
  }
}

// Mock problematic Radix UI modules
vi.mock('@radix-ui/react-presence', () => ({
  Presence: ({ children, present }: { children?: ReactNode; present?: boolean }) => {
    return present !== false ? children : null;
  },
}));

vi.mock('@radix-ui/react-dismissable-layer', () => ({
  DismissableLayer: ({ children }: { children?: ReactNode }) => children,
  DismissableLayerBranch: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock('@radix-ui/react-focus-scope', () => ({
  FocusScope: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock('@radix-ui/react-focus-guards', () => ({
  FocusGuards: ({ children }: { children?: ReactNode }) => children,
}));

export {};