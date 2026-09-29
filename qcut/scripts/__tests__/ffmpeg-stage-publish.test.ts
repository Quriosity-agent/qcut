import { mkdir, rename, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishFFmpegStage } from "../ffmpeg-stage-publish";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	const mocked = { ...actual, mkdir: vi.fn(), rename: vi.fn(), rm: vi.fn() };
	return { ...mocked, default: mocked };
});

vi.mock("node:timers/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:timers/promises")>();
	const mocked = {
		...actual,
		setTimeout: vi.fn().mockResolvedValue(undefined),
	};
	return { ...mocked, default: mocked };
});

const paths = { source: "/cache/stage", destination: "/resources/ffmpeg" };

describe("FFmpeg stage publication", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.mocked(mkdir).mockResolvedValue(undefined);
		vi.mocked(rm).mockResolvedValue(undefined);
		vi.mocked(rename).mockResolvedValue(undefined);
	});
	afterEach(() => {
		vi.resetAllMocks();
		vi.useRealTimers();
	});

	it.each([
		"EPERM",
		"EBUSY",
		"EACCES",
	])("retries temporary Windows %s locks before publishing", async (code) => {
		vi.mocked(rename)
			.mockRejectedValueOnce(Object.assign(new Error("locked"), { code }))
			.mockRejectedValueOnce(Object.assign(new Error("locked"), { code }));
		const result = publishFFmpegStage({ ...paths, platform: "win32" });
		await vi.runAllTimersAsync();
		await result;
		expect(rename).toHaveBeenCalledTimes(3);
		expect(rename).toHaveBeenLastCalledWith(paths.source, paths.destination);
		expect(rm).toHaveBeenCalledTimes(1);
		expect(rm).toHaveBeenCalledWith(paths.destination, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 500,
		});
	});

	it("bounds retries and preserves the original failure", async () => {
		const error = Object.assign(new Error("still locked"), { code: "EPERM" });
		vi.mocked(rename).mockRejectedValue(error);
		const result = expect(
			publishFFmpegStage({ ...paths, platform: "win32" })
		).rejects.toBe(error);
		await vi.runAllTimersAsync();
		await result;
		expect(rename).toHaveBeenCalledTimes(6);
	});

	it.each([
		{ platform: "darwin" as const, code: "EPERM" },
		{ platform: "linux" as const, code: "EBUSY" },
		{ platform: "win32" as const, code: "ENOENT" },
		{ platform: "win32" as const, code: "EXDEV" },
	])("fails immediately for $platform/$code", async ({ platform, code }) => {
		const error = Object.assign(new Error("cannot move"), { code });
		vi.mocked(rename).mockRejectedValue(error);
		await expect(publishFFmpegStage({ ...paths, platform })).rejects.toBe(
			error
		);
		expect(rename).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("does not move a stage if removing the old destination fails", async () => {
		const error = new Error("cannot remove destination");
		vi.mocked(rm).mockRejectedValue(error);
		await expect(
			publishFFmpegStage({ ...paths, platform: "win32" })
		).rejects.toBe(error);
		expect(rename).not.toHaveBeenCalled();
	});
});
