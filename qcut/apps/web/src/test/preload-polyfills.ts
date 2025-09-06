// This file MUST be loaded before any React or Radix UI imports
// It provides critical polyfills for the test environment

// Immediate polyfill application before any module evaluation
(() => {
  const mockGetComputedStyle = (element: Element): CSSStyleDeclaration => {
    const styles: any = {
      getPropertyValue: (prop: string) => {
        const mappings: Record<string, string> = {
          'display': 'block', 'visibility': 'visible', 'opacity': '1', 
          'transform': 'none', 'transition': 'none', 'animation': 'none',
          'position': 'static', 'top': 'auto', 'left': 'auto', 
          'right': 'auto', 'bottom': 'auto', 'width': 'auto', 
          'height': 'auto', 'margin': '0px', 'padding': '0px', 
          'border': '0px', 'background': 'transparent'
        };
        return mappings[prop] || "";
      },
      setProperty: () => {}, 
      removeProperty: () => "", 
      item: () => "", 
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
    
    // Make it iterable
    Object.defineProperty(styles, Symbol.iterator, { 
      value: function* () { 
        for (let i = 0; i < this.length; i++) yield this.item(i); 
      }
    });
    
    return styles as CSSStyleDeclaration;
  };

  // Force assignment to all possible global contexts
  const applyToAll = () => {
    const targets = [globalThis, window, global, self].filter(Boolean);
    targets.forEach(target => {
      if (target && typeof target === 'object') {
        Object.defineProperty(target, 'getComputedStyle', {
          value: mockGetComputedStyle,
          writable: true,
          configurable: true,
          enumerable: true
        });
      }
    });
  };

  // Apply immediately
  applyToAll();

  // Re-apply on next tick
  if (typeof process !== 'undefined' && process.nextTick) {
    process.nextTick(applyToAll);
  }
  
  if (typeof setImmediate !== 'undefined') {
    setImmediate(applyToAll);
  }
  
  setTimeout(applyToAll, 0);
})();

export {};