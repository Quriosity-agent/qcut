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

/**
 * Let every pending chain advance as far as it can.
 *
 * One `await Promise.resolve()` only resumes one link, so a negative
 * assertion placed after it can pass simply because the operation it is
 * watching for has not been reached yet.
 */
async function settle(): Promise<void> {
	for (let turn = 0; turn < 20; turn += 1) {
		await Promise.resolve();
	}
	await new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
}

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
		await settle();
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
		await settle();

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

	it("waits for every overlapping save, not just the newest", async () => {
		const order: string[] = [];
		const first = gate();
		const second = gate();
		const saving = [
			saveTrackedMediaItem({
				...item,
				save: () =>
					first.opened.then(() => {
						order.push("first");
					}),
			}),
			saveTrackedMediaItem({
				...item,
				save: () =>
					second.opened.then(() => {
						order.push("second");
					}),
			}),
		];
		const deleting = deleteTrackedMediaItem({
			...item,
			remove: async () => {
				order.push("deleted");
			},
		});

		// The newer save must not let the delete past the older one, which is
		// still holding the storage entry open.
		second.open();
		await settle();
		expect(order).not.toContain("deleted");

		first.open();
		await Promise.all([...saving, deleting]);
		expect(order.at(-1)).toBe("deleted");
	});

	it("keeps saves out until the last overlapping delete finishes", async () => {
		const firstRemove = gate();
		const secondRemove = gate();
		const save = vi.fn(async () => undefined);
		const deletions = [
			deleteTrackedMediaItem({ ...item, remove: () => firstRemove.opened }),
			deleteTrackedMediaItem({ ...item, remove: () => secondRemove.opened }),
		];
		await settle();

		firstRemove.open();
		await settle();
		// One of two deletes finishing must not clear the way while the other
		// is still removing.
		await expect(saveTrackedMediaItem({ ...item, save })).resolves.toBe(false);
		expect(save).not.toHaveBeenCalled();

		secondRemove.open();
		await Promise.all(deletions);
		await expect(saveTrackedMediaItem({ ...item, save })).resolves.toBe(true);
	});

	it("lets a fresh write wait for the delete instead of being dropped", async () => {
		const order: string[] = [];
		const removing = gate();
		const deleting = deleteTrackedMediaItem({
			...item,
			remove: () =>
				removing.opened.then(() => {
					order.push("deleted");
				}),
		});
		await settle();

		// Re-importing the same file reuses its id. Skipping that save would
		// leave the new item in memory only.
		const saving = saveTrackedMediaItem({
			...item,
			whenDeleting: "wait",
			save: async () => {
				order.push("saved");
			},
		});

		removing.open();
		await expect(saving).resolves.toBe(true);
		await deleting;
		expect(order).toEqual(["deleted", "saved"]);
	});

	it("keeps items apart, so one delete does not block another's save", async () => {
		const removing = gate();
		const save = vi.fn(async () => undefined);
		const deleting = deleteTrackedMediaItem({
			...item,
			remove: () => removing.opened,
		});
		await settle();

		await expect(
			saveTrackedMediaItem({ projectId: "p1", id: "m2", save })
		).resolves.toBe(true);
		expect(save).toHaveBeenCalledTimes(1);

		removing.open();
		await deleting;
	});
});
