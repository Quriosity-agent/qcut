/**
 * Remotion Component Bundler
 *
 * Uses esbuild to bundle Remotion composition entry points with
 * all dependencies resolved. External packages (React, Remotion)
 * are excluded and loaded at runtime.
 *
 * @module electron/remotion-bundler
 */

import * as path from "path";
import * as fs from "fs/promises";
import type { CompositionInfo } from "./remotion-composition-parser";

// ============================================================================
// Types
// ============================================================================

/**
 * Result of bundling a single composition.
 */
export interface BundleResult {
  /** Composition ID */
  compositionId: string;
  /** Whether bundling was successful */
  success: boolean;
  /** Bundled JavaScript code (ESM format) */
  code?: string;
  /** Source map for debugging */
  sourceMap?: string;
  /** Error message if bundling failed */
  error?: string;
}

/**
 * Result of bundling multiple compositions.
 */
export interface BundleAllResult {
  /** Overall success (true if all succeeded) */
  success: boolean;
  /** Individual bundle results */
  results: BundleResult[];
  /** Number of successful bundles */
  successCount: number;
  /** Number of failed bundles */
  errorCount: number;
}

// ============================================================================
// Logger Setup
// ============================================================================

interface Logger {
  info(message?: unknown, ...optionalParams: unknown[]): void;
  warn(message?: unknown, ...optionalParams: unknown[]): void;
  error(message?: unknown, ...optionalParams: unknown[]): void;
  debug(message?: unknown, ...optionalParams: unknown[]): void;
}

let log: Logger;
try {
  log = require("electron-log");
} catch {
  const noop = (): void => {};
  log = { info: noop, warn: noop, error: noop, debug: noop };
}

const LOG_PREFIX = "[RemotionBundler]";

// ============================================================================
// esbuild Configuration
// ============================================================================

/**
 * Packages to treat as external (not bundled).
 * These are expected to be available at runtime.
 */
const EXTERNAL_PACKAGES = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "remotion",
  "@remotion/bundler",
  "@remotion/cli",
  "@remotion/eslint-config",
  "@remotion/google-fonts",
  "@remotion/lottie",
  "@remotion/media-utils",
  "@remotion/motion-blur",
  "@remotion/noise",
  "@remotion/paths",
  "@remotion/player",
  "@remotion/preload",
  "@remotion/renderer",
  "@remotion/shapes",
  "@remotion/tailwind",
  "@remotion/three",
  "@remotion/transitions",
  "@remotion/zod-types",
];

// ============================================================================
// Bundling Functions
// ============================================================================

/**
 * Get esbuild dynamically to avoid bundling issues.
 */
async function getEsbuild(): Promise<typeof import("esbuild")> {
  try {
    // Try to require esbuild
    return require("esbuild");
  } catch (error) {
    log.error(`${LOG_PREFIX} esbuild not available:`, error);
    throw new Error("esbuild is not installed. Run: npm install esbuild");
  }
}

/**
 * Bundle a single composition entry point.
 */
