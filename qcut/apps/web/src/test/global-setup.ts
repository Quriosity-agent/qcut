// Global setup that runs once before all tests
import { beforeAll } from 'vitest'

// Import polyfills at the global level
import './polyfills'

export default function setup() {
  // Force polyfill application globally
  const mockGetComputedStyle = (element: Element): CSSStyleDeclaration => {
    const styles: any = {
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
          'background': 'transparent'
        };
        return mappings[prop] || "";
      },
      setProperty: () => {},
      removeProperty: () => "",
      item: (index: number) => "",
      length: 0,
      parentRule: null,
      cssFloat: "",
      cssText: "",
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
    
    Object.defineProperty(styles, Symbol.iterator, {
      value: function* () {
        for (let i = 0; i < this.length; i++) {
          yield this.item(i);
        }
      }
    });
    
    return styles as CSSStyleDeclaration;
  };

  // Apply to all contexts aggressively
  const contexts = [globalThis, global, window].filter(Boolean);
  contexts.forEach(context => {
    if (context && typeof context === 'object') {
      try {
        Object.defineProperty(context, "getComputedStyle", {
          value: mockGetComputedStyle,
          writable: true,
          configurable: true,
        });
      } catch (e) {
        console.warn('Failed to set getComputedStyle on context:', e);
      }
    }
  });

  console.log('✓ Global setup complete - polyfills applied');
}