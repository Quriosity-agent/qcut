// @vitest-environment node
import {
	copyFile,
	mkdtemp,
	readFile,
	readdir,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CLIRunOptions } from "../cli-runner/types.js";

const { deflickerRuntime, localDeflicker } = vi.hoisted(() => ({
	localDeflicker: vi.fn(),
	deflickerRuntime: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:fs/promises")>();
	return { ...original, copyFile: vi.fn(original.copyFile) };
});

vi.mock("../../../ffmpeg/deflicker-video.js", () => ({
	deflickerLocalVideo: localDeflicker,
}));

vi.mock("../../../jianying-basic-video-runtime/runtime.js", () => ({
	deflickerWithJianyingRuntime: deflickerRuntime,
}));

import { handleVideoLabDeflicker } from "../cli-handlers-video-lab.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
	const directory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-video-lab-cli-")
	);
	temporaryDirectories.push(directory);
	return directory;
}

function options({
	input,
	output,
	strength = 80,
}: {
	input: string;
	output: string;
	strength?: number;
}): CLIRunOptions {
	return {
		command: "video-lab-deflicker",
		force: false,
		input,
		json: true,
		output,
		outputDir: path.dirname(output),
		quiet: true,
		saveIntermediates: false,
		strength,
		verbose: false,
	};
}

