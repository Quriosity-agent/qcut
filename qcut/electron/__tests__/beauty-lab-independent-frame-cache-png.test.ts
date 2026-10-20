// @vitest-environment node
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as canvas from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIndependentFrameCache } from "../beauty-lab/beauty-lab-independent-frame-cache";
import { pngWithSvgMarker } from "./independent-png-svg-fixture";

vi.mock("@napi-rs/canvas", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@napi-rs/canvas")>();
	return { ...actual, loadImage: vi.fn(actual.loadImage) };
});
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, mkdtemp: vi.fn(actual.mkdtemp), rm: vi.fn(actual.rm) };
});
const realCanvas =
	await vi.importActual<typeof import("@napi-rs/canvas")>("@napi-rs/canvas");
const realFs =
	await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

const key = "a".repeat(64);
const rgba = new Uint8Array([11, 20, 30, 255]);
let directory: string;
const snapshots = new Set<string>();

function png({ red = 11, width = 1 } = {}) {
	const image = canvas.createCanvas(width, 1);
	image
		.getContext("2d")
		.putImageData(
			new canvas.ImageData(new Uint8ClampedArray([red, 20, 30, 255]), 1, 1),
			0,
			0
		);
	return image.toBuffer("image/png");
}

async function populate({
	bytes = pngWithSvgMarker({ png: png() }),
}: {
	bytes?: Buffer;
} = {}) {
	const cache = createIndependentFrameCache({ directory });
	await cache.write({ key, width: 1, height: 1, png: bytes, rgba });
	return createIndependentFrameCache({ directory });
}

function interceptFileDecode({
	beforeDecode,
}: {
	beforeDecode?: (file: string) => Promise<void>;
} = {}) {
	return vi
		.mocked(canvas.loadImage)
		.mockImplementation(async (source, options) => {
			if (typeof source === "string") {
				snapshots.add(path.dirname(source));
				await beforeDecode?.(source);
			}
			return realCanvas.loadImage(source, options);
		});
}

beforeEach(async () => {
	vi.mocked(canvas.loadImage)
		.mockReset()
		.mockImplementation(realCanvas.loadImage);
	vi.mocked(fs.mkdtemp).mockReset().mockImplementation(realFs.mkdtemp);
	vi.mocked(fs.rm).mockReset().mockImplementation(realFs.rm);
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "independent-png-test-"));
	snapshots.clear();
});

afterEach(async () => {
	await Promise.all(
		[directory, ...snapshots].map((folder) =>
			realFs.rm(folder, { recursive: true, force: true })
		)
	);
});

describe("independent cached PNG format detection", () => {
	it("decodes a valid SVG-marker PNG exactly and removes its private snapshot", async () => {
		const bytes = pngWithSvgMarker({ png: png() });
		const cache = await populate({ bytes });
		const loadImage = interceptFileDecode();
		expect(await cache.read({ key, width: 1, height: 1 })).toEqual(rgba);
		expect(loadImage).toHaveBeenCalledOnce();
		expect(snapshots.size).toBe(1);
		await Promise.all(
			[...snapshots].map(async (folder) =>
				expect(fs.stat(folder)).rejects.toMatchObject({ code: "ENOENT" })
			)
		);
	});

	it("keeps ordinary PNG reads in memory without creating another file", async () => {
		const cache = await populate({ bytes: png() });
		const loadImage = interceptFileDecode();
		const mkdtemp = vi.mocked(fs.mkdtemp).mockClear();
		expect(await cache.read({ key, width: 1, height: 1 })).toEqual(rgba);
		expect(Buffer.isBuffer(loadImage.mock.calls[0][0])).toBe(true);
		expect(mkdtemp).not.toHaveBeenCalled();
		expect(snapshots.size).toBe(0);
	});

	it.each([
		"removed",
		"replaced",
	])("uses verified bytes when the original cache file is %s before decode", async (operation) => {
		const cache = await populate();
		interceptFileDecode({
			beforeDecode: async (file) => {
				const original = path.join(directory, `${key}.png`);
				expect(file).not.toBe(original);
				if (operation === "removed") await fs.rm(original);
				else await fs.writeFile(original, png({ red: 99 }));
			},
		});
		expect(await cache.read({ key, width: 1, height: 1 })).toEqual(rgba);
		expect(await cache.read({ key, width: 1, height: 1 })).toBeNull();
	});

	it.each([
		{ label: "damaged PNG", bytes: Buffer.from("broken <svg") },
		{
			label: "wrong dimensions",
			bytes: pngWithSvgMarker({ png: png({ width: 2 }) }),
		},
		{
			label: "different pixels",
			bytes: pngWithSvgMarker({ png: png({ red: 99 }) }),
		},
	])("rejects $label and cleans the temporary decode file", async ({
		bytes,
	}) => {
		const cache = await populate({ bytes });
		interceptFileDecode();
		expect(await cache.read({ key, width: 1, height: 1 })).toBeNull();
		expect(snapshots.size).toBe(1);
		await Promise.all(
			[...snapshots].map(async (folder) =>
				expect(fs.stat(folder)).rejects.toMatchObject({ code: "ENOENT" })
			)
		);
		await expect(
			fs.stat(path.join(directory, `${key}.json`))
		).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("does not report a cache hit if removing the decode snapshot fails", async () => {
		const cache = await populate();
		interceptFileDecode();
		const rm = vi.mocked(fs.rm).mockImplementation(async (file, options) => {
			if (String(file).includes("qcut-independent-png-"))
				throw new Error("Snapshot cleanup denied");
			return realFs.rm(file, options);
		});
		expect(await cache.read({ key, width: 1, height: 1 })).toBeNull();
		expect(rm).toHaveBeenCalledWith(
			expect.stringContaining("qcut-independent-png-"),
			{
				recursive: true,
				force: true,
			}
		);
		await expect(
			fs.stat(path.join(directory, `${key}.json`))
		).rejects.toMatchObject({
			code: "ENOENT",
		});
	});
});
