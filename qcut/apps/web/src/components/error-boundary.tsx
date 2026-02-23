"use client";

import React from "react";
import { toast } from "sonner";
import { RefreshCw, AlertTriangle, Bug, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
	handleError,
	ErrorCategory,
	ErrorSeverity,
} from "@/lib/debug/error-handler";

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
	errorInfo: React.ErrorInfo | null;
	errorId: string;
}

interface ErrorBoundaryProps {
	children: React.ReactNode;
	fallback?: React.ComponentType<ErrorFallbackProps>;
	onError?: (error: Error, errorInfo: React.ErrorInfo, errorId: string) => void;
	isolate?: boolean; // If true, only affects this component tree, not global navigation
}

interface ErrorFallbackProps {
	error: Error;
	errorInfo: React.ErrorInfo;
	errorId: string;
	resetError: () => void;
	isolate?: boolean;
}

// Generate unique error ID for tracking
const generateErrorId = (): string => {
	return `ERR-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
};

// Default error fallback component
const DefaultErrorFallback: React.FC<ErrorFallbackProps> = ({
	error,
	errorId,
	resetError,
	isolate = false,
}) => {
	const handleReload = () => {
		window.location.reload();
	};

	const handleGoHome = () => {
		window.location.href = "/";
	};

	const handleCopyError = () => {
		const errorDetails = `Error ID: ${errorId}\nError: ${error.message}\nStack: ${error.stack}`;
		navigator.clipboard.writeText(errorDetails).then(() => {
			toast.success("Error details copied to clipboard");
		});
	};

	return (
		<div className="min-h-[400px] flex items-center justify-center p-6">
			<Card className="w-full max-w-md">
				<CardHeader className="text-center">
					<div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
						<AlertTriangle
							className="w-6 h-6 text-destructive"
							aria-hidden="true"
						/>
					</div>
					<CardTitle className="text-xl font-semibold">
						Something went wrong
					</CardTitle>
					<CardDescription>
						{isolate
							? "This component encountered an error, but the rest of the app should continue working."
							: "An unexpected error occurred while rendering this page."}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="text-sm text-muted-foreground">
						<p className="font-mono bg-muted p-2 rounded text-xs break-all">
							Error ID: {errorId}
						</p>
					</div>

					<Separator />

					<div className="flex flex-col gap-2">
						<Button
							type="button"
							onClick={resetError}
							variant="default"
							className="w-full"
						>
							<RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
							Try Again
						</Button>

						{!isolate && (
							<>
								<Button
									type="button"
									onClick={handleGoHome}
									variant="outline"
									className="w-full"
								>
									<Home className="w-4 h-4 mr-2" aria-hidden="true" />
									Go to Home
								</Button>

								<Button
									type="button"
									onClick={handleReload}
									variant="outline"
									className="w-full"
								>
									<RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
									Reload Page
								</Button>
							</>
						)}

						<Button
							type="button"
							onClick={handleCopyError}
							variant="outline"
							size="sm"
							className="w-full"
						>
							<Bug className="w-4 h-4 mr-2" />
							Copy Error Details
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
};

// Enhanced error logging
const logError = (
	error: Error,
	errorInfo: React.ErrorInfo,
	errorId: string
) => {
	// Use centralized error handler for consistent logging and tracking
	handleError(error, {
		operation: "React Error Boundary",
		category: ErrorCategory.UI,
		severity: ErrorSeverity.HIGH,
		showToast: false, // We'll show our own toast below with specific formatting
		metadata: {
			errorId,
			componentStack: errorInfo.componentStack,
			errorBoundary: true,
		},
	});

	// Show toast notification with error boundary specific formatting
	toast.error(`Application Error (${errorId})`, {
		description: `${error.message}`,
		duration: 8000,
		action: {
			label: "Copy ID",
			onClick: () => navigator.clipboard.writeText(errorId),
		},
	});
};

export class ErrorBoundary extends React.Component<
	ErrorBoundaryProps,
	ErrorBoundaryState
> {
	private errorId: string;

	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.errorId = generateErrorId();
		this.state = {
			hasError: false,
			error: null,
			errorInfo: null,
			errorId: this.errorId,
		};
	}

	static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
		return {
			hasError: true,
			error,
		};
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		this.errorId = generateErrorId();
		this.setState({
			error,
			errorInfo,
			errorId: this.errorId,
		});

		// Log the error
		logError(error, errorInfo, this.errorId);

		// Call custom error handler if provided
		if (this.props.onError) {
			this.props.onError(error, errorInfo, this.errorId);
		}
	}

	resetError = () => {
		this.errorId = generateErrorId();
		this.setState({
			hasError: false,
			error: null,
			errorInfo: null,
			errorId: this.errorId,
		});
	};

	render() {
		if (this.state.hasError && this.state.error) {
			const FallbackComponent = this.props.fallback || DefaultErrorFallback;
			const safeErrorInfo: React.ErrorInfo = this.state.errorInfo ?? {
				componentStack: "",
			};

			return (
				<FallbackComponent
					error={this.state.error}
					errorInfo={safeErrorInfo}
					errorId={this.state.errorId}
					resetError={this.resetError}
					isolate={this.props.isolate}
				/>
			);
		}

		return this.props.children;
	}
}

// Hook for manually triggering error boundaries in functional components
export const useErrorHandler = () => {
	return React.useCallback((error: Error) => {
		// Create a synthetic error info object
		const errorInfo: React.ErrorInfo = {
			componentStack:
				new Error("Component stack trace for error boundary").stack ||
				"No stack available",
		};

		const errorId = generateErrorId();
		logError(error, errorInfo, errorId);

		// Re-throw to trigger error boundary
		throw error;
	}, []);
};

// Higher-order component for wrapping functional components with error boundary
export const withErrorBoundary = <P extends object>(
	Component: React.ComponentType<P>,
	options?: {
		fallback?: React.ComponentType<ErrorFallbackProps>;
		onError?: (
			error: Error,
			errorInfo: React.ErrorInfo,
			errorId: string
		) => void;
		isolate?: boolean;
	}
) => {
	const WrappedComponent = (props: P) => (
		<ErrorBoundary {...options}>
			<Component {...props} />
		</ErrorBoundary>
	);

	WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;
	return WrappedComponent;
};

// Utility for async error handling in hooks and event handlers
export const handleAsyncError = (
	error: unknown,
	context = "Unknown operation",
	showToast = true
): void => {
	const processedError =
		error instanceof Error ? error : new Error(String(error));

	handleError(processedError, {
		operation: context,
		category: ErrorCategory.UI,
		severity: ErrorSeverity.MEDIUM,
		showToast,
		metadata: {
			source: "async-error-handler",
		},
	});
};

export default ErrorBoundary;
