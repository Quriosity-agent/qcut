import { describe, expect, it, vi } from "vitest";
import { createFrameRenderQueue } from "../export-render-queue";

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((finish) => {
		resolve = finish;
	});
	return { promise, resolve };
}

describe("shared preview and export render queue", () => {
	it("keeps asynchronous preview and export writes to scratch canvases separate", async () => {
		const enqueue = createFrameRenderQueue();
		const preview = deferred();
		let scratch = "";
		const first = enqueue({
			render: async () => {
				scratch = "preview";
				await preview.promise;
				expect(scratch).toBe("preview");
			},
		});
		const renderExport = vi.fn(async () => {
			scratch = "export";
		});
		const second = enqueue({ render: renderExport });
		await Promise.resolve();
		expect(renderExport).not.toHaveBeenCalled();
		preview.resolve();
		await Promise.all([first, second]);
		expect(scratch).toBe("export");
	});

	it("removes a cancelled pending frame immediately without disturbing the active job", async () => {
		const enqueue = createFrameRenderQueue();
		const held = deferred();
		const first = enqueue({ render: () => held.promise });
		const controller = new AbortController();
		const render = vi.fn(async () => {});
		const cancelled = enqueue({ render, signal: controller.signal });
		controller.abort(new Error("Obsolete preview"));
		await expect(cancelled).rejects.toThrow("Obsolete preview");
		expect(render).not.toHaveBeenCalled();
		held.resolve();
		await first;
		await enqueue({ render });
		expect(render).toHaveBeenCalledOnce();
	});

	it("retains the active lease until cancelled work has stopped touching its canvas", async () => {
		const enqueue = createFrameRenderQueue();
		const held = deferred();
		const controller = new AbortController();
		const first = enqueue({
			render: () => held.promise,
			signal: controller.signal,
		});
		await Promise.resolve();
		controller.abort();
		const render = vi.fn(async () => {});
		const second = enqueue({ render });
		await Promise.resolve();
		expect(render).not.toHaveBeenCalled();
		held.resolve();
		await Promise.all([first, second]);
		expect(render).toHaveBeenCalledOnce();
	});

	it("continues after failed rendering and rejects already aborted jobs", async () => {
		const enqueue = createFrameRenderQueue();
		await expect(
			enqueue({
				render: async () => {
					throw new Error("Decode failed");
				},
			})
		).rejects.toThrow("Decode failed");
		const render = vi.fn(async () => {});
		await enqueue({ render });
		const controller = new AbortController();
		controller.abort();
		await expect(
			enqueue({ render, signal: controller.signal })
		).rejects.toMatchObject({ name: "AbortError" });
		expect(render).toHaveBeenCalledOnce();
	});
});
