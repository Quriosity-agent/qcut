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
				resumeQuit();
			});
		return true;
	};
}
