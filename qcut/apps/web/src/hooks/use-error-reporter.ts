/**
 * Error Reporting Hook
 *
 * Custom React hook for consistent error reporting within components.
 * Provides a simple interface for reporting errors with component context.
 */

import { useCallback, useRef } from "react";
import { handleError, ErrorCategory, ErrorSeverity } from "@/lib/debug/error-handler";
import { getErrorContext, getMinimalErrorContext } from "@/lib/debug/error-context";

interface ErrorReportOptions {
	category?: ErrorCategory;
	severity?: ErrorSeverity;
	showToast?: boolean;
	includeContext?: boolean;
	metadata?: Record<string, any>;
}

/**
 * Basic error reporter hook for component-level error handling
 *
 * @param componentName - Name of the component for error context
 * @returns Error reporting function
 */
export const useErrorReporter = (componentName: string) => {
	const componentRef = useRef(componentName);

	// Update component name if it changes
	componentRef.current = componentName;

	return useCallback(
		(error: unknown, operation: string, options?: ErrorReportOptions) => {
			const processedError =
				error instanceof Error ? error : new Error(String(error));

			handleError(processedError, {
				operation: `${componentRef.current}: ${operation}`,
				category: options?.category || ErrorCategory.UI,
				severity: options?.severity || ErrorSeverity.MEDIUM,
				showToast: options?.showToast ?? true,
				metadata: {
					component: componentRef.current,
					...(options?.includeContext ? getMinimalErrorContext() : {}),
					...options?.metadata,
				},
			});
		},
		[]
	); // Empty dependency array since we use refs
};

/**
 * Enhanced error reporter with automatic context capture
 *
 * @param componentName - Name of the component for error context
 * @param defaultOptions - Default options for all error reports
 * @returns Enhanced error reporting function
 */
export const useEnhancedErrorReporter = (
	componentName: string,
	defaultOptions?: ErrorReportOptions
) => {
	const componentRef = useRef(componentName);
	const optionsRef = useRef(defaultOptions);

	// Update refs if they change
	componentRef.current = componentName;
	optionsRef.current = defaultOptions;

	const reportError = useCallback(
		async (error: unknown, operation: string, options?: ErrorReportOptions) => {
			const processedError =
				error instanceof Error ? error : new Error(String(error));
			const mergedOptions = { ...optionsRef.current, ...options };

			// Get context based on options
			const context =
				mergedOptions.includeContext !== false
					? await getErrorContext()
					: getMinimalErrorContext();

			handleError(processedError, {
				operation: `${componentRef.current}: ${operation}`,
				category: mergedOptions.category || ErrorCategory.UI,
				severity: mergedOptions.severity || ErrorSeverity.MEDIUM,
				showToast: mergedOptions.showToast ?? true,
				metadata: {
					component: componentRef.current,
					...context,
					...mergedOptions.metadata,
				},
			});
		},
		[]
	);

	const reportAsyncError = useCallback(
		async (
			errorPromise: Promise<any>,
			operation: string,
			options?: ErrorReportOptions
		) => {
			try {
				return await errorPromise;
			} catch (error) {
				await reportError(error, operation, options);
				throw error; // Re-throw to maintain error flow
			}
		},
		[reportError]
	);

	const withErrorReporting = useCallback(
		<TArgs extends unknown[], TReturn>(
			fn: (...args: TArgs) => Promise<TReturn>,
			operation: string,
			options?: ErrorReportOptions
		): ((...args: TArgs) => Promise<TReturn>) => {
			return async (...args: TArgs): Promise<TReturn> => {
				try {
					return await fn(...args);
				} catch (err) {
					await reportError(err, operation, options);
					throw err;
				}
			};
		},
		[reportError]
	);

	return {
		reportError,
		reportAsyncError,
		withErrorReporting,
	};
};

/**
 * Async error handler hook for promise-based operations
 *
 * @param componentName - Name of the component for error context
 * @returns Async error handling utilities
 */
export const useAsyncErrorHandler = (componentName: string) => {
	const { reportError, reportAsyncError } = useEnhancedErrorReporter(
		componentName,
		{
			category: ErrorCategory.UI,
			severity: ErrorSeverity.MEDIUM,
			includeContext: false, // Performance optimization
		}
	);

	const handleAsync = useCallback(
		async <T>(
			operation: () => Promise<T>,
			operationName: string,
			options?: {
				onError?: (error: unknown) => void;
				showToast?: boolean;
				fallbackValue?: T;
			}
		): Promise<T | undefined> => {
			try {
				return await operation();
			} catch (error) {
				await reportError(error, operationName, {
					showToast: options?.showToast ?? true,
				});

				// Call custom error handler if provided
				options?.onError?.(error);

				// Return fallback value if provided
				return options?.fallbackValue;
			}
		},
		[reportError]
	);

	const safeAsync = useCallback(
		<T>(
			operation: () => Promise<T>,
			operationName: string,
			fallbackValue: T
		): Promise<T> => {
			return handleAsync(operation, operationName, {
				fallbackValue,
				showToast: false,
			}).then((result) => result ?? fallbackValue);
		},
		[handleAsync]
	);

	return {
		handleAsync,
		safeAsync,
		reportAsyncError,
	};
};

/**
 * Critical error reporter for high-severity errors
 *
 * @param componentName - Name of the component for error context
 * @returns Critical error reporting function
 */
export const useCriticalErrorReporter = (componentName: string) => {
	return useEnhancedErrorReporter(componentName, {
		category: ErrorCategory.UI,
		severity: ErrorSeverity.CRITICAL,
		includeContext: true, // Always include context for critical errors
		showToast: true,
	});
};

/**
 * Performance-optimized error reporter for high-frequency operations
 *
 * @param componentName - Name of the component for error context
 * @returns Lightweight error reporting function
 */
export const useLightweightErrorReporter = (componentName: string) => {
	return useErrorReporter(componentName);
};

export default useErrorReporter;