describe("video-lab deflicker CLI handler", () => {
	afterEach(async () => {
		vi.clearAllMocks();
		await Promise.all(
			temporaryDirectories
				.splice(0)
				.map((directory) => rm(directory, { force: true, recursive: true }))
		);
	});

	it("publishes the verified cache result to the requested path", async () => {
		const directory = await temporaryDirectory();
		const input = path.join(directory, "source.mp4");
		const cache = path.join(directory, "cache.mp4");
		const output = path.join(directory, "result.mp4");
		await Promise.all([
			writeFile(input, "source"),
			writeFile(cache, "processed-video"),
		]);
		deflickerRuntime.mockImplementation(
			async ({ onProgress }: { onProgress: (value: unknown) => void }) => {
				onProgress({ progress: 75, stage: "process", status: "processing" });
				return {
					cacheHit: false,
					fps: 24,
					frameCount: 72,
					hasAudio: true,
					height: 1080,
					outputPath: cache,
					provider: "jianying-private-cache",
					route: "qcut-jianying-private-deflicker-v2",
					strength: 80,
					width: 1920,
				};
			}
		);
		const progress = vi.fn();

		const result = await handleVideoLabDeflicker(
			{ ...options({ input, output }), backend: "jianying" },
			progress,
			new AbortController().signal
		);

		expect(result.success).toBe(true);
		expect(result.outputPath).toBe(output);
		expect(await readFile(output, "utf8")).toBe("processed-video");
		expect(progress).toHaveBeenCalledWith({
			message: "processing",
			model: "jianying-private-cache",
			percent: 75,
			stage: "process",
		});
	});

	it("rejects an existing output before running the private model", async () => {
		const directory = await temporaryDirectory();
		const input = path.join(directory, "source.mp4");
		const output = path.join(directory, "result.mp4");
		await Promise.all([writeFile(input, "source"), writeFile(output, "old")]);

		const result = await handleVideoLabDeflicker(
			options({ input, output }),
			vi.fn(),
			new AbortController().signal
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Output already exists");
		expect(deflickerRuntime).not.toHaveBeenCalled();
	});
	it("uses local FFmpeg by default without calling the private runtime", async () => {
		const directory = await temporaryDirectory();
		const input = path.join(directory, "source.mp4");
		const output = path.join(directory, "result.mp4");
		localDeflicker.mockResolvedValue({
			outputPath: output,
			width: 320,
			height: 180,
			fps: 24,
			frameCount: 48,
			hasAudio: false,
			cacheHit: false,
			provider: "ffmpeg",
			route: "qcut-ffmpeg-deflicker-v1",
			strength: 80,
		});
		const signal = new AbortController().signal;
		const result = await handleVideoLabDeflicker(
			options({ input, output }),
			vi.fn(),
			signal
		);
		expect(result.success).toBe(true);
		expect(result.data).toMatchObject({
			backend: "ffmpeg",
			provider: "ffmpeg",
		});
		expect(localDeflicker).toHaveBeenCalledWith(
			expect.objectContaining({
				sourcePath: input,
				outputPath: output,
				signal,
				strength: 80,
			})
		);
		expect(deflickerRuntime).not.toHaveBeenCalled();
	});

	it("rejects unknown backends without a silent fallback", async () => {
		const directory = await temporaryDirectory();
		const result = await handleVideoLabDeflicker(
			{
				...options({
					input: path.join(directory, "in.mp4"),
					output: path.join(directory, "out.mp4"),
				}),
				backend: "unknown",
			},
			vi.fn(),
			new AbortController().signal
		);
		expect(result.error).toContain("--backend must be");
		expect(localDeflicker).not.toHaveBeenCalled();
		expect(deflickerRuntime).not.toHaveBeenCalled();
	});

	it("reports local processing failure without retrying on Jianying", async () => {
		const directory = await temporaryDirectory();
		localDeflicker.mockRejectedValue(new Error("Unsupported input"));
		const result = await handleVideoLabDeflicker(
			options({
				input: path.join(directory, "in.mp4"),
				output: path.join(directory, "out.mp4"),
			}),
			vi.fn(),
			new AbortController().signal
		);
		expect(result).toMatchObject({
			success: false,
			error: "Unsupported input",
		});
		expect(deflickerRuntime).not.toHaveBeenCalled();
	});
	it("does not publish a private result cancelled while the copy is pending", async () => {
		const directory = await temporaryDirectory();
		const input = path.join(directory, "source.mp4");
		const cache = path.join(directory, "cache.mp4");
		const output = path.join(directory, "existing.mp4");
		await Promise.all([
			writeFile(input, "source"),
			writeFile(cache, "processed"),
			writeFile(output, "existing"),
		]);
		deflickerRuntime.mockResolvedValue({ outputPath: cache });
		const original =
			await vi.importActual<typeof import("node:fs/promises")>(
				"node:fs/promises"
			);
		let reportCopyStarted!: () => void;
		let releaseCopy!: () => void;
		const copyStarted = new Promise<void>((resolve) => {
			reportCopyStarted = resolve;
		});
		const copyReleased = new Promise<void>((resolve) => {
			releaseCopy = resolve;
		});
		vi.mocked(copyFile).mockImplementationOnce(async (...args) => {
			await original.copyFile(...args);
			reportCopyStarted();
			await copyReleased;
		});
		const controller = new AbortController();
		const pending = handleVideoLabDeflicker(
			{ ...options({ input, output }), backend: "jianying", force: true },
			vi.fn(),
			controller.signal
		);
		await copyStarted;
		controller.abort(new Error("Cancelled during copy"));
		releaseCopy();
		const result = await pending;
		expect(result).toMatchObject({
			success: false,
			error: "Cancelled during copy",
		});
		expect(await readFile(output, "utf8")).toBe("existing");
		expect(await readFile(input, "utf8")).toBe("source");
		expect(
			(await readdir(directory)).filter((name) =>
				name.startsWith(".qcut-deflicker-publish-")
			)
		).toEqual([]);
	});

	it.skipIf(process.platform === "win32")(
		"rejects private force output through a directory symlink pointing to the source",
		async () => {
			const directory = await temporaryDirectory();
			const input = path.join(directory, "source.mp4");
			const alias = path.join(directory, "directory-alias");
			await writeFile(input, "source");
			await symlink(directory, alias, "dir");
			const output = path.join(alias, "source.mp4");
			const result = await handleVideoLabDeflicker(
				{ ...options({ input, output }), backend: "jianying", force: true },
				vi.fn(),
				new AbortController().signal
			);
			expect(result).toMatchObject({
				success: false,
				error: "Output must not overwrite the source video",
			});
			expect(deflickerRuntime).not.toHaveBeenCalled();
			expect(localDeflicker).not.toHaveBeenCalled();
			expect(await readFile(input, "utf8")).toBe("source");
		}
	);
	it("rejects a case alias on case-insensitive filesystems", async ({
		skip,
	}) => {
		const directory = await temporaryDirectory();
		const input = path.join(directory, "source.mp4");
		const output = path.join(directory, "SOURCE.MP4");
		await writeFile(input, "source");
		try {
			await readFile(output);
		} catch {
			skip();
			return;
		}
		const result = await handleVideoLabDeflicker(
			{ ...options({ input, output }), backend: "jianying", force: true },
			vi.fn(),
			new AbortController().signal
		);
		expect(result).toMatchObject({
			success: false,
			error: "Output must not overwrite the source video",
		});
		expect(deflickerRuntime).not.toHaveBeenCalled();
		expect(await readFile(input, "utf8")).toBe("source");
	});
});
