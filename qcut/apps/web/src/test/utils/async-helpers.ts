import { vi } from 'vitest';

/**
 * Wait for a condition to become true
 */
export async function waitForCondition(
  condition: () => boolean,
  options: {
    timeout?: number;
    interval?: number;
    message?: string;
  } = {}
): Promise<void> {
  const { timeout = 5000, interval = 100, message = 'Condition not met' } = options;
  const start = Date.now();
  
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timeout: ${message}`);
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

/**
 * Wait for a value to change
 */
export async function waitForValueChange<T>(
  getValue: () => T,
  initialValue: T,
  timeout = 5000
): Promise<T> {
  const start = Date.now();
  
  while (getValue() === initialValue) {
    if (Date.now() - start > timeout) {
      throw new Error(`Value did not change from ${initialValue}`);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  return getValue();
}

/**
 * Retry an async operation
 */
export async function retry<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    delay?: number;
    backoff?: number;
  } = {}
): Promise<T> {
  const { maxAttempts = 3, delay = 100, backoff = 2 } = options;
  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < maxAttempts - 1) {
        const waitTime = delay * Math.pow(backoff, attempt);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  throw lastError || new Error('Retry failed');
}

/**
 * Wait for next tick/microtask
 */
export async function nextTick(): Promise<void> {
  return new Promise(resolve => {
    // Use setImmediate if available (Node), otherwise setTimeout
    if (typeof setImmediate !== 'undefined') {
      setImmediate(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Flush all pending promises
 */
export async function flushPromises(): Promise<void> {
  // Run multiple ticks to ensure all promise chains resolve
  for (let i = 0; i < 10; i++) {
    await nextTick();
  }
}

/**
 * Create a deferred promise with manual resolution
 */
export function createDeferred<T>() {
  let resolve: (value: T) => void;
  let reject: (error: any) => void;
  
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  
  return {
    promise,
    resolve: resolve!,
    reject: reject!,
  };
}

/**
 * Wait for mock function to be called
 */
export async function waitForMockCall(
  mockFn: ReturnType<typeof vi.fn>,
  options: {
    timeout?: number;
    callCount?: number;
  } = {}
): Promise<void> {
  const { timeout = 5000, callCount = 1 } = options;
  
  await waitForCondition(
    () => mockFn.mock.calls.length >= callCount,
    {
      timeout,
      message: `Mock not called ${callCount} time(s)`,
    }
  );
}

/**
 * Create a timeout promise for race conditions
 */
export function createTimeout(ms: number, message = 'Operation timed out'): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

/**
 * Run async operation with timeout
 */
export async function withTimeout<T>(
  operation: Promise<T>,
  timeout: number,
  message?: string
): Promise<T> {
  return Promise.race([
    operation,
    createTimeout(timeout, message),
  ]);
}