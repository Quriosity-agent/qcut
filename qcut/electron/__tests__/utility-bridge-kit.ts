/**
 * The bridge between the utility process and the main process, as tests
 * wire it up.
 *
 * All of the bridge's own code runs: the utility side's requests with their
 * wait and their deadline, and the main side's answering of one
 * (utility-main-requests.ts). What is asked goes over a real message port
 * pair, the kind of port the utility process has to the main one: a message
 * is copied as the port copies it, and arrives when the port delivers it.
 * Both ends are in the test's own process; a second copy of a module stands
 * in for the other process where a test needs one.
 */
import { MessageChannel } from "node:worker_threads";
import type {
	MainResponseMessage,
	UtilityMainRequestMessage,
} from "../utility/utility-ipc-types.js";
import {
	answerMainRequest,
	createMainRequests,
} from "../utility/utility-main-requests.js";
import { handleWindowFreeMediaRequest } from "../utility/utility-media-bridge.js";
import type { UtilityRequestFromMain } from "../utility/utility-timeline-accessor.js";

export interface TestBridge {
	/** What the utility process calls to ask the main process. */
	requestFromMain: UtilityRequestFromMain;
	/** The requests that went over, in order. */
	asked: UtilityMainRequestMessage[];
	/** What the main process answered, in order. */
	answers: MainResponseMessage[];
}

const open: MessageChannel[] = [];

/**
 * A bridge to a main process that does `handle` for each request: the
 * channel, what was asked, and when the asker stops waiting.
 */
export function bridgeToTheMainProcess({
	handle,
}: {
	handle: (
		channel: string,
		data: Record<string, unknown>,
		deadline?: number
	) => Promise<unknown>;
}): TestBridge {
	const ports = new MessageChannel();
	open.push(ports);
	const { port1: utilityPort, port2: mainPort } = ports;
	const asked: UtilityMainRequestMessage[] = [];
	const answers: MainResponseMessage[] = [];
	const requests = createMainRequests({
		post: (message) => {
			asked.push(message);
			utilityPort.postMessage(message);
		},
	});
	utilityPort.on("message", (answer: MainResponseMessage) => {
		requests.answered(answer);
	});
	mainPort.on("message", (request: UtilityMainRequestMessage) => {
		answerMainRequest({
			message: request,
			handle,
			post: (answer) => {
				answers.push(answer);
				mainPort.postMessage(answer);
			},
		});
	});
	return { requestFromMain: requests.requestFromMain, asked, answers };
}

/**
 * A bridge to a main process that does what it does for the media requests
 * that need no window (utility-media-bridge.ts): the notes of renames, and
 * the changes to restricted metadata.
 */
export function mediaBridgeToTheMainProcess(): TestBridge {
	return bridgeToTheMainProcess({
		handle: async (channel, data, deadline) => {
			const answer = handleWindowFreeMediaRequest({ channel, data, deadline });
			if (!answer) throw new Error(`Not a media request: ${channel}`);
			return answer;
		},
	});
}

/** Closes the ports of every bridge a test made. */
export function closeBridges(): void {
	for (const { port1, port2 } of open.splice(0)) {
		port1.close();
		port2.close();
	}
}
