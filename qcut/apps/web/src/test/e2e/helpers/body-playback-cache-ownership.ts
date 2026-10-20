import { expect, type Page } from "@playwright/test";
import { CANVAS_PLAYBACK_CACHE_DIRECTORY } from "../../../lib/preview/canvas-composition-playback-cache";

interface OwnershipProbe {
	orphanId: string;
	activeId: string;
	activeWorker: Worker;
	workerUrl: string;
	directoryName: string;
}

interface OwnershipWindow {
	__bodyPlaybackOwnershipProbe?: OwnershipProbe;
}

/** A terminated worker leaves real OPFS data behind and releases its browser lease. */
export async function beginBodyPlaybackCacheOwnershipProbe({
	page,
}: {
	page: Page;
}) {
	const before = await page.evaluate(async (directoryName) => {
		const target = window as unknown as OwnershipWindow;
		if (target.__bodyPlaybackOwnershipProbe)
			throw new Error("Cache ownership probe already installed");
		const workerUrl = URL.createObjectURL(
			new Blob(
				[
					`
self.addEventListener("message", async ({ data }) => {
	if (data.action !== "hold") return;
	try {
		await navigator.locks.request("qcut-composition-playback:" + data.id, async () => {
			const root = await navigator.storage.getDirectory();
			const parent = await root.getDirectoryHandle(data.directoryName, { create: true });
			const directory = await parent.getDirectoryHandle(data.id, { create: true });
			const marker = await directory.getFileHandle("owner.txt", { create: true });
			const writable = await marker.createWritable();
			await writable.write(data.id);
			await writable.close();
			self.postMessage({ ready: true, id: data.id });
			await new Promise(() => {});
		});
	} catch (error) {
		self.postMessage({ error: String(error) });
	}
});
`,
				],
				{ type: "application/javascript" }
			)
		);
		const orphanId = `v1-${crypto.randomUUID()}`;
		const activeId = `v1-${crypto.randomUUID()}`;
		const orphanWorker = new Worker(workerUrl);
		const activeWorker = new Worker(workerUrl);
		const hold = ({ worker, id }: { worker: Worker; id: string }) =>
			new Promise<void>((resolve, reject) => {
				const timer = setTimeout(
					() => reject(new Error("Cache ownership worker timed out")),
					15_000
				);
				worker.addEventListener(
					"error",
					(event) => {
						clearTimeout(timer);
						reject(new Error(event.message));
					},
					{ once: true }
				);
				worker.addEventListener(
					"message",
					({
						data,
					}: MessageEvent<{
						ready?: boolean;
						id?: string;
						error?: string;
					}>) => {
						clearTimeout(timer);
						if (data.ready && data.id === id) resolve();
						else
							reject(
								new Error(data.error ?? "Invalid ownership worker readiness")
							);
					},
					{ once: true }
				);
				worker.postMessage({ action: "hold", id, directoryName });
			});
		try {
			await Promise.all([
				hold({ worker: orphanWorker, id: orphanId }),
				hold({ worker: activeWorker, id: activeId }),
			]);
			const held = await navigator.locks.query();
			const ownerNames = held.held?.map((lock) => lock.name) ?? [];
			if (
				![orphanId, activeId].every((id) =>
					ownerNames.includes(`qcut-composition-playback:${id}`)
				)
			)
				throw new Error(
					"Worker cache leases were not both held before termination"
				);
			orphanWorker.terminate();
			target.__bodyPlaybackOwnershipProbe = {
				orphanId,
				activeId,
				activeWorker,
				workerUrl,
				directoryName,
			};
			return { orphanId, activeId, heldBeforeTermination: ownerNames };
		} catch (error) {
			orphanWorker.terminate();
			activeWorker.terminate();
			URL.revokeObjectURL(workerUrl);
			throw error;
		}
	}, CANVAS_PLAYBACK_CACHE_DIRECTORY);
	await expect
		.poll(
			() =>
				page.evaluate(async () => {
					const probe = (window as unknown as OwnershipWindow)
						.__bodyPlaybackOwnershipProbe;
					if (!probe) throw new Error("Missing ownership probe");
					return navigator.locks.request(
						`qcut-composition-playback:${probe.orphanId}`,
						{ ifAvailable: true },
						(lock) => Boolean(lock)
					);
				}),
			{ timeout: 15_000 }
		)
		.toBe(true);
	return before;
}

export async function finishBodyPlaybackCacheOwnershipProbe({
	page,
}: {
	page: Page;
}) {
	const result = await page.evaluate(async () => {
		const target = window as unknown as OwnershipWindow;
		const probe = target.__bodyPlaybackOwnershipProbe;
		if (!probe) throw new Error("Missing ownership probe");
		const root = await navigator.storage.getDirectory();
		const parent = await root.getDirectoryHandle(probe.directoryName);
		try {
			let orphanExists = true;
			try {
				await parent.getDirectoryHandle(probe.orphanId);
			} catch (error) {
				if (!(error instanceof DOMException) || error.name !== "NotFoundError")
					throw error;
				orphanExists = false;
			}
			const active = await parent.getDirectoryHandle(probe.activeId);
			const marker = await active.getFileHandle("owner.txt");
			const markerText = await (await marker.getFile()).text();
			const activeLeaseAvailable = await navigator.locks.request(
				`qcut-composition-playback:${probe.activeId}`,
				{ ifAvailable: true },
				(lock) => Boolean(lock)
			);
			return {
				orphanId: probe.orphanId,
				activeId: probe.activeId,
				orphanExists,
				activeMarker: markerText,
				activeLeaseAvailable,
			};
		} finally {
			probe.activeWorker.terminate();
			URL.revokeObjectURL(probe.workerUrl);
			await Promise.all(
				[probe.orphanId, probe.activeId].map((id) =>
					parent
						.removeEntry(id, { recursive: true })
						.catch((error: unknown) => {
							if (
								!(error instanceof DOMException) ||
								error.name !== "NotFoundError"
							)
								throw error;
						})
				)
			);
			target.__bodyPlaybackOwnershipProbe = undefined;
		}
	});
	expect(
		result.orphanExists,
		"Terminated-owner OPFS cache must be reclaimed"
	).toBe(false);
	expect(result.activeMarker, "A live worker's cache must remain intact").toBe(
		result.activeId
	);
	expect(
		result.activeLeaseAvailable,
		"Live worker must still hold its cache lease"
	).toBe(false);
	return result;
}
