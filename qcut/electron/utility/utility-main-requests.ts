/**
 * What the utility process asks of the main process, and how it is answered.
 *
 * The utility process serves the HTTP API. It has no window, no editor and
 * none of the main process's state: it asks the main process over the port
 * between the two, and waits a while for the answer. Both ends of that are
 * here, without the port itself: the asker (`createMainRequests`, used in
 * the utility process) and the answering of one request
 * (`answerMainRequest`, used in the main process).
 *
 * @module electron/utility/utility-main-requests
 */
import type {
	MainResponseMessage,
	UtilityMainRequestMessage,
} from "./utility-ipc-types.js";

/** How long a request waits for its answer, unless it says otherwise. */
export const MAIN_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Screen-recording start AND stop are both slow paths:
 *  - start: in standalone/headless mode the renderer is still booting React
 *    and its bridge listeners (5-15 s on a cold hidden window); the
 *    main-side handler itself waits up to 30 s.
 *  - stop: MediaRecorder flush and chunk writes take up to 30 s.
 * A shorter wait here would cut main's own wait short and report "Main
 * process request timed out" while the renderer is still coming up.
 */
const SCREEN_RECORDING_TIMEOUT_MS = 35_000;

export interface MainRequests {
	/**
	 * Sends a request to the main process and waits for its answer. It fails
	 * with "Main process request timed out" when none has come in time; the
	 * main process may still be at the request then, and is told with it
	 * when the wait ends (`deadline`), so that it can leave undone what
	 * nobody waits for any more.
	 */
	requestFromMain(
		channel: string,
		data: Record<string, unknown>,
		options?: { timeoutMs?: number }
	): Promise<unknown>;
	/** An answer of the main process has arrived. */
	answered(message: MainResponseMessage): void;
}

/** The requests of one utility process; `post` sends a message to main. */
export function createMainRequests({
	post,
}: {
	post: (message: UtilityMainRequestMessage) => void;
}): MainRequests {
	const pending = new Map<
		string,
		{ resolve: (value: unknown) => void; reject: (err: Error) => void }
	>();
	return {
		requestFromMain(channel, data, options = {}) {
			return new Promise((resolve, reject) => {
				const id = `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
				const timeoutMs =
					options.timeoutMs ??
					(channel.startsWith("screen-recording:")
						? SCREEN_RECORDING_TIMEOUT_MS
						: MAIN_REQUEST_TIMEOUT_MS);
				const timer = setTimeout(() => {
					pending.delete(id);
					reject(new Error(`Main process request timed out: ${channel}`));
				}, timeoutMs);

				pending.set(id, {
					resolve: (value: unknown) => {
						clearTimeout(timer);
						resolve(value);
					},
					reject: (err: Error) => {
						clearTimeout(timer);
						reject(err);
					},
				});

				// The deadline lets main skip work this request has stopped
				// waiting for.
				post({
					type: "main-request",
					id,
					channel,
					data,
					deadline: Date.now() + timeoutMs,
				});
			});
		},
		answered(message) {
			const waiting = pending.get(message.id);
			// Nobody waits any more: the request timed out.
			if (!waiting) return;
			pending.delete(message.id);
			if (message.error) {
				waiting.reject(new Error(message.error));
			} else {
				waiting.resolve(message.result);
			}
		},
	};
}

/**
 * Answers one request of the utility process, in the main process: has
 * `handle` do what was asked, with the time at which the asker stops
 * waiting, and posts back what came of it, or why it failed.
 */
export async function answerMainRequest({
	message,
	handle,
	post,
}: {
	message: UtilityMainRequestMessage;
	handle: (
		channel: string,
		data: Record<string, unknown>,
		deadline?: number
	) => Promise<unknown>;
	post: (message: MainResponseMessage) => void;
}): Promise<void> {
	try {
		const result = await handle(
			message.channel,
			message.data,
			message.deadline
		);
		post({ type: "main-response", id: message.id, result });
	} catch (err: unknown) {
		post({
			type: "main-response",
			id: message.id,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}
