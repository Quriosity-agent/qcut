import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ userData: "" }));

vi.mock("electron", () => ({
	app: { getPath: vi.fn(() => testState.userData) },
}));

import {
	noteUnsettledMediaRename,
	unsettledRenameKey,
} from "../claude/handlers/claude-media-rename-note.js";

const OLD = "media_b2xkLm1wNA";
const NEW = "media_bmV3Lm1wNA";
/**
 * The key of the note for these two ids. The editor reads and removes notes
 * under the same key (media-rename-settle.test.ts has this literal too): a
 * key made differently here would be a note nobody finds.
 */
const KEY = "media-rename-unsettled-project-1-41286e42738c611db286b10f55980497";

describe("the desktop app's note of a rename the editor may not have settled", () => {
	beforeEach(async () => {
		testState.userData = await fs.mkdtemp(
			path.join(os.tmpdir(), "qcut-rename-note-")
		);
	});

	afterEach(async () => {
		await fs.rm(testState.userData, { recursive: true, force: true });
	});

	it("makes the key the editor's notes are kept under", () => {
		expect(
			unsettledRenameKey({ projectId: "project-1", newId: NEW, oldId: OLD })
		).toBe(KEY);
		// The other way round is another rename.
		expect(
			unsettledRenameKey({ projectId: "project-1", newId: OLD, oldId: NEW })
		).not.toBe(KEY);
	});

	it("writes the note where the app's key-value store keeps its records", async () => {
		const before = Date.now();
		await noteUnsettledMediaRename({
			projectId: "project-1",
			renamed: {
				previous: { id: OLD, name: "old.mp4", path: "/p/media/old.mp4" },
				id: NEW,
				name: "new.mp4",
				path: "/p/media/new.mp4",
			},
		});
		const stored = JSON.parse(
			await fs.readFile(
				path.join(testState.userData, "projects", `${KEY}.json`),
				"utf8"
			)
		);
		expect(stored).toMatchObject({
			newId: NEW,
			newName: "new.mp4",
			newPath: "/p/media/new.mp4",
			oldId: OLD,
			oldName: "old.mp4",
			oldPath: "/p/media/old.mp4",
		});
		expect(stored.notedAt).toBeGreaterThanOrEqual(before);
	});

	it("fits a key into a file name whatever the length of the ids", () => {
		const long = `media_${"长".repeat(200)}`;
		const key = unsettledRenameKey({
			projectId: "0d27ff43-87c9-4980-94cc-dd29dbb5b75e",
			newId: long,
			oldId: `${long}_2`,
		});
		expect(Buffer.byteLength(`${key}.json`)).toBeLessThan(255);
	});
});
