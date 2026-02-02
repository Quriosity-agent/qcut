/**
 * Component Validator
 *
 * Validates Remotion component code for security and correctness.
 * Ensures components don't use forbidden APIs and have required metadata.
 *
 * @module lib/remotion/component-validator
 */

import type { RemotionComponentCategory } from "./types";

// ============================================================================
// Types
// ============================================================================

/**
 * Metadata extracted from component code
 */
export interface ComponentMetadata {
  /** Component name */
  name: string;
  /** Component description */
  description?: string;
  /** Component category */
  category: RemotionComponentCategory;
  /** Duration in frames */
  durationInFrames: number;
  /** Frames per second */
  fps: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Whether component has a Zod schema */
  hasSchema: boolean;
  /** Whether component has default props */
  hasDefaultProps: boolean;
  /** Detected exports */
  exports: string[];
  /** Tags/keywords */
  tags?: string[];
  /** Version if specified */
  version?: string;
  /** Author if specified */
  author?: string;
}

/**
 * Result of validating a component
 */
export interface ValidationResult {
  /** Whether the component is valid */
  valid: boolean;
  /** Validation errors (blocking) */
  errors: string[];
  /** Validation warnings (non-blocking) */
  warnings: string[];
  /** Extracted metadata if validation passed */
  metadata?: ComponentMetadata;
}

/**
 * Options for component validation
 */
