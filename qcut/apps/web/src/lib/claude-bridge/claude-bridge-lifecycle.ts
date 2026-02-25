import { debugError } from "@/lib/debug/debug-config";
import {
	cleanupClaudeProjectBridge,
	cleanupClaudeTimelineBridge,
	setupClaudeProjectBridge,
	setupClaudeTimelineBridge,
} from "@/lib/claude-bridge/claude-timeline-bridge";
import {
	cleanupClaudeNavigatorBridge,
	setupClaudeNavigatorBridge,
} from "@/lib/claude-bridge/claude-navigator-bridge";
import {
	cleanupClaudeScreenRecordingBridge,
	setupClaudeScreenRecordingBridge,
} from "@/lib/claude-bridge/claude-screen-recording-bridge";
import {
	cleanupClaudeUiBridge,
	setupClaudeUiBridge,
} from "@/lib/claude-bridge/claude-ui-bridge";
import {
	cleanupClaudeProjectCrudBridge,
	setupClaudeProjectCrudBridge,
} from "@/lib/claude-bridge/claude-project-crud-bridge";
import {
	cleanupClaudeMoyinBridge,
	setupClaudeMoyinBridge,
} from "@/lib/claude-bridge/claude-moyin-bridge";

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
	runBridgeStep({
		message: "[ClaudeBridge] Failed to setup navigator bridge",
		step: setupClaudeNavigatorBridge,
		onError,
	});
	runBridgeStep({
		message: "[ClaudeBridge] Failed to setup screen recording bridge",
		step: setupClaudeScreenRecordingBridge,
		onError,
	});
	runBridgeStep({
		message: "[ClaudeBridge] Failed to setup UI bridge",
		step: setupClaudeUiBridge,
		onError,
	});
	runBridgeStep({
		message: "[ClaudeBridge] Failed to setup project CRUD bridge",
		step: setupClaudeProjectCrudBridge,
		onError,
	});
	runBridgeStep({
		message: "[ClaudeBridge] Failed to setup moyin bridge",
		step: setupClaudeMoyinBridge,
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
		runBridgeStep({
			message: "[ClaudeBridge] Failed to cleanup navigator bridge",
			step: cleanupClaudeNavigatorBridge,
			onError,
		});
		runBridgeStep({
			message: "[ClaudeBridge] Failed to cleanup screen recording bridge",
			step: cleanupClaudeScreenRecordingBridge,
			onError,
		});
		runBridgeStep({
			message: "[ClaudeBridge] Failed to cleanup UI bridge",
			step: cleanupClaudeUiBridge,
			onError,
		});
		runBridgeStep({
			message: "[ClaudeBridge] Failed to cleanup project CRUD bridge",
			step: cleanupClaudeProjectCrudBridge,
			onError,
		});
		runBridgeStep({
			message: "[ClaudeBridge] Failed to cleanup moyin bridge",
			step: cleanupClaudeMoyinBridge,
			onError,
		});
	};
}
