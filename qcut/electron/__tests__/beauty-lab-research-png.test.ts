// @vitest-environment node
import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { PNG } from "pdf-lib/cjs/utils/png.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	decodeInput,
	WIDTH,
	HEIGHT,
	RGBA_BYTES,
} from "../beauty-lab/beauty-lab-research-files.js";

const input = Buffer.alloc(RGBA_BYTES, 11);
input[0] = 255;
input[1] = 19;
input[input.length - 1] = 0;
const hash = createHash("sha256").update(input).digest("hex");

function chunk({ type, bytes }: { type: string; bytes: Buffer }) {
	const result = Buffer.alloc(bytes.length + 12);
	result.writeUInt32BE(bytes.length);
	result.write(type, 4, "ascii");
	bytes.copy(result, 8);
	result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4);
	return result;
}

function png({
	filtered,
	split = false,
	extraBytes = 0,
}: {
	filtered: boolean;
	split?: boolean;
	extraBytes?: number;
}) {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(WIDTH);
	header.writeUInt32BE(HEIGHT, 4);
	header[8] = 8;
	header[9] = 6;
	const rowBytes = WIDTH * 4;
	const scanlines = Buffer.alloc(HEIGHT * (rowBytes + 1) + extraBytes);
	for (let row = 0; row < HEIGHT; row++) {
		const start = row * (rowBytes + 1);
		scanlines[start] = filtered && row === HEIGHT - 1 ? 2 : 0;
		const source = input.subarray(row * rowBytes, (row + 1) * rowBytes);
		if (scanlines[start] === 0) {
			source.copy(scanlines, start + 1);
			continue;
		}
		for (let offset = 0; offset < rowBytes; offset++) {
			scanlines[start + offset + 1] =
				(source[offset] - input[(row - 1) * rowBytes + offset] + 256) % 256;
		}
	}
	const compressed = deflateSync(scanlines);
	const midpoint = Math.floor(compressed.length / 2);
	const parts = split
		? [compressed.subarray(0, midpoint), compressed.subarray(midpoint)]
		: [compressed];
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk({ type: "IHDR", bytes: header }),
		...parts.map((bytes) => chunk({ type: "IDAT", bytes })),
		chunk({ type: "IEND", bytes: Buffer.alloc(0) }),
	]);
}

afterEach(() => vi.restoreAllMocks());

describe("Beauty Lab bounded PNG decoding", () => {
	it.each([
		{ split: false },
		{ split: true },
	])("decodes unfiltered RGBA directly, split IDAT=$split", ({ split }) => {
		const load = vi.spyOn(PNG, "load");
		const bytes = png({ filtered: false, split });
		const decoded = decodeInput({ bytes, expected: hash });
		expect(Buffer.from(decoded).equals(input)).toBe(true);
		expect(load).not.toHaveBeenCalled();
		expect(decoded.byteLength).toBe(RGBA_BYTES);
	});
	it("uses the existing codec when even the last row has a filter", () => {
		const load = vi.spyOn(PNG, "load");
		const bytes = png({ filtered: true });
		expect(
			Buffer.from(decodeInput({ bytes, expected: hash })).equals(input)
		).toBe(true);
		expect(load).toHaveBeenCalledOnce();
	});
	it("retains exact decoded SHA rejection on the fast path", () => {
		expect(() =>
			decodeInput({ bytes: png({ filtered: false }), expected: "0".repeat(64) })
		).toThrow("input RGBA SHA mismatch");
	});
	it("checks CRC before accepting unfiltered pixels", () => {
		const bytes = png({ filtered: false });
		bytes[29] ^= 1;
		expect(() => decodeInput({ bytes, expected: hash })).toThrow(
			"CRC mismatch"
		);
	});
	it("rejects trailing bytes after IEND", () => {
		const bytes = Buffer.concat([png({ filtered: false }), Buffer.alloc(12)]);
		expect(() => decodeInput({ bytes, expected: hash })).toThrow(
			"invalid PNG chunk length"
		);
	});
	it.each([
		{ extraBytes: -1 },
		{ extraBytes: 1 },
	])("rejects an invalid inflated byte count, extra=$extraBytes", ({
		extraBytes,
	}) => {
		expect(() =>
			decodeInput({
				bytes: png({ filtered: false, extraBytes }),
				expected: hash,
			})
		).toThrow();
	});
});
