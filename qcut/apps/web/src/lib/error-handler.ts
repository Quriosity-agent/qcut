import { toast } from "sonner";

/**
 * Enhanced error handling system for QCut
 * Replaces scattered console.error calls with user-friendly notifications
 */

export enum ErrorSeverity {
  LOW = "low",
  MEDIUM = "medium", 
  HIGH = "high",
  CRITICAL = "critical"
}

export enum ErrorCategory {
  NETWORK = "network",
  VALIDATION = "validation", 
  STORAGE = "storage",
  MEDIA_PROCESSING = "media_processing",
  AI_SERVICE = "ai_service",
  EXPORT = "export",
  AUTH = "auth",
  UI = "ui",
  SYSTEM = "system",
  UNKNOWN = "unknown"
}

export interface ErrorContext {
  operation: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  metadata?: Record<string, any>;
  showToast?: boolean;
  userId?: string;
  sessionId?: string;
}

export interface ProcessedError {
  id: string;
  timestamp: string;
  message: string;
  originalError: Error | unknown;
  context: ErrorContext;
  stack?: string;
}

// Generate unique error ID
const generateErrorId = (): string => {
  return `ERR-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
};

// Get user-friendly error messages
const getUserFriendlyMessage = (error: Error | unknown, context: ErrorContext): string => {
  const fallbackMessage = "An unexpected error occurred";
  
  if (error instanceof Error) {
    // Common patterns to make more user-friendly
    const message = error.message;
    
    if (context.category === ErrorCategory.NETWORK) {
      if (message.includes("fetch")) return "Network connection failed. Please check your internet connection.";
      if (message.includes("timeout")) return "Request timed out. Please try again.";
      if (message.includes("404")) return "The requested resource was not found.";
      if (message.includes("500")) return "Server error occurred. Please try again later.";
    }
    
    if (context.category === ErrorCategory.STORAGE) {
      if (message.includes("quota")) return "Storage space is full. Please free up space and try again.";
      if (message.includes("permission")) return "Storage permission denied. Please check browser settings.";
    }
    
    if (context.category === ErrorCategory.MEDIA_PROCESSING) {
      if (message.includes("codec")) return "Video format not supported. Please try a different file.";
      if (message.includes("memory")) return "File too large to process. Please try a smaller file.";
    }
    
    if (context.category === ErrorCategory.AI_SERVICE) {
      if (message.includes("API key")) return "AI service configuration issue. Please check settings.";
      if (message.includes("quota") || message.includes("limit")) return "AI service usage limit reached. Please try again later.";
    }
    
    if (context.category === ErrorCategory.EXPORT) {
      if (message.includes("ffmpeg")) return "Video export failed. Please try again or use different settings.";
      if (message.includes("codec")) return "Export codec not supported. Please try different export settings.";
    }
    
    // If no specific pattern matches, return the original message if it's user-friendly
    if (message.length < 100 && !message.includes("stack") && !message.includes("TypeError")) {
      return message;
    }
  }
  
  return fallbackMessage;
};

// Get appropriate toast duration based on severity
const getToastDuration = (severity: ErrorSeverity): number => {
  switch (severity) {
    case ErrorSeverity.LOW: return 4000;
    case ErrorSeverity.MEDIUM: return 6000;
    case ErrorSeverity.HIGH: return 8000;
    case ErrorSeverity.CRITICAL: return 12000;
    default: return 6000;
  }
};

// Enhanced error logging with structured format (development only)
const logError = (processedError: ProcessedError): void => {
  // Only log to console in development mode
  if (!import.meta.env.DEV) {
    // In production, send to error tracking service instead
    // TODO: Integrate with error tracking service (e.g., Sentry)
    return;
  }
  
  const { id, context, originalError, timestamp } = processedError;
  
  // Structured console logging for development
  console.group(`🚨 Error ${id} [${context.severity.toUpperCase()}]`);
  console.log("Timestamp:", timestamp);
  console.log("Operation:", context.operation);
  console.log("Category:", context.category);
  console.log("Severity:", context.severity);
  
  if (originalError instanceof Error) {
    console.error("Original Error:", originalError);
    if (originalError.stack) {
      console.error("Stack Trace:", originalError.stack);
    }
  } else {
    console.error("Error Value:", originalError);
  }
  
  if (context.metadata && Object.keys(context.metadata).length > 0) {
    console.log("Metadata:", context.metadata);
  }
  
  console.groupEnd();
};

/**
 * Main error handling function
 * Replaces console.error patterns throughout the codebase
 */
export const handleError = (
  error: Error | unknown,
  context: ErrorContext
): ProcessedError => {
  const processedError: ProcessedError = {
    id: generateErrorId(),
    timestamp: new Date().toISOString(),
    message: getUserFriendlyMessage(error, context),
    originalError: error,
    context,
    stack: error instanceof Error ? error.stack : undefined
  };

  // Always log to console with enhanced formatting
  logError(processedError);

  // Show toast notification if enabled (default: true)
  if (context.showToast !== false) {
    const toastOptions = {
      duration: getToastDuration(context.severity),
      action: {
        label: "Copy ID",
        onClick: () => navigator.clipboard.writeText(processedError.id)
      }
    };

    switch (context.severity) {
      case ErrorSeverity.LOW:
        toast(processedError.message, {
          ...toastOptions,
          description: `${context.operation} (${processedError.id})`
        });
        break;
      
      case ErrorSeverity.MEDIUM:
        toast.warning(processedError.message, {
          ...toastOptions,
          description: `${context.operation} (${processedError.id})`
        });
        break;
      
      case ErrorSeverity.HIGH:
        toast.error(processedError.message, {
          ...toastOptions,
          description: `${context.operation} (${processedError.id})`
        });
        break;
      
      case ErrorSeverity.CRITICAL:
        toast.error(processedError.message, {
          ...toastOptions,
          description: `Critical error in ${context.operation} (${processedError.id})`,
          duration: 15000 // Longer duration for critical errors
        });
        break;
    }
  }

  // TODO: Send to error tracking service
  // sendToErrorTrackingService(processedError);

  return processedError;
};

/**
 * Convenience functions for common error scenarios
 */

export const handleNetworkError = (
  error: Error | unknown,
  operation: string,
  metadata?: Record<string, any>
): ProcessedError => {
  return handleError(error, {
    operation,
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.MEDIUM,
    metadata
  });
};

export const handleValidationError = (
  error: Error | unknown,
  operation: string,
  metadata?: Record<string, any>
): ProcessedError => {
  return handleError(error, {
    operation,
    category: ErrorCategory.VALIDATION,
    severity: ErrorSeverity.LOW,
    metadata
  });
};

export const handleStorageError = (
  error: Error | unknown,
  operation: string,
  metadata?: Record<string, any>
): ProcessedError => {
  return handleError(error, {
    operation,
    category: ErrorCategory.STORAGE,
    severity: ErrorSeverity.HIGH,
    metadata
  });
};

export const handleMediaProcessingError = (
  error: Error | unknown,
  operation: string,
  metadata?: Record<string, any>
): ProcessedError => {
  return handleError(error, {
    operation,
    category: ErrorCategory.MEDIA_PROCESSING,
    severity: ErrorSeverity.HIGH,
    metadata
  });
};

export const handleAIServiceError = (
  error: Error | unknown,
  operation: string,
  metadata?: Record<string, any>
): ProcessedError => {
  return handleError(error, {
    operation,
    category: ErrorCategory.AI_SERVICE,
    severity: ErrorSeverity.MEDIUM,
    metadata
  });
};

export const handleExportError = (
  error: Error | unknown,
  operation: string,
  metadata?: Record<string, any>
): ProcessedError => {
  return handleError(error, {
    operation,
    category: ErrorCategory.EXPORT,
    severity: ErrorSeverity.CRITICAL,
    metadata
  });
};

/**
 * Async wrapper for operations that might throw errors
 * Automatically handles errors and provides proper user feedback
 */
export const withErrorHandling = async <T>(
  operation: () => Promise<T>,
  context: ErrorContext
): Promise<T | null> => {
  try {
    return await operation();
  } catch (error) {
    handleError(error, context);
    return null;
  }
};

/**
 * Hook for error handling in React components
 */
export const useErrorHandler = () => {
  return {
    handleError,
    handleNetworkError,
    handleValidationError,
    handleStorageError,
    handleMediaProcessingError,
    handleAIServiceError,
    handleExportError,
    withErrorHandling,
    safeAsync,
    safeAsyncWithFallback,
    withAsyncErrorHandling,
  };
};

/**
 * Safe async operation wrapper that handles errors gracefully
 * 
 * @param fn - Async function to execute safely
 * @param errorContext - Context information for error handling
 * @returns Result of the async operation or null on error
 */
export const safeAsync = async <T>(
  fn: () => Promise<T>,
  errorContext: Partial<ErrorContext>
): Promise<T | null> => {
  try {
    return await fn();
  } catch (error) {
    handleError(error, {
      operation: "Safe async operation",
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.MEDIUM,
      showToast: true,
      ...errorContext
    });
    return null;
  }
};

/**
 * Safe async operation wrapper with custom fallback value
 * 
 * @param fn - Async function to execute safely
 * @param fallbackValue - Value to return on error
 * @param errorContext - Context information for error handling
 * @returns Result of the async operation or fallback value on error
 */
export const safeAsyncWithFallback = async <T>(
  fn: () => Promise<T>,
  fallbackValue: T,
  errorContext: Partial<ErrorContext>
): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    handleError(error, {
      operation: "Safe async operation with fallback",
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.MEDIUM,
      showToast: true,
      ...errorContext
    });
    return fallbackValue;
  }
};

/**
 * Higher-order function that wraps async functions with error handling
 * 
 * @param fn - Async function to wrap
 * @param errorContext - Context information for error handling
 * @returns Wrapped async function that handles errors gracefully
 */
export const withAsyncErrorHandling = <TArgs extends any[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  errorContext: Partial<ErrorContext>
) => {
  return async (...args: TArgs): Promise<TReturn | null> => {
    return safeAsync(() => fn(...args), errorContext);
  };
};

/**
 * Batch async operation handler for multiple operations
 * 
 * @param operations - Array of async operations with their contexts
 * @param options - Options for batch processing
 * @returns Results of all operations, null for failed ones
 */
export const safeBatchAsync = async <T>(
  operations: Array<{
    fn: () => Promise<T>;
    context: Partial<ErrorContext>;
  }>,
  options?: {
    continueOnError?: boolean;
    showProgress?: boolean;
  }
): Promise<Array<T | null>> => {
  const results: Array<T | null> = [];
  const continueOnError = options?.continueOnError ?? true;

  for (let i = 0; i < operations.length; i++) {
    const { fn, context } = operations[i];
    
    try {
      const result = await safeAsync(fn, {
        ...context,
        metadata: {
          ...context.metadata,
          batchIndex: i,
          totalOperations: operations.length,
        }
      });
      results.push(result);
    } catch (error) {
      if (!continueOnError) {
        throw error;
      }
      results.push(null);
    }
  }

  return results;
};

/**
 * Retry async operation wrapper with exponential backoff
 * 
 * @param fn - Async function to retry
 * @param errorContext - Context information for error handling
 * @param options - Retry options
 * @returns Result of the async operation or null after all retries
 */
export const safeAsyncWithRetry = async <T>(
  fn: () => Promise<T>,
  errorContext: Partial<ErrorContext>,
  options?: {
    maxRetries?: number;
    backoffMs?: number;
    exponentialBackoff?: boolean;
  }
): Promise<T | null> => {
  const maxRetries = options?.maxRetries ?? 3;
  const baseBackoffMs = options?.backoffMs ?? 1000;
  const exponentialBackoff = options?.exponentialBackoff ?? true;
  
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        // Final attempt failed, handle error
        handleError(error, {
          operation: "Safe async operation with retry",
          category: ErrorCategory.UNKNOWN,
          severity: ErrorSeverity.MEDIUM,
          showToast: true,
          ...errorContext,
          metadata: {
            ...errorContext.metadata,
            totalAttempts: attempt + 1,
            maxRetries,
          }
        });
        return null;
      }
      
      // Wait before retry
      const backoffTime = exponentialBackoff 
        ? baseBackoffMs * Math.pow(2, attempt)
        : baseBackoffMs;
      
      await new Promise(resolve => setTimeout(resolve, backoffTime));
    }
  }
  
  return null;
};

export default handleError;