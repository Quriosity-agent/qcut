/**
 * Dynamic Component Loader
 *
 * Loads bundled Remotion components at runtime using blob URLs and dynamic imports.
 * Provides caching to avoid re-importing the same components.
 *
 * @module lib/remotion/dynamic-loader
 */

import * as React from "react";
import * as Remotion from "remotion";
import { debugLog, debugError } from "@/lib/debug-config";

// ============================================================================
// Global Setup for Dynamic Imports
// ============================================================================

/** Flag to track if globals have been initialized */
let globalsInitialized = false;

/**
 * Ensure React and Remotion are available as globals for dynamic imports.
 * Must be called once before any loadBundledComponent() calls.
 *
 * Blob URL imports cannot resolve bare specifiers like "react" or "remotion",
 * so we make these available as globals that the wrapped code can reference.
 */
export function setupGlobalsForDynamicImport(): void {
  if (typeof window === "undefined") return;
  if (globalsInitialized) return;

  try {
    // Make React available globally
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).React = React;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).ReactJSXRuntime = {
      jsx: React.createElement,
      jsxs: React.createElement,
      Fragment: React.Fragment,
    };

    // Make Remotion available globally
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Remotion = Remotion;

    globalsInitialized = true;
    console.log("[DynamicLoader] ✅ Globals initialized for dynamic imports");
  } catch (e) {
    console.error("[DynamicLoader] Failed to setup globals:", e);
  }
}

// Initialize globals on module load
setupGlobalsForDynamicImport();

// ============================================================================
// Types
// ============================================================================

/**
 * Result of loading a dynamic component
 */
export interface DynamicLoadResult {
  /** Whether loading was successful */
  success: boolean;
  /** The loaded React component */
  component?: React.ComponentType<Record<string, unknown>>;
  /** Error message if loading failed */
  error?: string;
}

/**
 * Cached component entry
 */
interface CacheEntry {
  /** The loaded React component */
  component: React.ComponentType<Record<string, unknown>>;
  /** Blob URL used to load the component (for cleanup) */
  blobUrl: string;
  /** When the component was cached */
  cachedAt: number;
}

// ============================================================================
// Component Cache
// ============================================================================

/**
 * Cache for loaded components to avoid re-importing.
 * Maps component ID to cached entry.
 */
const componentCache = new Map<string, CacheEntry>();

/**
 * Get a cached component by ID.
 *
 * @param componentId - The component ID
 * @returns The cached component or undefined
 */
export function getCachedComponent(
  componentId: string
): React.ComponentType<Record<string, unknown>> | undefined {
  const entry = componentCache.get(componentId);
  return entry?.component;
}

/**
 * Check if a component is cached.
 *
 * @param componentId - The component ID
 * @returns Whether the component is cached
 */
export function isComponentCached(componentId: string): boolean {
  return componentCache.has(componentId);
}

/**
 * Remove a component from the cache and cleanup its blob URL.
 *
 * @param componentId - The component ID to remove
 */
export function removeCachedComponent(componentId: string): void {
  const entry = componentCache.get(componentId);
  if (entry) {
    // Revoke the blob URL to free memory
    URL.revokeObjectURL(entry.blobUrl);
    componentCache.delete(componentId);
    debugLog("[DynamicLoader] Removed cached component:", componentId);
  }
}

/**
 * Clear all cached components and their blob URLs.
 */
export function clearComponentCache(): void {
  for (const entry of componentCache.values()) {
    URL.revokeObjectURL(entry.blobUrl);
  }
  componentCache.clear();
  debugLog("[DynamicLoader] Cleared component cache");
}

/**
 * Get cache statistics.
 */
export function getCacheStats(): {
  size: number;
  componentIds: string[];
} {
  return {
    size: componentCache.size,
    componentIds: Array.from(componentCache.keys()),
  };
}

// ============================================================================
// Dynamic Loading
// ============================================================================

