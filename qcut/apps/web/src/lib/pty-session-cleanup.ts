import { debugError } from "@/lib/debug-config";
import { usePtyTerminalStore } from "@/stores/pty-terminal-store";

type CleanupErrorHandler = (message: string, error: unknown) => void;

interface CleanupPtyOnEditorExitOptions {
  onError?: CleanupErrorHandler;
}

export function cleanupPtyOnEditorExit({
  onError = debugError,
}: CleanupPtyOnEditorExitOptions = {}): void {
  try {
    const { sessionId, disconnect } = usePtyTerminalStore.getState();
    if (!sessionId) {
      return;
    }
    disconnect().catch((error) => {
      onError("[Editor] Failed to disconnect PTY on editor unmount", error);
    });
  } catch (error) {
    onError("[Editor] Unexpected PTY cleanup failure", error);
  }
}
