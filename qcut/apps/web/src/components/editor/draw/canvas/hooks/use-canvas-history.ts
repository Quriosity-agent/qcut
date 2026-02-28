import { useEffect, type RefObject } from "react";

/**
 * Hook for history restoration (undo/redo) with debounce protection.
 */
export function useCanvasHistory({
	historyIndex,
	getCurrentHistoryState,
	getCanvasDataUrl,
	loadDrawingFromDataUrl,
	isSavingToHistory,
	recentObjectCreation,
}: {
	historyIndex: number;
	getCurrentHistoryState: () => string | null;
	getCanvasDataUrl: () => string | null;
	loadDrawingFromDataUrl: (dataUrl: string) => Promise<void>;
	isSavingToHistory: RefObject<boolean>;
	recentObjectCreation: RefObject<boolean>;
}) {
	// Handle undo/redo by restoring canvas state from history
	useEffect(() => {
		const historyState = getCurrentHistoryState();
		// Debug: Only log if there's an issue
		if (
			import.meta.env.DEV &&
			historyState &&
			historyState !== getCanvasDataUrl()
		) {
			console.log("🔄 DRAW DEBUG - History restoration triggered:", {
				historyIndex,
			});
		}

		// Skip restoration if we're currently saving to history or recently created object
		if (isSavingToHistory.current || recentObjectCreation.current) {
			if (import.meta.env.DEV) {
				console.log("🚫 DRAW DEBUG - Skipping restoration:", {
					saving: isSavingToHistory.current,
					recentCreation: recentObjectCreation.current,
				});
			}
			return;
		}

		// Add debounce protection for rapid restoration calls
		const currentCanvasData = getCanvasDataUrl();
		if (
			historyState &&
			currentCanvasData &&
			historyState !== currentCanvasData
		) {
			// Additional protection: only restore if the difference is significant enough
			if (Math.abs(historyState.length - currentCanvasData.length) > 100) {
				console.warn(
					"⚠️ DRAW DEBUG - Restoring canvas from history (objects will be cleared)",
					{
						historyStateLength: historyState.length,
						currentStateLength: currentCanvasData.length,
						sizeDifference: Math.abs(
							historyState.length - currentCanvasData.length
						),
					}
				);
				loadDrawingFromDataUrl(historyState);
			} else {
				if (import.meta.env.DEV) {
					console.log(
						"🚫 DRAW DEBUG - Skipping restoration due to minimal difference:",
						{
							sizeDifference: Math.abs(
								historyState.length - currentCanvasData.length
							),
						}
					);
				}
			}
		}
	}, [
		historyIndex,
		getCurrentHistoryState,
		getCanvasDataUrl,
		loadDrawingFromDataUrl,
	]);
}
