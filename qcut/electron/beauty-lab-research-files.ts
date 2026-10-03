import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { crc32, inflateSync } from "node:zlib";
import { PNG } from "pdf-lib/cjs/utils/png.js";
import type { z } from "zod";

export const WIDTH = 1448;
export const HEIGHT = 1086;
export const RGBA_BYTES = WIDTH * HEIGHT * 4;
export const MIB = 1024 * 1024;

export function requireEvidence({
	condition,
	message,
}: {
	condition: boolean;
	message: string;
}): void {
	if (!condition) throw new Error(`Beauty Lab research: ${message}`);
}

function digest({ bytes }: { bytes: Uint8Array }): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export function safeRelativePath({
	relativePath,
}: {
	relativePath: string;
}): void {
	requireEvidence({
		condition:
			relativePath.length > 0 &&
			relativePath.length <= 4096 &&
			!path.isAbsolute(relativePath) &&
			!/[\\:\0]/.test(relativePath) &&
			relativePath
				.split("/")
				.every((part) => part !== "" && part !== "." && part !== ".."),
		message: "unsafe research path",
	});
}

function sameFile({ before, after }: { before: Stats; after: Stats }): boolean {
	return (
		before.dev === after.dev &&
		before.ino === after.ino &&
		before.size === after.size &&
		before.mtimeMs === after.mtimeMs &&
		before.ctimeMs === after.ctimeMs &&
		after.isFile()
	);
}

export async function pinRoot({ root }: { root: string }) {
	const declared = path.resolve(root);
	const canonical = await realpath(declared);
	const identity = await lstat(canonical);
	requireEvidence({
		condition: identity.isDirectory(),
		message: "research root is not a directory",
	});
	return { declared, canonical, identity };
}

export type PinnedRoot = Awaited<ReturnType<typeof pinRoot>>;

export async function checkPath({
	root,
	relativePath,
}: {
	root: PinnedRoot;
	relativePath: string;
}): Promise<string> {
	safeRelativePath({ relativePath });
	const filename = path.join(root.canonical, relativePath);
	const [canonical, declared, identity] = await Promise.all([
		realpath(filename),
		realpath(root.declared),
		lstat(root.canonical),
	]);
	requireEvidence({
		condition:
			canonical === filename &&
			declared === root.canonical &&
			identity.isDirectory() &&
			identity.dev === root.identity.dev &&
			identity.ino === root.identity.ino,
		message: "symlink or changed research root",
	});
	return filename;
}

async function readStable({
	root,
	relativePath,
	maximum,
}: {
	root: PinnedRoot;
	relativePath: string;
	maximum: number;
}): Promise<Buffer> {
	const filename = await checkPath({ root, relativePath });
	const authorized = await lstat(filename);
	await checkPath({ root, relativePath });
	const handle = await open(
		filename,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
	);
	try {
		const before = await handle.stat();
		await checkPath({ root, relativePath });
		requireEvidence({
			condition:
				before.isFile() &&
				before.size > 0 &&
				before.size <= maximum &&
				sameFile({ before: authorized, after: before }) &&
				sameFile({ before, after: await lstat(filename) }),
			message: `invalid or oversized file: ${relativePath}`,
		});
		const bytes = Buffer.alloc(before.size + 1);
		const fill = async ({ offset }: { offset: number }): Promise<number> => {
			if (offset === bytes.length) return offset;
			const { bytesRead } = await handle.read(
				bytes,
				offset,
				bytes.length - offset,
				offset
			);
			return bytesRead === 0 ? offset : fill({ offset: offset + bytesRead });
		};
		const length = await fill({ offset: 0 });
		const [after, current] = await Promise.all([
			handle.stat(),
			lstat(filename),
		]);
		await checkPath({ root, relativePath });
		requireEvidence({
			condition:
				length === before.size &&
				sameFile({ before, after }) &&
				sameFile({ before, after: current }),
			message: `file changed while reading: ${relativePath}`,
		});
		return bytes.subarray(0, length);
	} finally {
		await handle.close();
	}
}

export function createSnapshot() {
	const files = new Map<
		string,
		{ root: PinnedRoot; relativePath: string; maximum: number; hash: string }
	>();
	let totalBytes = 0;
	const read = async ({
		root,
		relativePath,
		maximum,
		expected,
	}: {
		root: PinnedRoot;
		relativePath: string;
		maximum: number;
		expected?: string;
	}): Promise<Buffer> => {
		const bytes = await readStable({ root, relativePath, maximum });
		const hash = digest({ bytes });
		const key = path.join(root.canonical, relativePath);
		const previous = files.get(key);
		requireEvidence({
			condition: !expected || expected === hash,
			message: `SHA mismatch: ${relativePath}`,
		});
		requireEvidence({
			condition: !previous || previous.hash === hash,
			message: `file changed: ${relativePath}`,
		});
		if (!previous) totalBytes += bytes.length;
		requireEvidence({
			condition: totalBytes <= 64 * MIB,
			message: "research read budget exceeded",
		});
		files.set(key, { root, relativePath, maximum, hash });
		return bytes;
	};
	return {
		read,
		verify: async (): Promise<void> => {
			await [...files.values()].reduce(
				(previous, file) =>
					previous.then(async () => {
						const bytes = await readStable(file);
						requireEvidence({
							condition: digest({ bytes }) === file.hash,
							message: `file changed during load: ${file.relativePath}`,
						});
					}),
				Promise.resolve()
			);
		},
	};
}

