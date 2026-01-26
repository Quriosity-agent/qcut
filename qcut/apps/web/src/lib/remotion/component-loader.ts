/**
 * Component Loader
 *
 * Loads and manages custom Remotion components from external files.
 * Handles validation, sandboxing, and storage in IndexedDB.
 *
 * @module lib/remotion/component-loader
 */

import type { RemotionComponentDefinition, RemotionComponentCategory } from "./types";
import { validateComponent, type ValidationResult, type ComponentMetadata } from "./component-validator";

// ============================================================================
// Types
// ============================================================================

/**
 * Result of loading a component
 */
export interface LoadResult {
  /** Whether loading was successful */
  success: boolean;
  /** The loaded component definition */
  component?: RemotionComponentDefinition;
  /** Error message if loading failed */
  error?: string;
  /** Validation result */
  validation?: ValidationResult;
}

/**
 * Options for loading a component
 */
export interface LoadOptions {
  /** Whether to run in sandboxed mode */
  sandbox?: boolean;
  /** Whether to generate a thumbnail */
  generateThumbnail?: boolean;
  /** Whether to store in IndexedDB */
  storeInDB?: boolean;
  /** Custom ID to use (generated if not provided) */
  customId?: string;
}

/**
 * Stored component data in IndexedDB
 */
export interface StoredComponent {
  /** Component ID */
  id: string;
  /** Original file name */
  fileName: string;
  /** Component source code */
  sourceCode: string;
  /** Component metadata */
  metadata: ComponentMetadata;
  /** Thumbnail data URL if available */
  thumbnail?: string;
  /** When the component was imported */
  importedAt: number;
  /** When the component was last updated */
  updatedAt: number;
}

// ============================================================================
// Constants
// ============================================================================

const DB_NAME = "qcut-remotion-components";
const DB_VERSION = 1;
const STORE_NAME = "components";

/**
 * Default load options
 */
export const DEFAULT_LOAD_OPTIONS: LoadOptions = {
  sandbox: true,
  generateThumbnail: false,
  storeInDB: true,
};

// ============================================================================
// IndexedDB Helpers
// ============================================================================

/**
 * Open the IndexedDB database
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error("Failed to open IndexedDB"));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("fileName", "fileName", { unique: false });
        store.createIndex("importedAt", "importedAt", { unique: false });
      }
    };
  });
}

/**
 * Store a component in IndexedDB
 */
async function storeComponent(component: StoredComponent): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    const request = store.put(component);

    request.onerror = () => {
      reject(new Error("Failed to store component"));
    };

    request.onsuccess = () => {
      resolve();
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Get a component from IndexedDB by ID
 */
async function getStoredComponent(id: string): Promise<StoredComponent | null> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);

    const request = store.get(id);

    request.onerror = () => {
      reject(new Error("Failed to get component"));
    };

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Get all stored components from IndexedDB
 */
async function getAllStoredComponents(): Promise<StoredComponent[]> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);

    const request = store.getAll();

    request.onerror = () => {
      reject(new Error("Failed to get components"));
    };

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Delete a component from IndexedDB
 */
