// Error Fallback Component for Timeline Track
export const TimelineTrackErrorFallback = ({
	resetError,
}: {
	resetError: () => void;
}) => (
	<div className="h-16 bg-destructive/10 border border-destructive/20 rounded flex items-center justify-center text-sm text-destructive m-2">
		<span className="mr-2">⚠️ Track Error</span>
		<button
			onClick={resetError}
			className="underline hover:no-underline"
			type="button"
		>
			Retry
		</button>
	</div>
);