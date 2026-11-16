import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ documentsRoot: "" }));
const hooks = vi.hoisted(() => ({
	/** Runs right after a file was looked at, before whoever looked acts. */
	onLstat: undefined as undefined | ((filePath: string) => Promise<void>),
}));

vi.mock("electron", () => ({
	app: { getPath: vi.fn(() => testState.documentsRoot) },
	ipcMain: {
		handle: vi.fn(),
		on: vi.fn(),
		once: vi.fn(),
		removeListener: vi.fn(),
	},
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

vi.mock("node:fs/promises", async (importOriginal) => {
	const real = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...real,
		lstat: async (...args: Parameters<typeof real.lstat>) => {
			const seen = await real.lstat(...args);
			await hooks.onLstat?.(String(args[0]));
			return seen;
		},
	};
});

import * as fs from "node:fs/promises";
import {
	deleteMediaRestrictedMetadata,
	makeRestrictedMetadataChangesThrough,
	persistMediaRestrictedMetadata,
	type RestrictedMetadataChanges,
	readMediaRestrictedMetadata,
	stageMediaRestrictedMetadata,
} from "../claude/handlers/claude-media-restricted-metadata.js";
import type { MainResponseMessage } from "../utility/utility-ipc-types.js";
import {
	answerMainRequest,
	createMainRequests,
	MAIN_REQUEST_TIMEOUT_MS,
} from "../utility/utility-main-requests.js";
import { handleWindowFreeMediaRequest } from "../utility/utility-media-bridge.js";
import { restrictedMetadataChangesThroughMain } from "../utility/utility-media-requests.js";

const PROJECT_ID = "restricted-writers-test";
const MEDIA_ID = `media_${Buffer.from("wanted.gif").toString("base64url")}`;
const OURS = {
	animatedSticker: true,
	batchId: "jianying-2026-08-23-batch-18-v2",
	checksumSha256:
		"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
	itemId: "42001",
	redistribution: "prohibited",
	referenceOnly: true,
	source: "sticker-lab",
	usage: "internal-reference-only",
} as const;
/** Another file's metadata, as an import of that file writes it. */
const THEIRS = { ...OURS, itemId: "42002" } as const;

const stored = () =>
	readMediaRestrictedMetadata({ mediaId: MEDIA_ID, projectId: PROJECT_ID });

/**
 * Starts an import's write of its sidecar and gives it a moment: enough to
 * finish if nothing holds it back. The write is handed back inside an
 * object, so that waiting for this does not wait for the write.
 */
async function importArrives(): Promise<{ written: Promise<void> }> {
	const written = persistMediaRestrictedMetadata({
		mediaId: MEDIA_ID,
		metadata: THEIRS,
		projectId: PROJECT_ID,
	});
	await Promise.race([
		written,
		new Promise((resolve) => setTimeout(resolve, 60)),
	]);
	return { written };
}

/** Where the sidecars of the test project are. */
const sidecarFolder = () =>
	path.join(
		testState.documentsRoot,
		"QCut",
		"Projects",
		PROJECT_ID,
		"media",
		".qcut-restricted-media"
	);

/** Where the media file of the id would be: there is none in these tests. */
const MEDIA_FILE = () => path.join(sidecarFolder(), "..", "wanted.gif");

/**
 * The bridge between the two processes, as it is but for the port: the
 * utility process's requests with their wait and deadline
 * (utility-main-requests.ts), what it asks for sidecars
 * (utility-media-requests.ts), the main process's answering of a request,
 * and what it does for these channels (utility-media-bridge.ts). A message
 * crosses as a port carries it: as a copy, a turn of the event loop later.
 *
 * `asked` are the changes asked for, `answers` what the main process said.
 */
function bridgeToTheMainProcess(): {
	changes: RestrictedMetadataChanges;
	asked: string[];
	answers: MainResponseMessage[];
} {
	const asked: string[] = [];
	const answers: MainResponseMessage[] = [];
	const cross = <Message>(
		message: Message,
		deliver: (copy: Message) => void
	) => {
		const copy = structuredClone(message);
		setImmediate(() => deliver(copy));
	};
	const requests = createMainRequests({
		post: (message) => {
			asked.push(String(message.data.change));
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
					post: (response) => {
						answers.push(response);
						cross(response, requests.answered);
					},
				});
			});
		},
	});
	return {
		changes: restrictedMetadataChangesThroughMain({
			requestFromMain: requests.requestFromMain,
		}),
		asked,
		answers,
	};
}