async function deleteStoredComponent(id: string): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    const request = store.delete(id);

    request.onerror = () => {
      reject(new Error("Failed to delete component"));
    };

    request.onsuccess = () => {
      resolve();
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

// ============================================================================
// Code Execution (Sandboxed)
// ============================================================================

/**
 * Create a sandboxed environment for component evaluation
 * Note: This is a basic sandbox - for production, consider using Web Workers or iframes
 */
function createSandboxedEvaluator() {
  // Create a restricted global scope
  const restrictedGlobals: Record<string, unknown> = {
    // Allow React
    React: (window as typeof window & { React?: unknown }).React,
    // Allow console for debugging
    console: {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    },
    // Allow Math
    Math,
    // Allow basic types
    Array,
    Object,
    String,
    Number,
    Boolean,
    Date,
    JSON,
    Map,
    Set,
    Promise,
    // Block dangerous globals
    eval: undefined,
    Function: undefined,
    fetch: undefined,
    XMLHttpRequest: undefined,
    WebSocket: undefined,
    localStorage: undefined,
    sessionStorage: undefined,
    indexedDB: undefined,
    document: undefined,
    window: undefined,
  };

  return restrictedGlobals;
}

/**
 * Generate a unique component ID
 */
function generateComponentId(fileName: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  const sanitizedName = fileName
    .replace(/\.tsx?$/, "")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .toLowerCase();
  return `imported-${sanitizedName}-${timestamp}-${random}`;
}

// ============================================================================
// Component Loading
// ============================================================================

/**
 * Load a component from source code
 *
 * @param sourceCode - The component source code
 * @param fileName - Original file name
 * @param options - Load options
 * @returns Load result with component definition or error
 */
export async function loadComponentFromCode(
  sourceCode: string,
  fileName: string,
  options: LoadOptions = DEFAULT_LOAD_OPTIONS
): Promise<LoadResult> {
  const opts = { ...DEFAULT_LOAD_OPTIONS, ...options };

  // Validate the component
  const validation = validateComponent(sourceCode);

  if (!validation.valid) {
    return {
      success: false,
      error: validation.errors.join("; "),
      validation,
    };
  }

  // Extract metadata
  const metadata = validation.metadata!;

  // Generate component ID
  const componentId = opts.customId || generateComponentId(fileName);

  // Create a placeholder component since we can't safely evaluate arbitrary code
  // In a production environment, you would use a sandboxed iframe or web worker
  const PlaceholderComponent = () => {
    // This is a placeholder - actual component would be loaded via dynamic import
    return null;
  };

  // Build the component definition
  const componentDef: RemotionComponentDefinition = {
    id: componentId,
    name: metadata.name,
    description: metadata.description,
    category: metadata.category,
    durationInFrames: metadata.durationInFrames,
    fps: metadata.fps,
    width: metadata.width,
    height: metadata.height,
    schema: { safeParse: () => ({ success: true }) } as never, // Placeholder schema
    defaultProps: {},
    component: PlaceholderComponent,
    source: "imported",
    tags: metadata.tags,
    version: metadata.version,
    author: metadata.author,
  };

  // Store in IndexedDB if requested
  if (opts.storeInDB) {
    try {
      const storedComponent: StoredComponent = {
        id: componentId,
        fileName,
        sourceCode,
        metadata,
        importedAt: Date.now(),
        updatedAt: Date.now(),
      };

      await storeComponent(storedComponent);
    } catch (error) {
      console.warn("Failed to store component in IndexedDB:", error);
    }
  }

  return {
    success: true,
    component: componentDef,
    validation,
  };
}

/**
 * Load a component from a file
 *
 * @param file - The file to load
 * @param options - Load options
 * @returns Load result with component definition or error
 */
export async function loadComponentFromFile(
  file: File,
  options: LoadOptions = DEFAULT_LOAD_OPTIONS
): Promise<LoadResult> {
  // Check file type
  if (!file.name.endsWith(".tsx") && !file.name.endsWith(".ts")) {
    return {
      success: false,
      error: "Only .tsx and .ts files are supported",
    };
  }

  // Read file content
  try {
    const sourceCode = await file.text();
    return loadComponentFromCode(sourceCode, file.name, options);
  } catch (error) {
    return {
      success: false,
      error: `Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Load all stored components from IndexedDB
 *
 * @returns Array of component definitions
 */
export async function loadStoredComponents(): Promise<RemotionComponentDefinition[]> {
  try {
    const storedComponents = await getAllStoredComponents();

    return storedComponents.map((stored) => ({
      id: stored.id,
      name: stored.metadata.name,
      description: stored.metadata.description,
      category: stored.metadata.category,
      durationInFrames: stored.metadata.durationInFrames,
      fps: stored.metadata.fps,
      width: stored.metadata.width,
      height: stored.metadata.height,
      schema: { safeParse: () => ({ success: true }) } as never,
      defaultProps: {},
      component: () => null, // Placeholder
      source: "imported" as const,
      tags: stored.metadata.tags,
      version: stored.metadata.version,
      author: stored.metadata.author,
      thumbnail: stored.thumbnail,
    }));
  } catch (error) {
    console.error("Failed to load stored components:", error);
    return [];
  }
}

/**
 * Remove a stored component
 *
 * @param componentId - The component ID to remove
 */
export async function removeStoredComponent(componentId: string): Promise<void> {
  await deleteStoredComponent(componentId);
}

/**
 * Get a stored component's source code
 *
 * @param componentId - The component ID
 * @returns The source code or null if not found
 */
export async function getComponentSourceCode(componentId: string): Promise<string | null> {
  try {
    const stored = await getStoredComponent(componentId);
    return stored?.sourceCode || null;
  } catch {
    return null;
  }
}

/**
 * Update a stored component's source code
 *
 * @param componentId - The component ID
 * @param newSourceCode - The new source code
 * @returns Load result with updated component
 */
export async function updateStoredComponent(
  componentId: string,
  newSourceCode: string
): Promise<LoadResult> {
  try {
    const existing = await getStoredComponent(componentId);
    if (!existing) {
      return {
        success: false,
        error: "Component not found",
      };
    }

    // Validate new code
    const validation = validateComponent(newSourceCode);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.errors.join("; "),
        validation,
      };
    }

    // Update stored component
    const updated: StoredComponent = {
      ...existing,
      sourceCode: newSourceCode,
      metadata: validation.metadata!,
      updatedAt: Date.now(),
    };

    await storeComponent(updated);

    // Build updated component definition
    const componentDef: RemotionComponentDefinition = {
      id: componentId,
      name: validation.metadata!.name,
      description: validation.metadata!.description,
      category: validation.metadata!.category,
      durationInFrames: validation.metadata!.durationInFrames,
      fps: validation.metadata!.fps,
      width: validation.metadata!.width,
      height: validation.metadata!.height,
      schema: { safeParse: () => ({ success: true }) } as never,
      defaultProps: {},
      component: () => null,
      source: "imported",
      tags: validation.metadata!.tags,
      version: validation.metadata!.version,
      author: validation.metadata!.author,
    };

    return {
      success: true,
      component: componentDef,
      validation,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to update component: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

export default {
  loadComponentFromCode,
  loadComponentFromFile,
  loadStoredComponents,
  removeStoredComponent,
  getComponentSourceCode,
  updateStoredComponent,
};