export interface ValidationOptions {
  /** Whether to allow network access */
  allowNetwork?: boolean;
  /** Whether to allow file system access */
  allowFileSystem?: boolean;
  /** Whether to allow dynamic imports */
  allowDynamicImports?: boolean;
  /** Maximum allowed file size in bytes */
  maxFileSizeBytes?: number;
  /** Whether to require a Zod schema */
  requireSchema?: boolean;
  /** Whether to require default props */
  requireDefaultProps?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default validation options
 */
export const DEFAULT_VALIDATION_OPTIONS: ValidationOptions = {
  allowNetwork: false,
  allowFileSystem: false,
  allowDynamicImports: false,
  maxFileSizeBytes: 500 * 1024, // 500KB
  requireSchema: true,
  requireDefaultProps: true,
};

/**
 * Forbidden API patterns (regex patterns for code analysis)
 */
const FORBIDDEN_PATTERNS: Array<{
  pattern: RegExp;
  message: string;
  severity: "error" | "warning";
}> = [
  // File system access
  {
    pattern: /\bfs\b|\brequire\s*\(\s*['"]fs['"]/,
    message: "File system access (fs) is not allowed",
    severity: "error",
  },
  {
    pattern: /\bpath\b\.|\brequire\s*\(\s*['"]path['"]/,
    message: "Path module access is not allowed",
    severity: "error",
  },
  {
    pattern: /\bchild_process\b/,
    message: "Child process access is not allowed",
    severity: "error",
  },

  // Network access
  {
    pattern: /\bfetch\s*\(/,
    message: "Network fetch is not allowed in components",
    severity: "error",
  },
  {
    pattern: /\bXMLHttpRequest\b/,
    message: "XMLHttpRequest is not allowed",
    severity: "error",
  },
  {
    pattern: /\bWebSocket\b/,
    message: "WebSocket is not allowed",
    severity: "error",
  },
  {
    pattern: /\baxios\b/,
    message: "Axios HTTP client is not allowed",
    severity: "error",
  },

  // Dangerous globals
  {
    pattern: /\beval\s*\(/,
    message: "eval() is not allowed",
    severity: "error",
  },
  {
    pattern: /\bFunction\s*\(/,
    message: "Function constructor is not allowed",
    severity: "error",
  },
  {
    pattern: /\bprocess\.env\b/,
    message: "Environment variable access is not allowed",
    severity: "error",
  },
  {
    pattern: /\bglobal\b|\bglobalThis\b/,
    message: "Global object access is not allowed",
    severity: "error",
  },

  // DOM manipulation (should use React patterns)
  {
    pattern: /\bdocument\.write\b/,
    message: "document.write is not allowed",
    severity: "error",
  },
  {
    pattern: /\binnerHTML\s*=/,
    message: "Direct innerHTML assignment is not recommended",
    severity: "warning",
  },

  // Electron/Node specific
  {
    pattern: /\brequire\s*\(\s*['"]electron['"]/,
    message: "Electron access is not allowed",
    severity: "error",
  },
  {
    pattern: /\bwindow\.electronAPI\b/,
    message: "Electron API access is not allowed",
    severity: "error",
  },

  // Storage (should be controlled by QCut)
  {
    pattern: /\blocalStorage\b/,
    message: "localStorage access is not allowed in components",
    severity: "warning",
  },
  {
    pattern: /\bsessionStorage\b/,
    message: "sessionStorage access is not allowed in components",
    severity: "warning",
  },
  {
    pattern: /\bindexedDB\b/,
    message: "IndexedDB access is not allowed in components",
    severity: "warning",
  },
];

/**
 * Required exports for a valid Remotion component
 */
const REQUIRED_EXPORTS = ["component", "schema", "defaultProps"] as const;

/**
 * Common Remotion imports that are expected
 */
const REMOTION_IMPORTS = [
  "remotion",
  "@remotion/player",
  "@remotion/bundler",
  "@remotion/renderer",
];

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Check code against forbidden patterns
 */
function checkForbiddenPatterns(
  code: string,
  options: ValidationOptions
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const { pattern, message, severity } of FORBIDDEN_PATTERNS) {
    // Skip network checks if allowed
    if (options.allowNetwork && message.toLowerCase().includes("network")) {
      continue;
    }

    // Skip filesystem checks if allowed
    if (options.allowFileSystem && message.toLowerCase().includes("file")) {
      continue;
    }

    if (pattern.test(code)) {
      if (severity === "error") {
        errors.push(message);
      } else {
        warnings.push(message);
      }
    }
  }

  return { errors, warnings };
}

/**
 * Check for dynamic imports
 */
function checkDynamicImports(
  code: string,
  options: ValidationOptions
): string[] {
  if (options.allowDynamicImports) {
    return [];
  }

  const errors: string[] = [];

  // Check for dynamic import()
  if (/\bimport\s*\(/.test(code)) {
    errors.push("Dynamic imports are not allowed");
  }

  // Check for require with variables
  if (/\brequire\s*\([^'"]+\)/.test(code)) {
    errors.push("Dynamic require is not allowed");
  }

  return errors;
}

/**
 * Extract component metadata from code
 */
function extractMetadata(code: string): Partial<ComponentMetadata> {
  const metadata: Partial<ComponentMetadata> = {
    exports: [],
  };

  // Extract component name
  const nameMatch = code.match(
    /(?:export\s+const|const)\s+(\w+)Definition\s*[:=]/
  );
  if (nameMatch) {
    metadata.name = nameMatch[1];
  }

  // Check for schema export
  if (/(?:export\s+const|const)\s+\w+Schema\s*=/.test(code)) {
    metadata.hasSchema = true;
    metadata.exports?.push("schema");
  }

  // Check for default props export
  if (/(?:export\s+const|const)\s+\w+[Dd]efault[Pp]rops\s*[:=]/.test(code)) {
    metadata.hasDefaultProps = true;
    metadata.exports?.push("defaultProps");
  }

  // Check for component export
  if (
    /(?:export\s+const|export\s+function|export\s+default)\s+\w+/.test(code)
  ) {
    metadata.exports?.push("component");
  }

  // Extract category
  const categoryMatch = code.match(/category\s*:\s*['"](\w+)['"]/);
  if (categoryMatch) {
    metadata.category = categoryMatch[1] as RemotionComponentCategory;
  }

  // Extract duration
  const durationMatch = code.match(/durationInFrames\s*:\s*(\d+)/);
  if (durationMatch) {
    metadata.durationInFrames = parseInt(durationMatch[1], 10);
  }

  // Extract fps
  const fpsMatch = code.match(/fps\s*:\s*(\d+)/);
  if (fpsMatch) {
    metadata.fps = parseInt(fpsMatch[1], 10);
  }

  // Extract dimensions
  const widthMatch = code.match(/width\s*:\s*(\d+)/);
  if (widthMatch) {
    metadata.width = parseInt(widthMatch[1], 10);
  }

  const heightMatch = code.match(/height\s*:\s*(\d+)/);
  if (heightMatch) {
    metadata.height = parseInt(heightMatch[1], 10);
  }

  // Extract description
  const descMatch = code.match(/description\s*:\s*['"]([^'"]+)['"]/);
  if (descMatch) {
    metadata.description = descMatch[1];
  }

  // Extract tags
  const tagsMatch = code.match(/tags\s*:\s*\[([^\]]+)\]/);
  if (tagsMatch) {
    const tagsStr = tagsMatch[1];
    metadata.tags = tagsStr
      .split(",")
      .map((t) => t.trim().replace(/['"]/g, ""))
      .filter(Boolean);
  }

  // Extract version
  const versionMatch = code.match(/version\s*:\s*['"]([^'"]+)['"]/);
  if (versionMatch) {
    metadata.version = versionMatch[1];
  }

  // Extract author
  const authorMatch = code.match(/author\s*:\s*['"]([^'"]+)['"]/);
  if (authorMatch) {
    metadata.author = authorMatch[1];
  }

  return metadata;
}

/**
 * Check for required Remotion imports
 */
function checkRemotionImports(code: string): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  let hasRemotionImport = false;

  for (const importPath of REMOTION_IMPORTS) {
    if (
      code.includes(`from "${importPath}"`) ||
      code.includes(`from '${importPath}'`)
    ) {
      hasRemotionImport = true;
      break;
    }
  }

  if (!hasRemotionImport) {
    warnings.push("Component does not import from Remotion packages");
  }

  return { valid: true, warnings };
}

/**
 * Check file size
 */
function checkFileSize(code: string, options: ValidationOptions): string[] {
  const errors: string[] = [];
  const sizeBytes = new Blob([code]).size;

  if (options.maxFileSizeBytes && sizeBytes > options.maxFileSizeBytes) {
    errors.push(
      `File size (${Math.round(sizeBytes / 1024)}KB) exceeds maximum allowed (${Math.round(options.maxFileSizeBytes / 1024)}KB)`
    );
  }

  return errors;
}

/**
 * Check for React component patterns
 */
function checkReactPatterns(code: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Must import React
  if (!code.includes("react") && !code.includes("React")) {
    errors.push("Component must import React");
  }

  // Should use hooks from Remotion
  if (!code.includes("useCurrentFrame") && !code.includes("useVideoConfig")) {
    warnings.push(
      "Component does not use Remotion hooks (useCurrentFrame, useVideoConfig)"
    );
  }

  // Check for component function
  const hasComponentFunction =
    /(?:function|const)\s+\w+\s*(?::\s*React\.FC|\([^)]*\)\s*(?:=>|{))/.test(
      code
    );

  if (!hasComponentFunction) {
    errors.push("No React component function found");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================================
// Main Validation Function
// ============================================================================

/**
 * Validate a Remotion component
 *
 * @param code - The component source code to validate
 * @param options - Validation options
 * @returns Validation result with errors, warnings, and metadata
 */
export function validateComponent(
  code: string,
  options: ValidationOptions = DEFAULT_VALIDATION_OPTIONS
): ValidationResult {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  // Merge options with defaults
  const opts = { ...DEFAULT_VALIDATION_OPTIONS, ...options };

  // Check file size
  const sizeErrors = checkFileSize(code, opts);
  allErrors.push(...sizeErrors);

  // Check forbidden patterns
  const { errors: patternErrors, warnings: patternWarnings } =
    checkForbiddenPatterns(code, opts);
  allErrors.push(...patternErrors);
  allWarnings.push(...patternWarnings);

  // Check dynamic imports
  const dynamicErrors = checkDynamicImports(code, opts);
  allErrors.push(...dynamicErrors);

  // Check Remotion imports
  const { warnings: importWarnings } = checkRemotionImports(code);
  allWarnings.push(...importWarnings);

  // Check React patterns
  const { errors: reactErrors, warnings: reactWarnings } =
    checkReactPatterns(code);
  allErrors.push(...reactErrors);
  allWarnings.push(...reactWarnings);

  // Extract metadata
  const metadata = extractMetadata(code);

  // Check required metadata
  if (opts.requireSchema && !metadata.hasSchema) {
    allErrors.push("Component must export a Zod schema");
  }

  if (opts.requireDefaultProps && !metadata.hasDefaultProps) {
    allErrors.push("Component must export default props");
  }

  if (!metadata.category) {
    allWarnings.push("Component category not detected");
  }

  if (!metadata.durationInFrames) {
    allWarnings.push("Duration in frames not detected");
  }

  if (!metadata.fps) {
    allWarnings.push("FPS not detected, will use project default");
  }

  // Build complete metadata if valid
  let completeMetadata: ComponentMetadata | undefined;
  if (allErrors.length === 0) {
    completeMetadata = {
      name: metadata.name || "Unknown Component",
      description: metadata.description,
      category: metadata.category || "animation",
      durationInFrames: metadata.durationInFrames || 90,
      fps: metadata.fps || 30,
      width: metadata.width || 1920,
      height: metadata.height || 1080,
      hasSchema: metadata.hasSchema || false,
      hasDefaultProps: metadata.hasDefaultProps || false,
      exports: metadata.exports || [],
      tags: metadata.tags,
      version: metadata.version,
      author: metadata.author,
    };
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
    metadata: completeMetadata,
  };
}

/**
 * Quick validation check without full analysis
 * Useful for real-time validation while typing
 */
export function quickValidate(code: string): {
  valid: boolean;
  error?: string;
} {
  // Basic checks
  if (!code || code.trim().length === 0) {
    return { valid: false, error: "Empty code" };
  }

  if (code.length > 1000 * 1024) {
    return { valid: false, error: "File too large" };
  }

  // Check for obvious forbidden patterns
  if (/\beval\s*\(/.test(code)) {
    return { valid: false, error: "eval() is not allowed" };
  }

  if (/\bchild_process\b/.test(code)) {
    return { valid: false, error: "child_process is not allowed" };
  }

  return { valid: true };
}

export default validateComponent;