export async function bundleComposition(
  composition: CompositionInfo,
  folderPath: string
): Promise<BundleResult> {
  const { id, componentPath } = composition;

  log.info(`${LOG_PREFIX} Bundling composition: ${id}`);
  log.debug(`${LOG_PREFIX} Entry point: ${componentPath}`);

  try {
    const esbuild = await getEsbuild();

    // Verify the entry file exists
    let entryPath = componentPath;

    // Try to find the actual file with extension
    const extensions = ["", ".tsx", ".ts", ".jsx", ".js"];
    let foundPath: string | null = null;

    for (const ext of extensions) {
      const tryPath = componentPath.replace(/\.(tsx?|jsx?)$/, "") + ext;
      try {
        await fs.access(tryPath);
        foundPath = tryPath;
        break;
      } catch {
        // Try next extension
      }
    }

    if (!foundPath) {
      // Try the path as-is
      try {
        await fs.access(componentPath);
        foundPath = componentPath;
      } catch {
        return {
          compositionId: id,
          success: false,
          error: `Component file not found: ${componentPath}`,
        };
      }
    }

    entryPath = foundPath;
    log.debug(`${LOG_PREFIX} Resolved entry: ${entryPath}`);

    // Read source file to detect export type
    const sourceCode = await fs.readFile(entryPath, "utf-8");
    const normalizedPath = entryPath.replace(/\\/g, "/");

    // Check for default export (including re-exported default)
    const hasDefaultExport =
      /export\s+default\s/.test(sourceCode) ||
      /export\s*\{\s*default\s*(?:as\s+\w+)?\s*\}\s*(?:from\s*["'][^"']+["'])?/.test(
        sourceCode
      );
    // Check for named export matching composition ID
    // Escape regex metacharacters in ID to prevent ReDoS
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match direct exports (export const/function/class) and re-exports (export { Name })
    const hasNamedExport =
      new RegExp(
        `export\\s+(const|function|class)\\s+${escapedId}\\b`
      ).test(sourceCode) ||
      new RegExp(`export\\s*\\{[^}]*\\b${escapedId}\\b[^}]*\\}`).test(sourceCode);

    log.debug(
      `${LOG_PREFIX} Export detection for ${id}: hasDefault=${hasDefaultExport}, hasNamed=${hasNamedExport}`
    );

    // Generate wrapper based on detected export type
    let wrapperCode: string;
    if (hasNamedExport) {
      // Use named import
      wrapperCode = `
        export * from "${normalizedPath}";
        import { ${id} as Component } from "${normalizedPath}";
        export default Component;
      `;
    } else if (hasDefaultExport) {
      // Use default import
      wrapperCode = `
        export * from "${normalizedPath}";
        import Component from "${normalizedPath}";
        export default Component;
      `;
    } else {
      // Fallback: import everything and try to find a component
      // This handles cases like OnlyLogo -> Logo
      const componentNameMatch = sourceCode.match(
        /export\s+(?:const|function|class)\s+(\w+)/
      );
      const extractedName = componentNameMatch?.[1];
      // Validate that we have a proper JS identifier
      if (!extractedName || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(extractedName)) {
        return {
          compositionId: id,
          success: false,
          error: `No valid exported component found in ${entryPath} for composition "${id}"`,
        };
      }
      wrapperCode = `
        export * from "${normalizedPath}";
        import { ${extractedName} as Component } from "${normalizedPath}";
        export default Component;
      `;
    }

    // Bundle with esbuild
    const result = await esbuild.build({
      stdin: {
        contents: wrapperCode,
        resolveDir: path.dirname(entryPath),
        sourcefile: `${id}-wrapper.tsx`,
        loader: "tsx",
      },
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2020",
      external: EXTERNAL_PACKAGES,
      write: false,
      sourcemap: "inline",
      minify: false, // Keep readable for debugging
      treeShaking: true,
      loader: {
        ".tsx": "tsx",
        ".ts": "ts",
        ".jsx": "jsx",
        ".js": "js",
        ".css": "css",
        ".json": "json",
        ".png": "dataurl",
        ".jpg": "dataurl",
        ".jpeg": "dataurl",
        ".gif": "dataurl",
        ".svg": "dataurl",
        ".webp": "dataurl",
      },
      define: {
        "process.env.NODE_ENV": '"production"',
      },
      logLevel: "warning",
    });

    // Extract output
    const outputFile = result.outputFiles?.find(
      (f) => f.path.endsWith(".js") || f.path === "<stdout>"
    );

    if (!outputFile) {
      return {
        compositionId: id,
        success: false,
        error: "No output generated from esbuild",
      };
    }

    const code = outputFile.text;

    // Log warnings if any
    if (result.warnings.length > 0) {
      for (const warning of result.warnings) {
        log.warn(`${LOG_PREFIX} [${id}] ${warning.text}`);
      }
    }

    log.info(
      `${LOG_PREFIX} Successfully bundled: ${id} (${code.length} bytes)`
    );

    return {
      compositionId: id,
      success: true,
      code,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`${LOG_PREFIX} Bundle error for ${id}:`, error);

    return {
      compositionId: id,
      success: false,
      error: message,
    };
  }
}

/**
 * Bundle multiple compositions.
 */
export async function bundleCompositions(
  compositions: CompositionInfo[],
  folderPath: string
): Promise<BundleAllResult> {
  log.info(`${LOG_PREFIX} Bundling ${compositions.length} compositions`);

  const results: BundleResult[] = [];
  let successCount = 0;
  let errorCount = 0;

  for (const composition of compositions) {
    const result = await bundleComposition(composition, folderPath);
    results.push(result);

    if (result.success) {
      successCount++;
    } else {
      errorCount++;
    }
  }

  log.info(
    `${LOG_PREFIX} Bundle complete: ${successCount} success, ${errorCount} errors`
  );

  return {
    success: errorCount === 0,
    results,
    successCount,
    errorCount,
  };
}

/**
 * Check if esbuild is available.
 */
export async function isEsbuildAvailable(): Promise<boolean> {
  try {
    await getEsbuild();
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  bundleComposition,
  bundleCompositions,
  isEsbuildAvailable,
};

export default {
  bundleComposition,
  bundleCompositions,
  isEsbuildAvailable,
};
