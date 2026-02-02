/**
 * Remotion Composition Parser
 *
 * Parses Root.tsx or index.tsx files to detect <Composition> elements
 * and extract metadata (id, component, dimensions, fps, duration).
 *
 * @module electron/remotion-composition-parser
 */

import * as fs from "fs/promises";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

/**
 * Information about a detected Remotion composition.
 */
export interface CompositionInfo {
  /** Unique composition ID from the id prop */
  id: string;
  /** Display name (defaults to id if not specified) */
  name: string;
  /** Duration in frames */
  durationInFrames: number;
  /** Frames per second */
  fps: number;
  /** Video width in pixels */
  width: number;
  /** Video height in pixels */
  height: number;
  /** Path to the component file (resolved from import) */
  componentPath: string;
  /** Original import path from the source */
  importPath: string;
  /** Line number in source for debugging */
  line: number;
}

/**
 * Result of parsing a Remotion project folder.
 */
export interface ParseResult {
  /** Whether the folder is a valid Remotion project */
  isValid: boolean;
  /** Path to the Root.tsx or equivalent file */
  rootFilePath: string | null;
  /** Detected compositions */
  compositions: CompositionInfo[];
  /** Any errors encountered during parsing */
  errors: string[];
}

/**
 * Import statement information.
 */
interface ImportInfo {
  /** The imported identifier (e.g., "MyComponent") */
  name: string;
  /** The import path (e.g., "./MyComponent" or "remotion") */
  path: string;
  /** Whether it's a default import */
  isDefault: boolean;
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

const LOG_PREFIX = "[RemotionParser]";

// ============================================================================
// Constants
// ============================================================================

/** Possible Root file locations in a Remotion project */
const ROOT_FILE_CANDIDATES = [
  "src/Root.tsx",
  "Root.tsx",
  "src/index.tsx",
  "src/Video.tsx",
];

/** Default composition values if not specified */
const DEFAULTS = {
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 150,
};

// ============================================================================
// Parsing Utilities
// ============================================================================

/**
 * Extract all import statements from source code.
 * Uses regex for lightweight parsing without requiring Babel in Electron.
 */
function extractImports(sourceCode: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  // Match: import X from "path" or import { X } from "path"
  const importRegex =
    /import\s+(?:(\w+)|(?:\{([^}]+)\}))\s+from\s+["']([^"']+)["']/g;

  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(sourceCode)) !== null) {
    const defaultImport = match[1];
    const namedImports = match[2];
    const importPath = match[3];

    if (defaultImport) {
      imports.push({
        name: defaultImport,
        path: importPath,
        isDefault: true,
      });
    }

    if (namedImports) {
      // Parse named imports: { A, B as C, D }
      const names = namedImports.split(",").map((s) => {
        const parts = s.trim().split(/\s+as\s+/);
        return parts[parts.length - 1].trim(); // Use alias if present
      });

      for (const name of names) {
        if (name) {
          imports.push({
            name,
            path: importPath,
            isDefault: false,
          });
        }
      }
    }
  }

  // Also match: import DefaultName, { Named } from "path"
  const mixedImportRegex =
    /import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;
  while ((match = mixedImportRegex.exec(sourceCode)) !== null) {
    const defaultImport = match[1];
    const namedImports = match[2];
    const importPath = match[3];

    imports.push({
      name: defaultImport,
      path: importPath,
      isDefault: true,
    });

    const names = namedImports.split(",").map((s) =>
      s
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim()
    );
    for (const name of names) {
      if (name) {
        imports.push({
          name,
          path: importPath,
          isDefault: false,
        });
      }
    }
  }

  return imports;
}

/**
 * Extract number value from a prop string.
 * Handles: 60, {60}, {CONSTANT}, expressions
 */