/**
 * Load a bundled component from source code string.
 * Creates a blob URL and dynamically imports the module.
 *
 * The bundled code should be ESM format with React/Remotion externalized.
 * It should export a default React component or a named export matching compositionId.
 *
 * @param bundledCode - The bundled JavaScript code as a string
 * @param compositionId - The composition ID (used for finding exports)
 * @param componentId - Optional component ID for caching (defaults to compositionId)
 * @returns Load result with component or error
 *
 * @example
 * ```ts
 * const result = await loadBundledComponent(bundledCode, "QCutDemo");
 * if (result.success && result.component) {
 *   // Use result.component as a React component
 * }
 * ```
 */
export async function loadBundledComponent(
  bundledCode: string,
  compositionId: string,
  componentId?: string
): Promise<DynamicLoadResult> {
  const cacheId = componentId || compositionId;

  // Check cache first
  const cached = componentCache.get(cacheId);
  if (cached) {
    debugLog("[DynamicLoader] Using cached component:", cacheId);
    return {
      success: true,
      component: cached.component,
    };
  }

  try {
    // Wrap the bundled code to inject React/Remotion dependencies
    // This handles the externalized imports
    const wrappedCode = wrapBundledCode(bundledCode);

    // Create blob URL from bundled code
    const blob = new Blob([wrappedCode], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);

    try {
      // Dynamic import the module
      // @vite-ignore comment tells Vite not to analyze this import
      const module = await import(/* @vite-ignore */ blobUrl);

      // Try common export patterns
      const Component = findExportedComponent(module, compositionId);

      if (!Component) {
        throw new Error(
          "No valid React component found in exports. " +
            `Available exports: ${Object.keys(module).join(", ")}`
        );
      }

      // Validate it's a function (React component)
      if (typeof Component !== "function") {
        throw new Error(`Export is not a function: got ${typeof Component}`);
      }

      // Cache the component
      componentCache.set(cacheId, {
        component: Component as React.ComponentType<Record<string, unknown>>,
        blobUrl,
        cachedAt: Date.now(),
      });

      debugLog("[DynamicLoader] Loaded and cached component:", cacheId);

      return {
        success: true,
        component: Component as React.ComponentType<Record<string, unknown>>,
      };
    } catch (importError) {
      // Clean up blob URL on error
      URL.revokeObjectURL(blobUrl);
      throw importError;
    }
  } catch (error) {
    debugError("[DynamicLoader] Failed to load component:", cacheId, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Wrap bundled code to inject global dependencies.
 * The bundled code has React/Remotion as externals, so we need to
 * make them available in the module scope.
 *
 * esbuild produces ESM code with imports like:
 *   import { useCurrentFrame } from "remotion";
 *   import * as React from "react";
 *
 * Since blob URLs cannot resolve bare specifiers, we need to:
 * 1. Remove the external import statements
 * 2. Provide the dependencies from globals set up by setupGlobalsForDynamicImport()
 *
 * @param bundledCode - The original bundled code
 * @returns Wrapped code with dependency injection
 */
function wrapBundledCode(bundledCode: string): string {
  // Ensure globals are available
  setupGlobalsForDynamicImport();

  // Preamble that provides React and Remotion from globals
  const preamble = `
// Injected by dynamic-loader: provide React/Remotion from globals
const React = globalThis.React || window.React;
const { useState, useEffect, useCallback, useMemo, useRef, useContext, useReducer, useLayoutEffect, Fragment, createElement, forwardRef, memo, lazy, Suspense, createContext, Children, cloneElement, isValidElement, Component, PureComponent } = React;
const ReactJSXRuntime = globalThis.ReactJSXRuntime || window.ReactJSXRuntime || { jsx: React.createElement, jsxs: React.createElement, Fragment: React.Fragment };
const { jsx, jsxs } = ReactJSXRuntime;

// Remotion exports
const Remotion = globalThis.Remotion || window.Remotion || {};
const { useCurrentFrame, useVideoConfig, AbsoluteFill, Sequence, Series, Audio, Video, Img, staticFile, interpolate, spring, Easing, continueRender, delayRender, random, measureSpring, Loop, Composition, Still, getInputProps, OffthreadVideo, useFrameRange, interpolateColors } = Remotion;
`;

  // Remove external import statements from the bundled code
  // These patterns match what esbuild produces with external: ["react", "remotion", ...]
  let transformed = bundledCode;

  // Remove React imports (various forms)
  transformed = transformed.replace(
    /import\s+\*\s+as\s+\w+\s+from\s*["']react["'];?\n?/g,
    ""
  );
  transformed = transformed.replace(
    /import\s+\w+\s+from\s*["']react["'];?\n?/g,
    ""
  );
  transformed = transformed.replace(
    /import\s*\{[^}]*\}\s*from\s*["']react["'];?\n?/g,
    ""
  );

  // Remove react/jsx-runtime imports
  transformed = transformed.replace(
    /import\s*\{[^}]*\}\s*from\s*["']react\/jsx-runtime["'];?\n?/g,
    ""
  );
  transformed = transformed.replace(
    /import\s*\{[^}]*\}\s*from\s*["']react\/jsx-dev-runtime["'];?\n?/g,
    ""
  );

  // Remove Remotion imports (various forms)
  transformed = transformed.replace(
    /import\s+\*\s+as\s+\w+\s+from\s*["']remotion["'];?\n?/g,
    ""
  );
  transformed = transformed.replace(
    /import\s+\w+\s+from\s*["']remotion["'];?\n?/g,
    ""
  );
  transformed = transformed.replace(
    /import\s*\{[^}]*\}\s*from\s*["']remotion["'];?\n?/g,
    ""
  );

  // Remove @remotion/* imports
  transformed = transformed.replace(
    /import\s*\{[^}]*\}\s*from\s*["']@remotion\/[^"']+["'];?\n?/g,
    ""
  );
  transformed = transformed.replace(
    /import\s+\*\s+as\s+\w+\s+from\s*["']@remotion\/[^"']+["'];?\n?/g,
    ""
  );
  transformed = transformed.replace(
    /import\s+\w+\s+from\s*["']@remotion\/[^"']+["'];?\n?/g,
    ""
  );

  return preamble + transformed;
}

/**
 * Find the exported React component from a module.
 * Tries various common export patterns.
 *
 * @param module - The imported module object
 * @param compositionId - The composition ID to look for as named export
 * @returns The found component or null
 */
function findExportedComponent(
  module: Record<string, unknown>,
  compositionId: string
): unknown {
  // Priority order for finding the component:

  // 1. Default export
  if (module.default && typeof module.default === "function") {
    return module.default;
  }

  // 2. Named export matching composition ID
  if (module[compositionId] && typeof module[compositionId] === "function") {
    return module[compositionId];
  }

  // 3. Named export matching composition ID with common suffixes
  const variations = [
    compositionId,
    `${compositionId}Composition`,
    `${compositionId}Component`,
  ];
  for (const name of variations) {
    if (module[name] && typeof module[name] === "function") {
      return module[name];
    }
  }

  // 4. First function export (as fallback)
  for (const value of Object.values(module)) {
    if (typeof value === "function") {
      return value;
    }
  }

  return null;
}

/**
 * Load multiple components from a batch of bundles.
 *
 * @param bundles - Array of bundle info with code and composition IDs
 * @returns Map of composition ID to load result
 */
export async function loadBundledComponents(
  bundles: Array<{
    compositionId: string;
    componentId: string;
    bundledCode: string;
  }>
): Promise<Map<string, DynamicLoadResult>> {
  const results = new Map<string, DynamicLoadResult>();

  // Load components sequentially to avoid overwhelming the browser
  for (const bundle of bundles) {
    const result = await loadBundledComponent(
      bundle.bundledCode,
      bundle.compositionId,
      bundle.componentId
    );
    results.set(bundle.componentId, result);
  }

  return results;
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Cleanup function to be called when the app unmounts.
 * Revokes all blob URLs to prevent memory leaks.
 */
export function cleanupDynamicLoader(): void {
  clearComponentCache();
}

// Register cleanup on page unload
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", cleanupDynamicLoader);
}

export default {
  loadBundledComponent,
  loadBundledComponents,
  getCachedComponent,
  isComponentCached,
  removeCachedComponent,
  clearComponentCache,
  getCacheStats,
  cleanupDynamicLoader,
  setupGlobalsForDynamicImport,
};
