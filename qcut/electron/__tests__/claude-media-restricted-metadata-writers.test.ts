import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ documentsRoot: "" }));
const hooks = vi.hoisted(() => ({
	/** Runs right after a file was looked at, before whoever looked acts. */
	onLstat: undefined as undefined | ((filePath: string) => Promise<void>),
	/** The same for a look at a hold. */
	onStat: undefined as undefined | ((filePath: string) => Promise<void>),
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
		stat: async (...args: Parameters<typeof real.stat>) => {
			const seen = await real.stat(...args);
			await hooks.onStat?.(String(args[0]));
			return seen;
		},
	};
});

import * as fs from "node:fs/promises";
import {
	deleteMediaRestrictedMetadata,
	persistMediaRestrictedMetadata,
	readMediaRestrictedMetadata,
	stageMediaRestrictedMetadata,
} from "../claude/handlers/claude-media-restricted-metadata.js";

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

/**
 * Writes the id's sidecar, and puts a hold on it as another process would:
 * a folder beside it, made at `madeAt`.
 */
async function holdOf({ madeAt }: { madeAt: number }): Promise<string> {
	await persistMediaRestrictedMetadata({
		mediaId: MEDIA_ID,
		metadata: OURS,
		projectId: PROJECT_ID,
	});
	const [sidecar] = await fs.readdir(sidecarFolder());
	const hold = path.join(sidecarFolder(), `${sidecar}.lock`);
	await fs.mkdir(hold);
	await fs.utimes(hold, new Date(madeAt), new Date(madeAt));
	return hold;
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
		hooks.onStat = undefined;
	});

	afterEach(async () => {
		hooks.onLstat = undefined;
		hooks.onStat = undefined;
		vi.restoreAllMocks();
		await fs.rm(testState.documentsRoot, { recursive: true, force: true });
	});

	it("does not remove an import's sidecar that arrives while a staged one is being taken away", async () => {
		const staged = await stageMediaRestrictedMetadata({
			mediaId: MEDIA_ID,
			metadata: OURS,
			projectId: PROJECT_ID,
			mediaFileExists: async () => false,
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
			mediaFileExists: async () => false,
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
	 * handlers in the main one. They share no queue, so a sidecar is held by
	 * a folder beside it while it is changed.
	 */
	it("holds a sidecar against a writer in another process", async () => {
		const staged = await stageMediaRestrictedMetadata({
			mediaId: MEDIA_ID,
			metadata: OURS,
			projectId: PROJECT_ID,
			mediaFileExists: async () => false,
		});
		// A second copy of the module stands in for the other process: it
		// has a queue of its own.
		vi.resetModules();
		const otherProcess = await import(
			"../claude/handlers/claude-media-restricted-metadata.js"
		);
		let imported: { written: Promise<void> } | undefined;
		hooks.onLstat = async (filePath) => {
			if (!filePath.endsWith(".json") || imported) return;
			imported = { written: Promise.resolve() };
			const written = otherProcess.persistMediaRestrictedMetadata({
				mediaId: MEDIA_ID,
				metadata: THEIRS,
				projectId: PROJECT_ID,
			});
			await Promise.race([
				written,
				new Promise((resolve) => setTimeout(resolve, 60)),
			]);
			imported = { written };
		};
		await staged.discard();
		hooks.onLstat = undefined;
		await imported?.written;

		expect(await stored()).toMatchObject({ itemId: "42002" });
		// Nothing is left of the hold.
		const sidecars = sidecarFolder();
		expect(
			(await fs.readdir(sidecars)).filter((name) => !name.endsWith(".json"))
		).toEqual([]);
	});

	it("takes over a hold left by a process that ended", async () => {
		const hold = await holdOf({ madeAt: Date.now() - 60_000 });
		await persistMediaRestrictedMetadata({
			mediaId: MEDIA_ID,
			metadata: THEIRS,
			projectId: PROJECT_ID,
		});
		expect(await stored()).toMatchObject({ itemId: "42002" });
		await expect(fs.stat(hold)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("gives up on a hold that another process keeps, and changes nothing", async () => {
		// Not left, however long this waits for it.
		const hold = await holdOf({ madeAt: Date.now() + 3_600_000 });
		const clock = { ahead: 0 };
		const realNow = Date.now.bind(Date);
		vi.spyOn(Date, "now").mockImplementation(() => realNow() + clock.ahead);

		let outcome: string | undefined;
		const refused = persistMediaRestrictedMetadata({
			mediaId: MEDIA_ID,
			metadata: THEIRS,
			projectId: PROJECT_ID,
		}).then(
			() => "changed",
			(error: unknown) => String(error)
		);
		void refused.then((result) => {
			outcome = result;
		});
		// Time goes by for the change that waits.
		for (let turn = 0; turn < 100 && outcome === undefined; turn += 1) {
			clock.ahead += 2000;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}

		expect(await refused).toContain("being changed by another process");
		expect(await stored()).toMatchObject({ itemId: "42001" });
		// The hold is the other process's to take away.
		expect((await fs.stat(hold)).isDirectory()).toBe(true);
	});

	/**
	 * Both processes can find the same left hold. The first removes it and
	 * makes its own; the second must not take that one for the left one.
	 */
	it("does not remove a hold made since it was found left", async () => {
		const hold = await holdOf({ madeAt: Date.now() - 60_000 });
		let othersHold: bigint | undefined;
		hooks.onStat = async (filePath) => {
			if (filePath !== hold || othersHold !== undefined) return;
			// The other process got there first, and is at work.
			await fs.rmdir(hold);
			await fs.mkdir(hold);
			othersHold = (await fs.lstat(hold, { bigint: true })).ino;
		};
		let changed = false;
		const written = persistMediaRestrictedMetadata({
			mediaId: MEDIA_ID,
			metadata: THEIRS,
			projectId: PROJECT_ID,
		}).then(() => {
			changed = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 150));

		expect(othersHold).toBeDefined();
		expect(changed).toBe(false);
		expect((await fs.lstat(hold, { bigint: true })).ino).toBe(othersHold);
		expect(await stored()).toMatchObject({ itemId: "42001" });

		// The other process is done: this one has its turn.
		await fs.rmdir(hold);
		await written;
		expect(await stored()).toMatchObject({ itemId: "42002" });
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
