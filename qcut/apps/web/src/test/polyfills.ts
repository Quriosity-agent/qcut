// Global polyfills that must be available before any modules load
// This file should be imported first in setup.ts

// Robust getComputedStyle polyfill for JSDOM
const createGetComputedStylePolyfill = () => {
  return (element: Element): CSSStyleDeclaration => {
    const styles: any = {
      // Core CSSStyleDeclaration methods
      getPropertyValue: (prop: string) => {
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
          'background': 'transparent',
          'z-index': 'auto',
          'overflow': 'visible',
          'color': 'rgb(0, 0, 0)',
          'font-size': '16px',
          'line-height': 'normal'
        };
        return mappings[prop] || "";
      },
      setProperty: () => {},
      removeProperty: () => "",
      item: (index: number) => "",
      
      // Required properties
      length: 0,
      parentRule: null,
      cssFloat: "",
      cssText: "",
      
      // Layout properties that Radix UI checks
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
      height: "auto",
      zIndex: "auto"
    };
    
    // Make it properly iterable
    Object.defineProperty(styles, Symbol.iterator, {
      value: function* () {
        for (let i = 0; i < this.length; i++) {
          yield this.item(i);
        }
      }
    });
    
    return styles as CSSStyleDeclaration;
  };
};

// Apply the polyfill immediately to all global contexts
const polyfill = createGetComputedStylePolyfill();

// Apply to all possible global scopes
const applyToContext = (context: any, name: string) => {
  try {
    Object.defineProperty(context, "getComputedStyle", {
      value: polyfill,
      writable: true,
      configurable: true,
    });
    console.log(`✓ Applied getComputedStyle polyfill to ${name}`);
  } catch (error) {
    console.warn(`Failed to apply polyfill to ${name}:`, error);
  }
};

// Apply immediately with safety checks
applyToContext(globalThis, "globalThis");

if (typeof window !== "undefined" && window) {
  applyToContext(window, "window");
}

if (typeof global !== "undefined" && global) {
  applyToContext(global, "global");
}

// Also set on the current module's global scope
if (typeof this !== "undefined") {
  applyToContext(this, "this");
}

// Additional polyfills for JSDOM environment
const setupAdditionalPolyfills = () => {
  const contexts = [
    globalThis,
    typeof window !== "undefined" ? window : null,
    typeof global !== "undefined" ? global : null
  ].filter(Boolean);
  
  contexts.forEach(context => {
    if (!context || typeof context !== 'object') return;
    
    try {
      // requestAnimationFrame polyfill
      if (!context.requestAnimationFrame) {
        context.requestAnimationFrame = (callback: FrameRequestCallback) => {
          return context.setTimeout(callback, 16); // ~60fps
        };
      }
      
      if (!context.cancelAnimationFrame) {
        context.cancelAnimationFrame = (id: number) => {
          context.clearTimeout(id);
        };
      }
      
      // ResizeObserver mock
      if (!context.ResizeObserver) {
        context.ResizeObserver = class MockResizeObserver {
          observe() {}
          unobserve() {}
          disconnect() {}
        };
      }
      
      // IntersectionObserver mock
      if (!context.IntersectionObserver) {
        context.IntersectionObserver = class MockIntersectionObserver {
          root: Element | null = null;
          rootMargin: string = '0px';
          thresholds: ReadonlyArray<number> = [0];
          
          constructor() {}
          observe() {}
          unobserve() {}
          disconnect() {}
          takeRecords() { return []; }
        } as any;
      }
      
      console.log(`✓ Applied additional polyfills to context`);
    } catch (error) {
      console.warn(`Failed to apply additional polyfills:`, error);
    }
  });
};

// Apply additional polyfills
setupAdditionalPolyfills();

// Export for explicit use if needed
export { polyfill as getComputedStylePolyfill };