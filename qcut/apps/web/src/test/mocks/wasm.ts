import { vi } from 'vitest';

/**
 * Mock WebAssembly global for FFmpeg tests
 */
export const mockWebAssembly = {
  compile: vi.fn().mockResolvedValue({}),
  compileStreaming: vi.fn().mockResolvedValue({}),
  instantiate: vi.fn().mockResolvedValue({
    instance: {
      exports: {
        memory: new WebAssembly.Memory({ initial: 256 }),
        _start: vi.fn(),
      },
    },
    module: {},
  }),
  instantiateStreaming: vi.fn().mockResolvedValue({
    instance: {
      exports: {
        memory: new WebAssembly.Memory({ initial: 256 }),
        _start: vi.fn(),
      },
    },
    module: {},
  }),
  validate: vi.fn().mockReturnValue(true),
  Module: vi.fn(),
  Instance: vi.fn(),
  Memory: WebAssembly.Memory,
  Table: WebAssembly.Table,
};

/**
 * Mock SharedArrayBuffer for FFmpeg multi-threading
 */
export const mockSharedArrayBuffer = class MockSharedArrayBuffer extends ArrayBuffer {
  constructor(length: number) {
    super(length);
  }
};

/**
 * Setup WebAssembly environment for tests
 */
export function setupWasmEnvironment() {
  // Mock WebAssembly
  (global as any).WebAssembly = mockWebAssembly;
  
  // Mock SharedArrayBuffer if not available
  if (typeof SharedArrayBuffer === 'undefined') {
    (global as any).SharedArrayBuffer = mockSharedArrayBuffer;
  }
  
  // Mock performance.memory for FFmpeg memory checks
  if (!performance.memory) {
    Object.defineProperty(performance, 'memory', {
      value: {
        usedJSHeapSize: 100000000,
        totalJSHeapSize: 200000000,
        jsHeapSizeLimit: 500000000,
      },
      writable: true,
    });
  }
  
  return () => {
    // Cleanup function
    delete (global as any).WebAssembly;
    delete (global as any).SharedArrayBuffer;
  };
}