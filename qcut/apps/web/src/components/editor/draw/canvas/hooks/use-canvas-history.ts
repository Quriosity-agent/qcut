import { useEffect, type RefObject } from "react";
import { debug } from "../canvas-utils";

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
	getCurrentHistoryState: () => string | undefined;
	getCanvasDataUrl: () => string | null;
	loadDrawingFromDataUrl: (dataUrl: string) => Promise<void>;
	isSavingToHistory: RefObject<boolean>;
	recentObjectCreation: RefObject<boolean>;
}) {
	// Handle undo/redo by restoring canvas state from history
	useEffect(() => {
		const historyState = getCurrentHistoryState();
		if (historyState && historyState !== getCanvasDataUrl()) {
			debug("🔄 DRAW - History restoration triggered:", {
				historyIndex,
			});
		}

		// Skip restoration if we're currently saving to history or recently created object
		if (isSavingToHistory.current || recentObjectCreation.current) {
			debug("🚫 DRAW - Skipping restoration:", {
				saving: isSavingToHistory.current,
				recentCreation: recentObjectCreation.current,
			});
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
				debug(
					"⚠️ DRAW - Restoring canvas from history (objects will be cleared)",
					{
						historyStateLength: historyState.length,
						currentStateLength: currentCanvasData.length,
						sizeDifference: Math.abs(
							historyState.length - currentCanvasData.length
						),
					}
				);
				loadDrawingFromDataUrl(historyState).catch(() => {
					// Error handled inside loadDrawingFromDataUrl
				});
			} else {
				debug("🚫 DRAW - Skipping restoration due to minimal difference:", {
					sizeDifference: Math.abs(
						historyState.length - currentCanvasData.length
					),
				});
			}
		}
	}, [
		historyIndex,
		getCurrentHistoryState,
		getCanvasDataUrl,
		loadDrawingFromDataUrl,
	]);
}
