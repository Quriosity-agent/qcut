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
		const sidecars = path.join(
			testState.documentsRoot,
			"QCut",
			"Projects",
			PROJECT_ID,
			"media",
			".qcut-restricted-media"
		);
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
	});
});
