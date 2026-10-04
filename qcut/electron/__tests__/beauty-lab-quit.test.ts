import { describe, expect, it, vi } from "vitest";
import { createBeautyLabQuitGuard } from "../beauty-lab-quit";

describe("Beauty Lab quit cleanup", () => {
	it("waits for cleanup and coalesces repeated quit requests", async () => {
		let finish = () => {};
		const dispose = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				})
		);
		const resumeQuit = vi.fn();
		const onError = vi.fn();
		const guard = createBeautyLabQuitGuard({ resumeQuit, onError });
		const event = { preventDefault: vi.fn() };
		expect(guard({ event, dispose })).toBe(true);
		expect(guard({ event, dispose })).toBe(true);
		await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
		expect(resumeQuit).not.toHaveBeenCalled();
		finish();
		await vi.waitFor(() => expect(resumeQuit).toHaveBeenCalledTimes(1));
		expect(guard({ event, dispose })).toBe(false);
		expect(event.preventDefault).toHaveBeenCalledTimes(2);
		expect(onError).not.toHaveBeenCalled();
	});

	it.each([
		"synchronous",
		"asynchronous",
	])("reports %s failure before resuming quit", async (mode) => {
		const error = new Error("cleanup incomplete");
		const onError = vi.fn();
		const resumeQuit = vi.fn(() => expect(onError).toHaveBeenCalledWith(error));
		const guard = createBeautyLabQuitGuard({ resumeQuit, onError });
		const dispose = () => {
			if (mode === "synchronous") throw error;
			return Promise.reject(error);
		};
		expect(guard({ event: { preventDefault: vi.fn() }, dispose })).toBe(true);
		await vi.waitFor(() => expect(resumeQuit).toHaveBeenCalledTimes(1));
	});

	it("does not intercept quit when the lab was never initialized", () => {
		const event = { preventDefault: vi.fn() };
		const resumeQuit = vi.fn();
		const guard = createBeautyLabQuitGuard({ resumeQuit, onError: vi.fn() });
		expect(guard({ event })).toBe(false);
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(resumeQuit).not.toHaveBeenCalled();
	});
});