function extractNumberProp(propValue: string): number | null {
  // Direct number: 60
  const directMatch = propValue.match(/^(\d+)$/);
  if (directMatch) {
    return parseInt(directMatch[1], 10);
  }

  // JSX expression: {60} or { 60 }
  const exprMatch = propValue.match(/^\{[\s]*(\d+)[\s]*\}$/);
  if (exprMatch) {
    return parseInt(exprMatch[1], 10);
  }

  // Can't resolve dynamic expressions
  return null;
}

/**
 * Extract string value from a prop.
 * Handles: "value", 'value', {`value`}, {"value"}
 */
function extractStringProp(propValue: string): string | null {
  // Quoted string: "value" or 'value'
  const quotedMatch = propValue.match(/^["'](.+)["']$/);
  if (quotedMatch) {
    return quotedMatch[1];
  }

  // JSX expression with string: {"value"} or {`value`}
  const exprMatch = propValue.match(/^\{[\s]*["'`](.+)["'`][\s]*\}$/);
  if (exprMatch) {
    return exprMatch[1];
  }

  return null;
}

/**
 * Extract identifier from a prop (for component references).
 * Handles: {ComponentName}
 */
function extractIdentifierProp(propValue: string): string | null {
  const match = propValue.match(/^\{[\s]*(\w+)[\s]*\}$/);
  return match ? match[1] : null;
}

/**
 * Parse <Composition> elements from source code.
 */
function parseCompositions(
  sourceCode: string,
  imports: ImportInfo[],
  folderPath: string,
  rootFilePath: string
): { compositions: CompositionInfo[]; errors: string[] } {
  const compositions: CompositionInfo[] = [];
  const errors: string[] = [];

  // Match <Composition ... /> or <Composition ...>...</Composition>
  // This regex captures the props section
  const compositionRegex = /<Composition\s+([^>]+?)(?:\/>|>)/g;

  let match: RegExpExecArray | null;
  while ((match = compositionRegex.exec(sourceCode)) !== null) {
    const propsString = match[1];
    const matchIndex = match.index;

    // Calculate line number
    const lineNumber = sourceCode.substring(0, matchIndex).split("\n").length;

    // Parse individual props
    const propRegex = /(\w+)\s*=\s*(\{[^}]+\}|"[^"]*"|'[^']*'|\d+)/g;
    const props: Record<string, string> = {};

    let propMatch: RegExpExecArray | null;
    while ((propMatch = propRegex.exec(propsString)) !== null) {
      props[propMatch[1]] = propMatch[2];
    }

    // Extract required id prop
    const id = extractStringProp(props.id || "");
    if (!id) {
      errors.push(`Line ${lineNumber}: Composition missing 'id' prop`);
      continue;
    }

    // Extract component reference
    const componentRef = extractIdentifierProp(props.component || "");
    if (!componentRef) {
      errors.push(
        `Line ${lineNumber}: Composition "${id}" missing 'component' prop`
      );
      continue;
    }

    // Find the import for this component
    const componentImport = imports.find((imp) => imp.name === componentRef);
    let componentPath = "";
    let importPath = "";

    if (componentImport && componentImport.path.startsWith(".")) {
      importPath = componentImport.path;
      // Resolve relative import to absolute path
      const rootDir = path.dirname(rootFilePath);
      componentPath = path.resolve(rootDir, componentImport.path);

      // Add extension if not present
      if (!componentPath.match(/\.(tsx?|jsx?)$/)) {
        // Try common extensions
        const extensions = [".tsx", ".ts", ".jsx", ".js"];
        for (const ext of extensions) {
          const withExt = componentPath + ext;
          // We'll validate this exists later
          componentPath = withExt;
          break;
        }
      }
    } else if (componentImport) {
      // External package import - component defined elsewhere
      importPath = componentImport.path;
      componentPath = componentImport.path;
    } else {
      // Component might be defined in the same file
      importPath = "./" + path.basename(rootFilePath);
      componentPath = rootFilePath;
    }

    // Extract dimensions and timing
    const durationInFrames =
      extractNumberProp(props.durationInFrames || "") ??
      DEFAULTS.durationInFrames;
    const fps = extractNumberProp(props.fps || "") ?? DEFAULTS.fps;
    const width = extractNumberProp(props.width || "") ?? DEFAULTS.width;
    const height = extractNumberProp(props.height || "") ?? DEFAULTS.height;

    compositions.push({
      id,
      name: id, // Use id as name for now
      durationInFrames,
      fps,
      width,
      height,
      componentPath,
      importPath,
      line: lineNumber,
    });

    log.debug(`${LOG_PREFIX} Found composition: ${id} -> ${componentPath}`);
  }

  return { compositions, errors };
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Check if a folder is a valid Remotion project.
 */
export async function isRemotionProject(folderPath: string): Promise<boolean> {
  try {
    // Check for package.json with remotion dependency
    const packageJsonPath = path.join(folderPath, "package.json");
    const packageJsonContent = await fs.readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonContent);

    const hasDep = packageJson.dependencies?.remotion !== undefined;
    const hasDevDep = packageJson.devDependencies?.remotion !== undefined;

    if (!hasDep && !hasDevDep) {
      log.debug(`${LOG_PREFIX} No remotion dependency found in package.json`);
      return false;
    }

    // Check for Root.tsx or similar entry point
    for (const candidate of ROOT_FILE_CANDIDATES) {
      const candidatePath = path.join(folderPath, candidate);
      try {
        await fs.access(candidatePath);
        log.debug(`${LOG_PREFIX} Found Root file: ${candidate}`);
        return true;
      } catch {
        // File doesn't exist, try next
      }
    }

    log.debug(`${LOG_PREFIX} No Root.tsx found`);
    return false;
  } catch (error) {
    log.debug(`${LOG_PREFIX} Error checking project: ${error}`);
    return false;
  }
}

/**
 * Find the Root file in a Remotion project.
 */
export async function findRootFile(folderPath: string): Promise<string | null> {
  for (const candidate of ROOT_FILE_CANDIDATES) {
    const candidatePath = path.join(folderPath, candidate);
    try {
      await fs.access(candidatePath);
      return candidatePath;
    } catch {
      // File doesn't exist, try next
    }
  }
  return null;
}

/**
 * Parse a Remotion project folder and extract composition information.
 */
export async function parseRemotionProject(
  folderPath: string
): Promise<ParseResult> {
  const result: ParseResult = {
    isValid: false,
    rootFilePath: null,
    compositions: [],
    errors: [],
  };

  try {
    // Validate it's a Remotion project
    const isValid = await isRemotionProject(folderPath);
    if (!isValid) {
      result.errors.push(
        "Not a valid Remotion project. Ensure package.json contains 'remotion' dependency and Root.tsx exists."
      );
      return result;
    }

    // Find Root file
    const rootFilePath = await findRootFile(folderPath);
    if (!rootFilePath) {
      result.errors.push("Could not find Root.tsx or equivalent entry point.");
      return result;
    }

    result.rootFilePath = rootFilePath;
    result.isValid = true;

    log.info(`${LOG_PREFIX} Parsing: ${rootFilePath}`);

    // Read and parse the Root file
    const sourceCode = await fs.readFile(rootFilePath, "utf-8");

    // Extract imports
    const imports = extractImports(sourceCode);
    log.debug(`${LOG_PREFIX} Found ${imports.length} imports`);

    // Parse compositions
    const { compositions, errors } = parseCompositions(
      sourceCode,
      imports,
      folderPath,
      rootFilePath
    );

    result.compositions = compositions;
    result.errors.push(...errors);

    log.info(`${LOG_PREFIX} Found ${compositions.length} compositions`);

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`Parse error: ${message}`);
    log.error(`${LOG_PREFIX} Parse error:`, error);
    return result;
  }
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  isRemotionProject,
  findRootFile,
  parseRemotionProject,
};

export default {
  isRemotionProject,
  findRootFile,
  parseRemotionProject,
};
