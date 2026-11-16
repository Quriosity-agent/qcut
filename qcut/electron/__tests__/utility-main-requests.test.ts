import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ userData: "" }));

vi.mock("electron", () => ({
	app: { getPath: vi.fn(() => testState.userData) },
	ipcMain: { handle: vi.fn() },
}));

vi.mock("electron-log", () => ({
	default: {
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}));

import {
	listUnsettledMediaRenames,
	noLongerAtWorkOnMediaRenames,
} from "../claude/handlers/claude-media-rename-note.js";
import type {
	MainResponseMessage,
	UtilityMainRequestMessage,
} from "../utility/utility-ipc-types.js";
import {
	answerMainRequest,
	createMainRequests,
	MAIN_REQUEST_TIMEOUT_MS,
} from "../utility/utility-main-requests.js";
import { handleWindowFreeMediaRequest } from "../utility/utility-media-bridge.js";
import { mediaRenameNotesThroughMain } from "../utility/utility-media-requests.js";

/**
 * The utility process serves the HTTP API and asks the main process for
 * what it cannot do itself. A request waits ten seconds for its answer. The
 * main process may get to it later than that: it is told when the wait
 * ends, so that it can leave undone what nobody waits for any more.
 */
describe("what the utility process asks of the main process", () => {
	const posted: UtilityMainRequestMessage[] = [];
	const requests = createMainRequests({
		post: (message) => posted.push(message),
	});

	beforeEach(() => {
		posted.length = 0;
		vi.useFakeTimers({
			toFake: ["setTimeout", "clearTimeout", "Date"],
			now: new Date("2026-11-17T08:00:00.000Z"),
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("goes over with the time at which the asker stops waiting", () => {
		const asked = Date.now();
		requests.requestFromMain("media:restricted-metadata", {
			change: "persist",
		});
		requests.requestFromMain("navigate-to-project", {}, { timeoutMs: 25_000 });
		requests.requestFromMain("screen-recording:stop", {});

		// Each under an id of its own, by which its answer is told.
		expect(new Set(posted.map(({ id }) => id)).size).toBe(3);
		expect(posted[0]).toMatchObject({
			type: "main-request",
			channel: "media:restricted-metadata",
			data: { change: "persist" },
			deadline: asked + MAIN_REQUEST_TIMEOUT_MS,
		});
		expect(MAIN_REQUEST_TIMEOUT_MS).toBe(10_000);
		expect(posted[1].deadline).toBe(asked + 25_000);
		// A recording takes longer to start and to stop.
		expect(posted[2].deadline).toBe(asked + 35_000);
	});

	it("is answered with what the main process says, or fails with its reason", async () => {
		const made = requests.requestFromMain("a", {});
		const refused = requests.requestFromMain("b", {});
		requests.answered({
			type: "main-response",
			id: posted[0].id,
			result: { written: { dev: "1", ino: "2" } },
		});
		requests.answered({
			type: "main-response",
			id: posted[1].id,
			error: "it was not made",
		});
		expect(await made).toEqual({ written: { dev: "1", ino: "2" } });
		await expect(refused).rejects.toThrow("it was not made");
	});

	it("fails when no answer has come by then, and has no use for one that comes later", async () => {
		const asked = requests
			.requestFromMain("media:restricted-metadata", {})
			.then(
				() => "answered",
				(error: unknown) => String(error)
			);
		await vi.advanceTimersByTimeAsync(MAIN_REQUEST_TIMEOUT_MS - 1);
		expect(posted).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(await asked).toBe(
			"Error: Main process request timed out: media:restricted-metadata"
		);
		// The main process got to it after all, and says so to nobody.
		expect(() =>
			requests.answered({
				type: "main-response",
				id: posted[0].id,
				result: "made",
			})
		).not.toThrow();
		expect(await asked).toContain("timed out");
	});

	it("does not fail a request that was answered in time once its wait is over", async () => {
		const asked = requests.requestFromMain("a", {});
		requests.answered({ type: "main-response", id: posted[0].id, result: 1 });
		await vi.advanceTimersByTimeAsync(MAIN_REQUEST_TIMEOUT_MS * 2);
		expect(await asked).toBe(1);
	});
});

describe("how the main process answers a request of the utility process", () => {
	const request: UtilityMainRequestMessage = {
		type: "main-request",
		id: "req-1",
		channel: "media:restricted-metadata",
		data: { change: "persist" },
		deadline: 1_794_902_410_000,
	};

	it("does what was asked, knowing when the asker stops waiting, and posts what came of it", async () => {
		const handle = vi.fn(async () => ({ made: true }));
		const answers: MainResponseMessage[] = [];
		await answerMainRequest({
			message: request,
			handle,
			post: (answer) => answers.push(answer),
		});
		expect(handle).toHaveBeenCalledWith(
			"media:restricted-metadata",
			{ change: "persist" },
			1_794_902_410_000
		);
		expect(answers).toEqual([
			{ type: "main-response", id: "req-1", result: { made: true } },
		]);
	});

	it("posts why it failed, in words: an error does not cross between the two", async () => {
		const answers: MainResponseMessage[] = [];
		await answerMainRequest({
			message: request,
			handle: async () => {
				throw new Error("it was not made");
			},
			post: (answer) => answers.push(answer),
		});
		await answerMainRequest({
			message: request,
			handle: async () => {
				throw "no reason given";
			},
			post: (answer) => answers.push(answer),
		});
		expect(answers).toEqual([
			{ type: "main-response", id: "req-1", error: "it was not made" },
			{ type: "main-response", id: "req-1", error: "no reason given" },
		]);
	});
});

/**
 * The notes of renames are the main process's to keep, and so is the
 * knowledge of which renames are being made. The HTTP API's process says
 * what it does to a file, over the same bridge.
 */
describe("the notes of renames, asked of the main process", () => {
	const OLD = "media_b2xkLm1wNA";
	const NEW = "media_bmV3Lm1wNA";
	const renamed = () => ({
		previous: {
			id: OLD,
			name: "old.mp4",
			path: path.join(testState.userData, "media", "old.mp4"),
		},
		id: NEW,
		name: "new.mp4",
		path: path.join(testState.userData, "media", "new.mp4"),
	});
	/** The bridge but for the port: a message crosses as a copy, a turn later. */
	function bridge() {
		const cross = <Message>(
			message: Message,
			deliver: (copy: Message) => void
		) => {
			const copy = structuredClone(message);
			setImmediate(() => deliver(copy));
		};
		const requests = createMainRequests({
			post: (message) =>
				cross(message, (request) => {
					answerMainRequest({
						message: request,
						handle: async (channel, data, deadline) => {
							const answer = handleWindowFreeMediaRequest({
								channel,
								data,
								deadline,
							});
							if (!answer) throw new Error(`Not a media request: ${channel}`);
							return answer;
						},
						post: (response) => cross(response, requests.answered),
					});
				}),
		});
		return mediaRenameNotesThroughMain({
			requestFromMain: requests.requestFromMain,
		});
	}
	const notes = () => listUnsettledMediaRenames({ projectId: "project-1" });

	beforeEach(async () => {
		testState.userData = await fs.mkdtemp(
			path.join(os.tmpdir(), "qcut-bridge-notes-")
		);
	});

	afterEach(async () => {
		noLongerAtWorkOnMediaRenames();
		await fs.rm(testState.userData, { recursive: true, force: true });
	});

	it("has the main process note a rename, know that it is being made, and drop the note", async () => {
		const asked = bridge();
		const say = (stage: "moving" | "back" | "stays" | "left") =>
			asked.noteUnsettledMediaRename({
				projectId: "project-1",
				renamed: renamed(),
				stage,
				by: "request-1",
			});

		await say("moving");
		expect(await notes()).toMatchObject([
			{ oldId: OLD, newId: NEW, atWork: true },
		]);
		await say("left");
		expect(await notes()).toMatchObject([{ atWork: false }]);

		await say("moving");
		await asked.forgetUnsettledMediaRename({
			projectId: "project-1",
			renamed: renamed(),
			by: "request-1",
		});
		expect(await notes()).toEqual([]);
	});

	it("tells the asker why a rename cannot be begun", async () => {
		const first = bridge();
		const second = bridge();
		await first.noteUnsettledMediaRename({
			projectId: "project-1",
			renamed: renamed(),
			stage: "moving",
			by: "request-1",
		});
		await expect(
			second.noteUnsettledMediaRename({
				projectId: "project-1",
				renamed: renamed(),
				stage: "moving",
				by: "request-2",
			})
		).rejects.toThrow(
			"Another request is renaming old.mp4 to new.mp4, or back, at this moment"
		);
	});

	it("answers nothing to what is not one of its channels", () => {
		expect(
			handleWindowFreeMediaRequest({ channel: "get-timeline", data: {} })
		).toBeUndefined();
	});
});
