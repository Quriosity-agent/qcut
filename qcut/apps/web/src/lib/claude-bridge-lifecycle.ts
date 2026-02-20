import { debugError } from "@/lib/debug-config";
import {
	cleanupClaudeProjectBridge,
	cleanupClaudeTimelineBridge,
	setupClaudeProjectBridge,
	setupClaudeTimelineBridge,
} from "@/lib/claude-timeline-bridge";

type ClaudeBridgeErrorHandler = (message: string, error: unknown) => void;

interface SetupClaudeBridgeLifecycleOptions {
	onError?: ClaudeBridgeErrorHandler;
}

interface RunBridgeStepInput {
	message: string;
	step: () => void;
	onError: ClaudeBridgeErrorHandler;
}

function runBridgeStep({ message, step, onError }: RunBridgeStepInput): void {
	try {
		step();
	} catch (error) {
		onError(message, error);
	}
}

export function setupClaudeBridgeLifecycle({
	onError = debugError,
}: SetupClaudeBridgeLifecycleOptions = {}): () => void {
	runBridgeStep({
		message: "[ClaudeBridge] Failed to setup timeline bridge",
		step: setupClaudeTimelineBridge,
		onError,
	});
	runBridgeStep({
		message: "[ClaudeBridge] Failed to setup project bridge",
		step: setupClaudeProjectBridge,
		onError,
	});

	return () => {
		runBridgeStep({
			message: "[ClaudeBridge] Failed to cleanup timeline bridge",
			step: cleanupClaudeTimelineBridge,
			onError,
		});
		runBridgeStep({
			message: "[ClaudeBridge] Failed to cleanup project bridge",
			step: cleanupClaudeProjectBridge,
			onError,
		});
	};
}
