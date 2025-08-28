import { vi } from 'vitest';

/**
 * Mock IndexedDB implementation for storage tests
 */
export class MockIDBDatabase {
  name: string;
  version: number;
  objectStoreNames: DOMStringList;
  
  constructor(name: string, version: number) {
    this.name = name;
    this.version = version;
    this.objectStoreNames = [] as any;
  }
  
  createObjectStore = vi.fn((name: string, options?: any) => new MockIDBObjectStore(name));
  deleteObjectStore = vi.fn();
  transaction = vi.fn((storeNames: string[], mode?: string) => new MockIDBTransaction());
  close = vi.fn();
}

export class MockIDBObjectStore {
  name: string;
  keyPath: string | null;
  indexNames: DOMStringList;
  
  constructor(name: string) {
    this.name = name;
    this.keyPath = null;
    this.indexNames = [] as any;
  }
  
  add = vi.fn().mockResolvedValue('key');
  put = vi.fn().mockResolvedValue('key');
  get = vi.fn().mockResolvedValue({ id: 'test', data: 'value' });
  getAll = vi.fn().mockResolvedValue([]);
  delete = vi.fn().mockResolvedValue(undefined);
  clear = vi.fn().mockResolvedValue(undefined);
  count = vi.fn().mockResolvedValue(0);
  createIndex = vi.fn();
  deleteIndex = vi.fn();
}

export class MockIDBTransaction {
  objectStore = vi.fn((name: string) => new MockIDBObjectStore(name));
  abort = vi.fn();
  
  oncomplete: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onabort: (() => void) | null = null;
}

export class MockIDBRequest {
  result: any = null;
  error: DOMException | null = null;
  
  onsuccess: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onupgradeneeded: ((event: Event) => void) | null = null;
  onblocked: ((event: Event) => void) | null = null;
  
  constructor(result?: unknown, autoSuccess: boolean = true) {
    this.result = result;
    if (autoSuccess) {
      // Simulate async success with an event-like object whose target is the request
      setTimeout(() => {
        this.onsuccess?.({ type: 'success', target: this } as unknown as Event);
      }, 0);
    }
  }
}

/**
 * Mock IndexedDB factory
 */
export const mockIndexedDB = {
  open: vi.fn((name: string, version?: number) => {
    const request = new MockIDBRequest(new MockIDBDatabase(name, version || 1));
    return request;
  }),
  deleteDatabase: vi.fn((name: string) => new MockIDBRequest()),
  databases: vi.fn().mockResolvedValue([]),
  cmp: vi.fn((a: any, b: any) => 0),
};

/**
 * Setup IndexedDB mocks globally
 */
export function setupIndexedDBMock() {
  (global as any).indexedDB = mockIndexedDB;
  (global as any).IDBDatabase = MockIDBDatabase;
  (global as any).IDBObjectStore = MockIDBObjectStore;
  (global as any).IDBTransaction = MockIDBTransaction;
  (global as any).IDBRequest = MockIDBRequest;
  
  return () => {
    delete (global as any).indexedDB;
    delete (global as any).IDBDatabase;
    delete (global as any).IDBObjectStore;
    delete (global as any).IDBTransaction;
    delete (global as any).IDBRequest;
  };
}