export type Snapshot = ReturnType<typeof createSnapshot>;

export async function readJson<S extends z.ZodTypeAny>({
	snapshot,
	root,
	relativePath,
	maximum,
	schema,
	expected,
}: {
	snapshot: Snapshot;
	root: PinnedRoot;
	relativePath: string;
	maximum: number;
	schema: S;
	expected?: string;
}): Promise<{ value: z.infer<S>; hash: string }> {
	const bytes = await snapshot.read({ root, relativePath, maximum, expected });
	return {
		value: schema.parse(JSON.parse(bytes.toString("utf8"))),
		hash: digest({ bytes }),
	};
}

export function decodeInput({
	bytes,
	expected,
}: {
	bytes: Buffer;
	expected: string;
}): Uint8Array {
	requireEvidence({
		condition: bytes
			.subarray(0, 8)
			.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
		message: "input is not PNG",
	});
	const compressed: Buffer[] = [];
	let offset = 8;
	let ended = false;
	while (offset < bytes.length) {
		requireEvidence({
			condition: bytes.length - offset >= 12,
			message: "truncated PNG chunk",
		});
		const length = bytes.readUInt32BE(offset);
		const end = offset + length + 12;
		const type = bytes.toString("ascii", offset + 4, offset + 8);
		requireEvidence({
			condition: end <= bytes.length && !ended,
			message: "invalid PNG chunk length",
		});
		requireEvidence({
			condition:
				crc32(bytes.subarray(offset + 4, end - 4)) ===
				bytes.readUInt32BE(end - 4),
			message: "PNG CRC mismatch",
		});
		if (offset === 8) {
			requireEvidence({
				condition:
					type === "IHDR" &&
					length === 13 &&
					bytes.readUInt32BE(offset + 8) === WIDTH &&
					bytes.readUInt32BE(offset + 12) === HEIGHT &&
					bytes
						.subarray(offset + 16, offset + 21)
						.equals(Buffer.from([8, 6, 0, 0, 0])),
				message: "PNG must be the recorded non-interlaced RGBA8 dimensions",
			});
		} else if (type === "IDAT") {
			compressed.push(bytes.subarray(offset + 8, end - 4));
		} else {
			requireEvidence({
				condition: type === "IEND" && length === 0 && compressed.length > 0,
				message: "unsupported PNG chunk",
			});
			ended = true;
		}
		offset = end;
	}
	requireEvidence({ condition: ended, message: "missing PNG end" });
	// Bound decompression before the existing PNG library allocates its decoded channels.
	const scanlineBytes = HEIGHT * (WIDTH * 4 + 1);
	const inflated = inflateSync(Buffer.concat(compressed), {
		maxOutputLength: scanlineBytes,
	});
	requireEvidence({
		condition: inflated.length === scanlineBytes,
		message: "PNG scanline count differs",
	});
	const rgba = new Uint8Array(RGBA_BYTES);
	const rowBytes = WIDTH * 4;
	let unfiltered = true;
	for (let row = 0; row < HEIGHT; row++) {
		if (inflated[row * (rowBytes + 1)] !== 0) {
			unfiltered = false;
			break;
		}
	}
	if (unfiltered) {
		// Filter 0 is already RGBA; avoid splitting and rejoining millions of channels.
		for (let row = 0; row < HEIGHT; row++) {
			const start = row * (rowBytes + 1) + 1;
			rgba.set(inflated.subarray(start, start + rowBytes), row * rowBytes);
		}
	} else {
		const image = PNG.load(Uint8Array.from(bytes));
		for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) {
			rgba[pixel * 4] = image.rgbChannel[pixel * 3];
			rgba[pixel * 4 + 1] = image.rgbChannel[pixel * 3 + 1];
			rgba[pixel * 4 + 2] = image.rgbChannel[pixel * 3 + 2];
			rgba[pixel * 4 + 3] = image.alphaChannel?.[pixel] ?? 255;
		}
	}
	requireEvidence({
		condition: digest({ bytes: rgba }) === expected,
		message: "input RGBA SHA mismatch",
	});
	return rgba;
}
