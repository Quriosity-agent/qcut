interface FrameRenderJob {
	render: () => Promise<void>;
	signal?: AbortSignal;
	resolve: () => void;
	reject: (error: unknown) => void;
	abort: () => void;
}

export function createFrameRenderQueue() {
	let active = false;
	let pending: FrameRenderJob[] = [];
	const startNext = () => {
		if (active) return;
		const job = pending.shift();
		if (!job) return;
		active = true;
		job.signal?.removeEventListener("abort", job.abort);
		void Promise.resolve()
			.then(() => {
				job.signal?.throwIfAborted();
				return job.render();
			})
			.then(job.resolve, job.reject)
			.finally(() => {
				active = false;
				startNext();
			});
	};
	return ({
		render,
		signal,
	}: {
		render: () => Promise<void>;
		signal?: AbortSignal;
	}): Promise<void> => {
		if (signal?.aborted) return Promise.reject(signal.reason);
		return new Promise((resolve, reject) => {
			const job: FrameRenderJob = {
				render,
				signal,
				resolve,
				reject,
				abort: () => {
					pending = pending.filter((candidate) => candidate !== job);
					signal?.removeEventListener("abort", job.abort);
					reject(signal?.reason);
				},
			};
			pending.push(job);
			signal?.addEventListener("abort", job.abort, { once: true });
			startNext();
		});
	};
}
