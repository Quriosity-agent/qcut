/**
 * Folder Validator
 *
 * Client-side validation utilities for Remotion folder imports.
 * Provides error types and validation helpers.
 *
 * @module lib/remotion/folder-validator
 */

// ============================================================================
// Error Types
// ============================================================================

/**
 * Types of errors that can occur during folder import
 */
export type FolderImportErrorType =
  | "NOT_REMOTION_PROJECT"
  | "NO_COMPOSITIONS_FOUND"
  | "PARSE_ERROR"
  | "BUNDLE_ERROR"
  | "LOAD_ERROR"
  | "PERMISSION_DENIED"
  | "FOLDER_NOT_FOUND"
  | "UNKNOWN";

/**
 * Structured error for folder import operations
 */
export interface FolderImportError {
  /** Error type for programmatic handling */
  type: FolderImportErrorType;
  /** Human-readable error message */
  message: string;
  /** Composition ID if error is specific to one composition */
  compositionId?: string;
  /** Additional details for debugging */
  details?: string;
  /** Whether the error is recoverable */
  recoverable: boolean;
  /** Suggested recovery action */
  suggestion?: string;
}

// ============================================================================
// Error Factory Functions
// ============================================================================

/**
 * Create a "not a Remotion project" error
 */
export function createNotRemotionProjectError(
  folderPath: string,
  reason?: string
): FolderImportError {
  return {
    type: "NOT_REMOTION_PROJECT",
    message: `The selected folder is not a valid Remotion project`,
    details: reason || `Folder: ${folderPath}`,
    recoverable: true,
    suggestion: "Select a folder containing a Remotion project with Root.tsx or remotion.config.ts",
  };
}

/**
 * Create a "no compositions found" error
 */
export function createNoCompositionsError(folderPath: string): FolderImportError {
  return {
    type: "NO_COMPOSITIONS_FOUND",
    message: "No Remotion compositions found in the project",
    details: `No <Composition> elements detected in Root.tsx`,
    recoverable: true,
    suggestion: "Ensure your project has <Composition> elements defined in Root.tsx",
  };
}

/**
 * Create a parse error for a specific composition
 */
export function createParseError(
  compositionId: string,
  parseMessage: string
): FolderImportError {
  return {
    type: "PARSE_ERROR",
    message: `Failed to parse composition: ${compositionId}`,
    compositionId,
    details: parseMessage,
    recoverable: true,
    suggestion: "Check the component source for syntax errors",
  };
}

/**
 * Create a bundle error for a specific composition
 */
export function createBundleError(
  compositionId: string,
  bundleMessage: string
): FolderImportError {
  return {
    type: "BUNDLE_ERROR",
    message: `Failed to bundle composition: ${compositionId}`,
    compositionId,
    details: bundleMessage,
    recoverable: true,
    suggestion: "Check for missing dependencies or import errors",
  };
}

/**
 * Create a load error for a specific composition
 */
export function createLoadError(
  compositionId: string,
  loadMessage: string
): FolderImportError {
  return {
    type: "LOAD_ERROR",
    message: `Failed to load composition: ${compositionId}`,
    compositionId,
    details: loadMessage,
    recoverable: true,
    suggestion: "The component may have runtime errors - check the console",
  };
}

/**
 * Create a permission denied error
 */
export function createPermissionError(folderPath: string): FolderImportError {
  return {
    type: "PERMISSION_DENIED",
    message: "Permission denied when accessing the folder",
    details: `Cannot read folder: ${folderPath}`,
    recoverable: true,
    suggestion: "Check folder permissions or try running as administrator",
  };
}

/**
 * Create a folder not found error
 */
export function createFolderNotFoundError(folderPath: string): FolderImportError {
  return {
    type: "FOLDER_NOT_FOUND",
    message: "The specified folder was not found",
    details: `Path: ${folderPath}`,
    recoverable: true,
    suggestion: "Verify the folder path is correct",
  };
}

/**
 * Create an unknown error
 */
export function createUnknownError(message: string): FolderImportError {
  return {
    type: "UNKNOWN",
    message: "An unexpected error occurred",
    details: message,
    recoverable: false,
    suggestion: "Try again or report this issue",
  };
}

// ============================================================================
// Error Parsing
// ============================================================================

/**
 * Parse an error from the IPC layer into a structured error
 */
export function parseFolderImportError(
  error: string | Error | unknown
): FolderImportError {
  const message = error instanceof Error ? error.message : String(error);

  // Try to detect error type from message
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("not a remotion project") || lowerMessage.includes("root.tsx")) {
    return createNotRemotionProjectError("", message);
  }

  if (lowerMessage.includes("no compositions") || lowerMessage.includes("no composition")) {
    return createNoCompositionsError("");
  }

  if (lowerMessage.includes("permission") || lowerMessage.includes("access denied")) {
    return createPermissionError("");
  }

  if (lowerMessage.includes("not found") || lowerMessage.includes("enoent")) {
    return createFolderNotFoundError("");
  }

  if (lowerMessage.includes("parse") || lowerMessage.includes("syntax")) {
    return createParseError("unknown", message);
  }

  if (lowerMessage.includes("bundle") || lowerMessage.includes("esbuild")) {
    return createBundleError("unknown", message);
  }

  if (lowerMessage.includes("load") || lowerMessage.includes("import")) {
    return createLoadError("unknown", message);
  }

  return createUnknownError(message);
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate that a folder path looks like a Remotion project
 * This is a quick client-side check before sending to IPC
 */
export function validateFolderPath(folderPath: string): {
  valid: boolean;
  error?: string;
} {
  if (!folderPath) {
    return { valid: false, error: "No folder path provided" };
  }

  // Basic path validation
  if (folderPath.length < 3) {
    return { valid: false, error: "Folder path is too short" };
  }

  return { valid: true };
}

/**
 * Format error messages for display in UI
 */
export function formatErrorForDisplay(error: FolderImportError): string {
  let message = error.message;

  if (error.suggestion) {
    message += `\n\n${error.suggestion}`;
  }

  return message;
}

/**
 * Get error severity for UI styling
 */
export function getErrorSeverity(
  error: FolderImportError
): "error" | "warning" | "info" {
  switch (error.type) {
    case "NOT_REMOTION_PROJECT":
    case "NO_COMPOSITIONS_FOUND":
      return "warning";
    case "PARSE_ERROR":
    case "BUNDLE_ERROR":
      return "warning";
    case "LOAD_ERROR":
    case "PERMISSION_DENIED":
    case "FOLDER_NOT_FOUND":
      return "error";
    case "UNKNOWN":
    default:
      return "error";
  }
}

/**
 * Check if an error should show the retry button
 */
export function isRetryableError(error: FolderImportError): boolean {
  return error.recoverable && error.type !== "NOT_REMOTION_PROJECT";
}

export default {
  createNotRemotionProjectError,
  createNoCompositionsError,
  createParseError,
  createBundleError,
  createLoadError,
  createPermissionError,
  createFolderNotFoundError,
  createUnknownError,
  parseFolderImportError,
  validateFolderPath,
  formatErrorForDisplay,
  getErrorSeverity,
  isRetryableError,
};
