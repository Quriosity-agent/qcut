import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ documentsRoot: "" }));
const hooks = vi.hoisted(() => ({
	/** Runs right after a file was looked at, before whoever looked acts. */
	onLstat: undefined as undefined | ((filePath: string) => Promise<void>),
	/** Runs before a written file is put in place under the name given. */
	beforePlacing: undefined as undefined | ((name: string) => Promise<void>),
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
		// The two ways a sidecar gets its name: an import's by a rename, a
		// staged one by a hard link.
		rename: async (...args: Parameters<typeof real.rename>) => {
			await hooks.beforePlacing?.(String(args[1]));
			return real.rename(...args);
		},
		link: async (...args: Parameters<typeof real.link>) => {
			await hooks.beforePlacing?.(String(args[1]));
			return real.link(...args);
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
import { MAIN_REQUEST_TIMEOUT_MS } from "../utility/utility-main-requests.js";
import { restrictedMetadataChangesThroughMain } from "../utility/utility-media-requests.js";
import {
	closeBridges,
	mediaBridgeToTheMainProcess,
} from "./utility-bridge-kit.js";

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
 * The bridge between the two processes, with what the utility process asks
 * over it for sidecars (utility-media-requests.ts) and what the main
 * process does for it (utility-media-bridge.ts): the bridge's own code on
 * both sides, over a real message port pair (utility-bridge-kit.ts).
 *
 * `asked()` are the changes asked for, `answers` what the main process said.
 */
function bridgeToTheMainProcess() {
	const bridge = mediaBridgeToTheMainProcess();
	return {
		changes: restrictedMetadataChangesThroughMain({
			requestFromMain: bridge.requestFromMain,
		}),
		asked: () => bridge.asked.map((message) => String(message.data.change)),
		/** When the asker of each request stops waiting for it. */
		deadlines: () => bridge.asked.map((message) => Number(message.deadline)),
		answers: bridge.answers,
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
		hooks.beforePlacing = undefined;
		closeBridges();
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
			expect(asked()).toEqual([
				"persist",
				"stage",
				"remove",
				"stage",
				"discard",
			]);
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
				await vi.waitFor(() => expect(bridge.asked()).toEqual(["persist"]));
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

		/**
		 * A write was begun in time, and the disk then held it up. The asker
		 * stopped waiting and went on as if the write had failed: an import
		 * takes the imported file away again, and asks for the sidecar to be
		 * removed, which waits behind the write and is given up in its turn.
		 * Finished after all that, the write left restricted metadata for a
		 * file that was no longer there, to stick to whatever file took that
		 * name next.
		 */
		describe("when a write is held up past the asker's wait", () => {
			let bridge: ReturnType<typeof bridgeToTheMainProcess>;
			let goOn = () => {};
			let heldUp = false;

			afterEach(() => {
				vi.useRealTimers();
			});

			/** The other process, and a disk that holds the next sidecar up. */
			async function withTheDiskHoldingUp() {
				const other = await inTheOtherProcess();
				bridge = bridgeToTheMainProcess();
				other.makeRestrictedMetadataChangesThrough(bridge.changes);
				vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
				const released = new Promise<void>((resolve) => {
					goOn = resolve;
				});
				heldUp = false;
				hooks.beforePlacing = async (name) => {
					if (!name.endsWith(".json") || heldUp) return;
					heldUp = true;
					await released;
				};
				return other;
			}
			const sidecars = async () =>
				(await fs.readdir(sidecarFolder())).filter((name) =>
					name.endsWith(".json")
				);
			const outcome = (change: Promise<unknown>) =>
				change.then(
					() => "made",
					(error: unknown) => String(error)
				);

			it("takes an import's sidecar away again when it is finished only then", async () => {
				const other = await withTheDiskHoldingUp();
				const written = outcome(
					other.persistMediaRestrictedMetadata({
						mediaId: MEDIA_ID,
						metadata: THEIRS,
						projectId: PROJECT_ID,
					})
				);
				await vi.waitFor(() => expect(heldUp).toBe(true));

				// The asker's wait runs out while the disk holds the write.
				await vi.advanceTimersByTimeAsync(MAIN_REQUEST_TIMEOUT_MS);
				expect(await written).toBe(
					"Error: Main process request timed out: media:restricted-metadata"
				);
				// It rolls back: the sidecar is to go. That waits behind the
				// write, and is given up as well.
				const removed = outcome(
					other.deleteMediaRestrictedMetadata({
						mediaId: MEDIA_ID,
						projectId: PROJECT_ID,
					})
				);
				await vi.waitFor(() =>
					expect(bridge.asked()).toEqual(["persist", "remove"])
				);
				await vi.advanceTimersByTimeAsync(MAIN_REQUEST_TIMEOUT_MS);
				expect(await removed).toContain("timed out");
				expect(bridge.answers).toEqual([]);

				// The disk lets go.
				goOn();
				await vi.waitFor(() => expect(bridge.answers).toHaveLength(2));
				expect(bridge.answers[0].error).toBe(
					"The change to restricted media metadata took longer than the request for it waits; it was taken back"
				);
				expect(bridge.answers[1].error).toContain("it was not made");
				expect(await stored()).toBeUndefined();
				expect(await sidecars()).toEqual([]);
			});

			it("takes a staged sidecar away again when it is finished only then", async () => {
				const other = await withTheDiskHoldingUp();
				const staged = outcome(
					other.stageMediaRestrictedMetadata({
						mediaId: MEDIA_ID,
						metadata: OURS,
						projectId: PROJECT_ID,
						mediaFilePath: MEDIA_FILE(),
					})
				);
				await vi.waitFor(() => expect(heldUp).toBe(true));
				await vi.advanceTimersByTimeAsync(MAIN_REQUEST_TIMEOUT_MS);
				expect(await staged).toContain("timed out");

				goOn();
				await vi.waitFor(() => expect(bridge.answers).toHaveLength(1));
				expect(bridge.answers[0].error).toContain("it was taken back");
				expect(await stored()).toBeUndefined();
				expect(await sidecars()).toEqual([]);
			});

			it("leaves a sidecar that the disk held up for less than the asker waits", async () => {
				const other = await withTheDiskHoldingUp();
				const written = outcome(
					other.persistMediaRestrictedMetadata({
						mediaId: MEDIA_ID,
						metadata: THEIRS,
						projectId: PROJECT_ID,
					})
				);
				await vi.waitFor(() => expect(heldUp).toBe(true));
				await vi.advanceTimersByTimeAsync(MAIN_REQUEST_TIMEOUT_MS / 2);
				goOn();
				expect(await written).toBe("made");
				expect(await stored()).toMatchObject({ itemId: "42002" });
			});

			/**
			 * Finished with less than a second of the asker's wait left, the
			 * answer might not be back in time: the asker would roll back
			 * while the main process took the write for made.
			 */
			it("takes a sidecar away that is finished in the last second of the asker's wait", async () => {
				const other = await withTheDiskHoldingUp();
				const written = outcome(
					other.persistMediaRestrictedMetadata({
						mediaId: MEDIA_ID,
						metadata: THEIRS,
						projectId: PROJECT_ID,
					})
				);
				await vi.waitFor(() => expect(heldUp).toBe(true));
				// Half a second before the asker stops waiting.
				vi.setSystemTime(bridge.deadlines()[0] - 500);
				goOn();
				// Told so while it still waits: it rolls back knowing why.
				expect(await written).toBe(
					"Error: The change to restricted media metadata took longer than the request for it waits; it was taken back"
				);
				expect(await sidecars()).toEqual([]);
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
