/**
 * The message of an error that crossed the preload bridge, without Electron's
 * "Error invoking remote method 'channel': Error: " wrapper, so the editor
 * API and toasts show what actually went wrong.
 */
export function ipcErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(
		/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/u,
		""
	);
}
