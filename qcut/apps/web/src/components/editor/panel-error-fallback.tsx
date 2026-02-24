import React from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PanelErrorFallbackProps {
	error: Error;
	errorInfo: React.ErrorInfo;
	errorId: string;
	resetError: () => void;
	isolate?: boolean;
	name: string;
}

export function PanelErrorFallback({
	error,
	errorId,
	resetError,
	name,
}: PanelErrorFallbackProps) {
	return (
		<div className="flex h-full w-full items-center justify-center p-4">
			<div className="flex flex-col items-center gap-3 text-center max-w-xs">
				<AlertTriangle
					className="h-8 w-8 text-destructive"
					aria-hidden="true"
				/>
				<div>
					<p className="text-sm font-medium">{name} — Something went wrong</p>
					<p className="mt-1 text-xs text-muted-foreground break-all">
						{error.message}
					</p>
				</div>
				<Button type="button" variant="outline" size="sm" onClick={resetError}>
					<RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
					Retry
				</Button>
				<p className="text-[0.65rem] text-muted-foreground font-mono">
					{errorId}
				</p>
			</div>
		</div>
	);
}
