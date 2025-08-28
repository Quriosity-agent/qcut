"use client";

import React from "react";
import { toast } from "sonner";
import { RefreshCw, AlertTriangle, Bug, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

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
  isolate = false
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
            <AlertTriangle className="w-6 h-6 text-destructive" />
          </div>
          <CardTitle className="text-xl font-semibold">Something went wrong</CardTitle>
          <CardDescription>
            {isolate 
              ? "This component encountered an error, but the rest of the app should continue working."
              : "An unexpected error occurred while rendering this page."
            }
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
            <Button onClick={resetError} variant="default" className="w-full">
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
            
            {!isolate && (
              <>
                <Button onClick={handleGoHome} variant="outline" className="w-full">
                  <Home className="w-4 h-4 mr-2" />
                  Go to Home
                </Button>
                
                <Button onClick={handleReload} variant="outline" className="w-full">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Reload Page
                </Button>
              </>
            )}
            
            <Button onClick={handleCopyError} variant="ghost" size="sm" className="w-full">
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
const logError = (error: Error, errorInfo: React.ErrorInfo, errorId: string) => {
  // Console logging with enhanced formatting
  console.group(`🚨 React Error Boundary - ${errorId}`);
  console.error("Error:", error);
  console.error("Component stack:", errorInfo.componentStack);
  console.error("Error stack:", error.stack);
  console.error("Timestamp:", new Date().toISOString());
  console.groupEnd();

  // Show toast notification
  toast.error(`Application Error (${errorId})`, {
    description: `${error.message}`,
    duration: 8000,
    action: {
      label: "Copy ID",
      onClick: () => navigator.clipboard.writeText(errorId)
    }
  });

  // TODO: Send to error tracking service (Sentry, etc.)
  // Example:
  // Sentry.captureException(error, {
  //   tags: { errorId, boundary: 'react' },
  //   contexts: { errorInfo }
  // });
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private errorId: string;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.errorId = generateErrorId();
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: this.errorId
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
      errorId: generateErrorId()
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.errorId = generateErrorId();
    this.setState({
      error,
      errorInfo,
      errorId: this.errorId
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
      errorId: this.errorId
    });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      const FallbackComponent = this.props.fallback || DefaultErrorFallback;
      
      return (
        <FallbackComponent
          error={this.state.error}
          errorInfo={this.state.errorInfo!}
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
      componentStack: new Error().stack || 'No stack available'
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
    onError?: (error: Error, errorInfo: React.ErrorInfo, errorId: string) => void;
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
  context: string = "Unknown operation",
  showToast: boolean = true
): void => {
  const errorId = generateErrorId();
  const processedError = error instanceof Error ? error : new Error(String(error));
  
  // Enhanced logging
  console.group(`⚠️ Async Error - ${errorId}`);
  console.error("Context:", context);
  console.error("Error:", processedError);
  console.error("Timestamp:", new Date().toISOString());
  console.groupEnd();

  if (showToast) {
    toast.error(`${context} failed (${errorId})`, {
      description: processedError.message,
      duration: 6000,
      action: {
        label: "Copy ID",
        onClick: () => navigator.clipboard.writeText(errorId)
      }
    });
  }

  // TODO: Send to error tracking service
};

export default ErrorBoundary;