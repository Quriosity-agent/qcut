import { vi } from "vitest";

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
export const mockSharedArrayBuffer = class MockSharedArrayBuffer extends ArrayBuffer {};

/**
 * Setup WebAssembly environment for tests
 */
export function setupWasmEnvironment() {
  // Capture original descriptors before mocking
  const prevWA = Object.getOwnPropertyDescriptor(globalThis, "WebAssembly");
  const prevSAB = Object.getOwnPropertyDescriptor(
    globalThis,
    "SharedArrayBuffer"
  );
  const prevPerfMem = Object.getOwnPropertyDescriptor(performance, "memory");

  // Mock WebAssembly
  Object.defineProperty(globalThis, "WebAssembly", {
    value: mockWebAssembly,
    configurable: true,
    writable: true,
  });

  // Mock SharedArrayBuffer if not available
  if (typeof SharedArrayBuffer === "undefined") {
    Object.defineProperty(globalThis, "SharedArrayBuffer", {
      value: mockSharedArrayBuffer,
      configurable: true,
      writable: true,
    });
  }

  // Mock performance.memory for FFmpeg memory checks
  if (!("memory" in performance)) {
    Object.defineProperty(performance, "memory", {
      value: {
        usedJSHeapSize: 100_000_000,
        totalJSHeapSize: 200_000_000,
        jsHeapSizeLimit: 500_000_000,
      },
      configurable: true,
    });
  }

  return () => {
    // Cleanup function: restore captured descriptors
    if (prevWA) {
      Object.defineProperty(globalThis, "WebAssembly", prevWA);
    } else {
      Object.defineProperty(globalThis, "WebAssembly", {
        value: undefined,
        configurable: true,
        writable: true,
      });
    }

    if (prevSAB) {
      Object.defineProperty(globalThis, "SharedArrayBuffer", prevSAB);
    } else if (
      "SharedArrayBuffer" in globalThis &&
      typeof SharedArrayBuffer === "function"
    ) {
      // Only reset if we likely set it to our mock
      const currentSAB = globalThis.SharedArrayBuffer;
      if (
        currentSAB &&
        currentSAB.prototype &&
        currentSAB.prototype.constructor === mockSharedArrayBuffer
      ) {
        Object.defineProperty(globalThis, "SharedArrayBuffer", {
          value: undefined,
          configurable: true,
          writable: true,
        });
      }
    }

    if (prevPerfMem) {
      Object.defineProperty(performance, "memory", prevPerfMem);
    } else if ("memory" in performance) {
      Object.defineProperty(performance, "memory", {
        value: undefined,
        configurable: true,
      });
    }
  };
}
