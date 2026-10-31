/**
 * N30: a refused `replace-media` left the file it had just imported in the
 * media library, twice in six attempts, because the background
 * thumbnail/duration pass was still rewriting that item's storage entry when
 * the delete arrived.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	deleteTrackedMediaItem,
	resetMediaPersistenceQueue,
	saveTrackedMediaItem,
} from "../media-persistence-queue";

const item = { projectId: "p1", id: "m1" };

function gate(): { opened: Promise<void>; open: () => void } {
	let open: () => void = () => undefined;
	const opened = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { opened, open };
}

describe("media persistence queue", () => {
	beforeEach(() => {
		resetMediaPersistenceQueue();
	});

	it("drains an in-flight save before the delete runs", async () => {
		const order: string[] = [];
		const writing = gate();
		const saving = saveTrackedMediaItem({
			...item,
			save: () =>
				writing.opened.then(() => {
					order.push("saved");
				}),
		});
		const deleting = deleteTrackedMediaItem({
			...item,
			remove: async () => {
				order.push("deleted");
			},
		});

		// The delete must not touch storage while the save still holds the entry.
		await Promise.resolve();
		expect(order).toEqual([]);

		writing.open();
		await Promise.all([saving, deleting]);
		expect(order).toEqual(["saved", "deleted"]);
	});

	it("skips a save that starts while a delete is under way", async () => {
		const removing = gate();
		const save = vi.fn(async () => undefined);
		const deleting = deleteTrackedMediaItem({
			...item,
			remove: () => removing.opened,
		});
		await Promise.resolve();

		await expect(saveTrackedMediaItem({ ...item, save })).resolves.toBe(false);
		expect(save).not.toHaveBeenCalled();

		removing.open();
		await deleting;
	});

	it("saves the same id again once its delete has settled", async () => {
		await deleteTrackedMediaItem({ ...item, remove: async () => undefined });
		const save = vi.fn(async () => undefined);

		// A media id is derived from the file name, so re-importing the same
		// file reuses it; a sticky block would never let it be stored again.
		await expect(saveTrackedMediaItem({ ...item, save })).resolves.toBe(true);
		expect(save).toHaveBeenCalledTimes(1);
	});

	it("deletes even when the save it waited for failed", async () => {
		const remove = vi.fn(async () => undefined);
		const saving = saveTrackedMediaItem({
			...item,
			save: async () => {
				throw new Error("entry is locked");
			},
		});
		const failed = saving.catch(() => "rejected");

		await deleteTrackedMediaItem({ ...item, remove });

		expect(remove).toHaveBeenCalledTimes(1);
		await expect(failed).resolves.toBe("rejected");
	});

	it("keeps items apart, so one delete does not block another's save", async () => {
		const removing = gate();
		const save = vi.fn(async () => undefined);
		const deleting = deleteTrackedMediaItem({
			...item,
			remove: () => removing.opened,
		});
		await Promise.resolve();

		await expect(
			saveTrackedMediaItem({ projectId: "p1", id: "m2", save })
		).resolves.toBe(true);
		expect(save).toHaveBeenCalledTimes(1);

		removing.open();
		await deleting;
	});
});