/**
 * A media id's sidecar has several writers: an import puts one there, a
 * rename stages one ahead of the file and removes it again when the move
 * fails. Each looks at what is there and then acts. With another writer in
 * between, a rename that gave up removed the sidecar an import had just
 * written, and the imported file was left without its restriction.
 */
describe("writers of one restricted metadata sidecar", () => {
	beforeEach(async () => {
		testState.documentsRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "qcut-restricted-writers-")
		);
		hooks.onLstat = undefined;
	});

	afterEach(async () => {
		hooks.onLstat = undefined;
		makeRestrictedMetadataChangesThrough(undefined);
		vi.restoreAllMocks();
		await fs.rm(testState.documentsRoot, { recursive: true, force: true });
	});

	it("does not remove an import's sidecar that arrives while a staged one is being taken away", async () => {
		const staged = await stageMediaRestrictedMetadata({
			mediaId: MEDIA_ID,
			metadata: OURS,
			projectId: PROJECT_ID,
			mediaFilePath: MEDIA_FILE(),
		});
		expect(await stored()).toMatchObject({ itemId: "42001" });

		// The import's write arrives after the look at which file is there,
		// before its removal.
		let imported: { written: Promise<void> } | undefined;
		hooks.onLstat = async (filePath) => {
			if (!filePath.endsWith(".json") || imported) return;
			imported = { written: Promise.resolve() };
			imported = await importArrives();
		};
		await staged.discard();
		hooks.onLstat = undefined;
		await imported?.written;

		expect(await stored()).toMatchObject({ itemId: "42002" });
	});

	it("does not remove an import's sidecar that arrives while a left-over one is being replaced", async () => {
		// Left by a file that is gone, long ago.
		await persistMediaRestrictedMetadata({
			mediaId: MEDIA_ID,
			metadata: THEIRS,
			projectId: PROJECT_ID,
		});
		const sidecars = sidecarFolder();
		const [sidecar] = await fs.readdir(sidecars);
		const longAgo = new Date(Date.now() - 10 * 60_000);
		await fs.utimes(path.join(sidecars, sidecar), longAgo, longAgo);

		// The staging has found it left over; the import's write arrives as
		// it looks once more before removing it.
		let looks = 0;
		let imported: { written: Promise<void> } | undefined;
		hooks.onLstat = async (filePath) => {
			if (!filePath.endsWith(".json")) return;
			looks += 1;
			if (looks === 2) imported = await importArrives();
		};
		const staged = await stageMediaRestrictedMetadata({
			mediaId: MEDIA_ID,
			metadata: OURS,
			projectId: PROJECT_ID,
			mediaFilePath: MEDIA_FILE(),
		});
		hooks.onLstat = undefined;
		await imported?.written;
		// The import wrote last: its metadata is what the id has, and taking
		// the staged one away does not touch it.
		expect(await stored()).toMatchObject({ itemId: "42002" });
		await staged.discard();
		expect(await stored()).toMatchObject({ itemId: "42002" });
	});

	/**
	 * The HTTP API runs in a process of its own, and the desktop app's media
	 * handlers in the main one. Two processes that both changed sidecars
	 * would each look and then act, with the other in between; so the HTTP
	 * API's process changes none, and asks the main process for each change.
	 */
	describe("in the process that does not make the changes", () => {
		/** A second copy of the module stands in for that process. */
		async function inTheOtherProcess() {
			vi.resetModules();
			return import("../claude/handlers/claude-media-restricted-metadata.js");
		}

		it("asks for every change, and makes none itself", async () => {
			const other = await inTheOtherProcess();
			// Asked of nobody: what it would have done itself is not done.
			const asked: string[] = [];
			const nobody =
				(change: string, answer: unknown = undefined) =>
				async () => {
					asked.push(change);
					return answer;
				};
			other.makeRestrictedMetadataChangesThrough({
				persist: nobody("persist") as RestrictedMetadataChanges["persist"],
				stage: nobody("stage", {
					written: { dev: "1", ino: "2" },
				}) as RestrictedMetadataChanges["stage"],
				discard: nobody("discard") as RestrictedMetadataChanges["discard"],
				remove: nobody("remove") as RestrictedMetadataChanges["remove"],
			});

			await other.persistMediaRestrictedMetadata({
				mediaId: MEDIA_ID,
				metadata: OURS,
				projectId: PROJECT_ID,
			});
			const staged = await other.stageMediaRestrictedMetadata({
				mediaId: MEDIA_ID,
				metadata: OURS,
				projectId: PROJECT_ID,
				mediaFilePath: MEDIA_FILE(),
			});
			await staged.discard();
			await other.deleteMediaRestrictedMetadata({
				mediaId: MEDIA_ID,
				projectId: PROJECT_ID,
			});

			expect(asked).toEqual(["persist", "stage", "discard", "remove"]);
			await expect(fs.stat(sidecarFolder())).rejects.toMatchObject({
				code: "ENOENT",
			});
		});

		it("has the main process make them, and learns what came of them", async () => {
			const other = await inTheOtherProcess();
			const { changes, asked } = bridgeToTheMainProcess();
			other.makeRestrictedMetadataChangesThrough(changes);

			await other.persistMediaRestrictedMetadata({
				mediaId: MEDIA_ID,
				metadata: THEIRS,
				projectId: PROJECT_ID,
			});
			expect(await stored()).toMatchObject({ itemId: "42002" });

			// The id's metadata is a file's that is there: it is not staged over.
			await fs.writeFile(MEDIA_FILE(), "theirs");
			await expect(
				other.stageMediaRestrictedMetadata({
					mediaId: MEDIA_ID,
					metadata: OURS,
					projectId: PROJECT_ID,
					mediaFilePath: MEDIA_FILE(),
				})
			).rejects.toBeInstanceOf(other.RestrictedMetadataTakenError);
			expect(await stored()).toMatchObject({ itemId: "42002" });

			await other.deleteMediaRestrictedMetadata({
				mediaId: MEDIA_ID,
				projectId: PROJECT_ID,
			});
			expect(await stored()).toBeUndefined();

			// Staged, and taken away again by what the main process said it wrote.
			const staged = await other.stageMediaRestrictedMetadata({
				mediaId: MEDIA_ID,
				metadata: OURS,
				projectId: PROJECT_ID,
				mediaFilePath: MEDIA_FILE(),
			});
			expect(await stored()).toMatchObject({ itemId: "42001" });
			await staged.discard();
			expect(await stored()).toBeUndefined();
			expect(asked).toEqual(["persist", "stage", "remove", "stage", "discard"]);
		});

		/**
		 * A rename in the main process gives up, and is taking away what it
		 * staged: it has looked at which file is there, and then pauses. An
		 * import through the HTTP API arrives meanwhile. A lock with an age
		 * was taken from the paused cleanup after a while, the import wrote
		 * its metadata, and the cleanup went on to remove it.
		 */
		describe("when a cleanup pauses and an import arrives", () => {
			let goOn = () => {};
			let imported: Promise<string> | undefined;
			let bridge: ReturnType<typeof bridgeToTheMainProcess>;

			afterEach(() => {
				vi.useRealTimers();
			});

			/** The cleanup has looked, and waits; the import has been asked for. */
			async function pausedCleanup(): Promise<{ discarded: Promise<void> }> {
				const staged = await stageMediaRestrictedMetadata({
					mediaId: MEDIA_ID,
					metadata: OURS,
					projectId: PROJECT_ID,
					mediaFilePath: MEDIA_FILE(),
				});
				const other = await inTheOtherProcess();
				bridge = bridgeToTheMainProcess();
				other.makeRestrictedMetadataChangesThrough(bridge.changes);
				// From here on the test moves the clock: the bridge's own wait,
				// and the time the main process goes by, run on it.
				vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
				const paused = new Promise<void>((resolve) => {
					goOn = resolve;
				});
				imported = undefined;
				hooks.onLstat = async (filePath) => {
					if (!filePath.endsWith(".json") || imported) return;
					imported = other
						.persistMediaRestrictedMetadata({
							mediaId: MEDIA_ID,
							metadata: THEIRS,
							projectId: PROJECT_ID,
						})
						.then(
							() => "made",
							(error: unknown) => String(error)
						);
					await paused;
				};
				const discarded = staged.discard();
				await vi.waitFor(() => expect(bridge.asked).toEqual(["persist"]));
				return { discarded };
			}

			it("makes the import after the cleanup, when the cleanup goes on in time", async () => {
				const { discarded } = await pausedCleanup();
				// A while goes by, well within what the import waits.
				await vi.advanceTimersByTimeAsync(MAIN_REQUEST_TIMEOUT_MS / 2);
				expect(await stored()).toMatchObject({ itemId: "42001" });
				expect(bridge.answers).toEqual([]);

				goOn();
				await discarded;
				expect(await imported).toBe("made");
				hooks.onLstat = undefined;
				expect(await stored()).toMatchObject({ itemId: "42002" });
			});

			/**
			 * The import's process stops waiting after ten seconds and goes
			 * on as if the write had failed: it takes the imported file away
			 * again. Made when the cleanup finally goes on, the write would
			 * leave restricted metadata for a file that is not there, to
			 * stick to whatever file takes that name next.
			 */
			it("does not make the import once the one who asked has stopped waiting", async () => {
				const { discarded } = await pausedCleanup();
				// The cleanup pauses for an hour: the bridge gives up on the
				// import after its ten seconds.
				await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
				expect(await imported).toBe(
					"Error: Main process request timed out: media:restricted-metadata"
				);
				expect(await stored()).toMatchObject({ itemId: "42001" });
				expect(bridge.answers).toEqual([]);

				goOn();
				await discarded;
				hooks.onLstat = undefined;
				// The cleanup took its own away. The import's turn came, and the
				// main process says that it made nothing of it.
				await vi.waitFor(() => expect(bridge.answers).toHaveLength(1));
				expect(bridge.answers[0].error).toContain(
					"waited for its turn longer than the request for it; it was not made"
				);
				expect(await stored()).toBeUndefined();
				expect(
					(await fs.readdir(sidecarFolder())).filter((name) =>
						name.endsWith(".json")
					)
				).toEqual([]);
			});
		});
	});

	it("makes the changes to one sidecar in the order they were asked for", async () => {
		const order = await Promise.all([
			persistMediaRestrictedMetadata({
				mediaId: MEDIA_ID,
				metadata: OURS,
				projectId: PROJECT_ID,
			}).then(() => "first write"),
			deleteMediaRestrictedMetadata({
				mediaId: MEDIA_ID,
				projectId: PROJECT_ID,
			}).then(() => "removal"),
			persistMediaRestrictedMetadata({
				mediaId: MEDIA_ID,
				metadata: THEIRS,
				projectId: PROJECT_ID,
			}).then(() => "second write"),
		]);
		expect(order).toEqual(["first write", "removal", "second write"]);
		expect(await stored()).toMatchObject({ itemId: "42002" });

		// A removal asked for before a write does not come after it.
		await Promise.all([
			deleteMediaRestrictedMetadata({
				mediaId: MEDIA_ID,
				projectId: PROJECT_ID,
			}),
			persistMediaRestrictedMetadata({
				mediaId: MEDIA_ID,
				metadata: OURS,
				projectId: PROJECT_ID,
			}),
		]);
		expect(await stored()).toMatchObject({ itemId: "42001" });
		await Promise.all([
			persistMediaRestrictedMetadata({
				mediaId: MEDIA_ID,
				metadata: THEIRS,
				projectId: PROJECT_ID,
			}),
			deleteMediaRestrictedMetadata({
				mediaId: MEDIA_ID,
				projectId: PROJECT_ID,
			}),
		]);
		expect(await stored()).toBeUndefined();
	});
});
