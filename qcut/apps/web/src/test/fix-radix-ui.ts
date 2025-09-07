// Fix for Radix UI components in test environment
// This patches the actual usage of getComputedStyle in Radix UI

// Ensure getComputedStyle exists globally
if (typeof globalThis.getComputedStyle === 'undefined') {
  (globalThis as any).getComputedStyle = () => {
    const styles: Record<string, string> = {
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
      cssFloat: '',
      cssText: '',
    };
    return {
      ...styles,
      length: 0,
      parentRule: null,
      getPropertyValue: (prop: string) => styles[prop] ?? '',
      setProperty: (prop: string, value: string) => {
        styles[prop] = value;
      },
      removeProperty: (prop: string) => {
        const value = styles[prop] ?? '';
        styles[prop] = '';
        return value;
      },
      item: (index: number) => '',
    };
  };
}

// Also ensure it's available on window
if (typeof window !== 'undefined' && !window.getComputedStyle) {
  (window as any).getComputedStyle = globalThis.getComputedStyle;
}

// Export to ensure module is loaded
export {};