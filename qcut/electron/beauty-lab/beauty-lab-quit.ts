export function createBeautyLabQuitGuard({
	resumeQuit,
	onError,
}: {
	resumeQuit: () => void;
	onError: (error: unknown) => void;
}) {
	let pending: Promise<void> | undefined;
	let completed = false;
	return function deferQuit({
		event,
		dispose,
	}: {
		event: { preventDefault: () => void };
		dispose?: () => Promise<void>;
	}) {
		if (completed || !dispose) return false;
		event.preventDefault();
		// Electron does not await async before-quit listeners.
		pending ??= Promise.resolve()
			.then(dispose)
			.catch(onError)
			.finally(() => {
				completed = true;
				// Never from inside before-quit (N27, 2026-10-30 trailer report):
				// a cleanup with nothing to wait for settles before this event's
				// listeners have all returned, and Electron then marks the quit
				// it started there as cancelled. Its windows still close, and
				// macOS keeps the windowless app running.
				setImmediate(resumeQuit);
			});
		return true;
	};
}
