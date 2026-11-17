import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ documentsRoot: "" }));
const hooks = vi.hoisted(() => ({
	/** Runs when a file is about to take the name `to`. */
	beforeLink: undefined as undefined | ((to: string) => Promise<void>),
}));

vi.mock("fs/promises", async (importOriginal) => {
	const real = await importOriginal<typeof import("fs/promises")>();
	return {
		...real,
		link: async (...args: Parameters<typeof real.link>) => {
			await hooks.beforeLink?.(String(args[1]));
			return real.link(...args);
		},
	};
});

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

import {
	type RenamedMediaFile,
	renameMediaFileOnDisk,
} from "../claude/handlers/claude-media-rename.js";

const PROJECT_ID = "media-rename-plan-test";
const idOf = (name: string) =>
	`media_${Buffer.from(name).toString("base64url")}`;

/**
 * The rename route has the editor follow a renamed file, and records the
 * rename before the file is moved: from then on the two can be apart, and
 * the record is what settles them. So the rename says where the file is
 * about to go while it is still where it was, and does not move a file
 * whose move could not be recorded.
 */
describe("the plan a rename gives before it moves the file", () => {
	let mediaFolder = "";
	const names = async () => (await fs.readdir(mediaFolder)).sort();
	const rename = (
		options: Partial<Parameters<typeof renameMediaFileOnDisk>[0]>
	) =>
		renameMediaFileOnDisk({
			projectId: PROJECT_ID,
			mediaId: idOf("shake.mp4"),
			newName: "wanted.mp4",
			...options,
		});

	beforeEach(async () => {
		testState.documentsRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "qcut-media-rename-plan-")
		);
		mediaFolder = path.join(
			testState.documentsRoot,
			"QCut",
			"Projects",
			PROJECT_ID,
			"media"
		);
		await fs.mkdir(mediaFolder, { recursive: true });
		await fs.writeFile(path.join(mediaFolder, "shake.mp4"), "shake");
	});

	afterEach(async () => {
		hooks.beforeLink = undefined;
		await fs.rm(testState.documentsRoot, { recursive: true, force: true });
	});

	it("says where the file is about to go while it is still where it was", async () => {
		const seen: Array<{ planned: RenamedMediaFile; folder: string[] }> = [];
		const notMoved = vi.fn(async () => undefined);
		const renamed = await rename({
			beforeMove: async (planned) => {
				seen.push({ planned, folder: await names() });
			},
			notMoved,
		});

		expect(seen).toEqual([
			{
				planned: {
					previous: {
						id: idOf("shake.mp4"),
						name: "shake.mp4",
						path: path.join(mediaFolder, "shake.mp4"),
					},
					id: idOf("wanted.mp4"),
					name: "wanted.mp4",
					path: path.join(mediaFolder, "wanted.mp4"),
				},
				folder: ["shake.mp4"],
			},
		]);
		expect(renamed).toEqual(seen[0].planned);
		expect(await names()).toEqual(["wanted.mp4"]);
		expect(notMoved).not.toHaveBeenCalled();
	});

	it("does not move a file whose move could not be recorded", async () => {
		const notMoved = vi.fn(async () => undefined);
		await expect(
			rename({
				beforeMove: async () => {
					throw new Error("the disk is full");
				},
				notMoved,
			})
		).rejects.toThrow("the disk is full");
		expect(await names()).toEqual(["shake.mp4"]);
		// Nothing was recorded, so there is nothing to take back.
		expect(notMoved).not.toHaveBeenCalled();
	});

	it("says when the file did not get there, and gives the next plan", async () => {
		const taken = path.join(mediaFolder, "wanted.mp4");
		hooks.beforeLink = async (to) => {
			if (to !== taken) return;
			hooks.beforeLink = undefined;
			await fs.writeFile(taken, "someone else");
		};
		const planned: string[] = [];
		const dropped: string[] = [];
		const renamed = await rename({
			beforeMove: async (plan) => {
				planned.push(plan.name);
			},
			// What it cannot take back does not stop the rename.
			notMoved: async (plan) => {
				dropped.push(plan.name);
				throw new Error("the record could not be removed");
			},
		});

		expect(planned).toEqual(["wanted.mp4", "wanted_1.mp4"]);
		expect(dropped).toEqual(["wanted.mp4"]);
		expect(renamed).toMatchObject({
			id: idOf("wanted_1.mp4"),
			name: "wanted_1.mp4",
		});
		expect(await names()).toEqual(["wanted.mp4", "wanted_1.mp4"]);
		expect(await fs.readFile(taken, "utf8")).toBe("someone else");
	});

	it("says so too when the very name that was asked for is taken first", async () => {
		const taken = path.join(mediaFolder, "wanted.mp4");
		hooks.beforeLink = async (to) => {
			if (to === taken) await fs.writeFile(taken, "someone else");
		};
		const beforeMove = vi.fn(async () => undefined);
		const notMoved = vi.fn(async () => undefined);
		await expect(
			rename({ exactName: true, beforeMove, notMoved })
		).rejects.toThrow("wanted.mp4 is already taken");
		expect(beforeMove).toHaveBeenCalledTimes(1);
		expect(notMoved).toHaveBeenCalledTimes(1);
		expect(notMoved).toHaveBeenCalledWith(
			expect.objectContaining({ name: "wanted.mp4" })
		);
		expect(await names()).toEqual(["shake.mp4", "wanted.mp4"]);
	});

	it("has no plan for a file that already has the name", async () => {
		const beforeMove = vi.fn(async () => undefined);
		const renamed = await rename({ newName: "shake.mp4", beforeMove });
		expect(renamed.id).toBe(renamed.previous.id);
		expect(beforeMove).not.toHaveBeenCalled();
	});
});
