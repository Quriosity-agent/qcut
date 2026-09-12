// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FilterResponseBuffer } from "../qcut-independent-filter/response-buffer.js";

describe("Metal response buffer", () => {
	it("reads fragmented handshake and frame bytes without consuming incomplete reads", () => {
		const buffer = new FilterResponseBuffer({ maximumBytes: 32 });
		buffer.append({ chunk: Buffer.from([0x31, 0x4d]) });
		expect(buffer.read({ size: 4 })).toBeUndefined();
		buffer.append({ chunk: Buffer.from([0x46, 0x51, 1, 2]) });
		expect(buffer.read({ size: 4 })?.readUInt32LE()).toBe(0x51464d31);
		expect(buffer.read({ size: 4 })).toBeUndefined();
		buffer.append({ chunk: Buffer.from([3, 4]) });
		expect(buffer.read({ size: 4 })).toEqual(Buffer.from([1, 2, 3, 4]));
		expect(buffer.read({ size: 1 })).toBeUndefined();
	});

	it("keeps coalesced responses and partial chunk offsets in order", () => {
		const buffer = new FilterResponseBuffer({ maximumBytes: 32 });
		buffer.append({ chunk: Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8]) });
		expect(buffer.read({ size: 4 })).toEqual(Buffer.from([0, 1, 2, 3]));
		expect(buffer.read({ size: 4 })).toEqual(Buffer.from([4, 5, 6, 7]));
		buffer.append({ chunk: Buffer.from([9, 10, 11, 12]) });
		expect(buffer.read({ size: 4 })).toEqual(Buffer.from([8, 9, 10, 11]));
		expect(buffer.read({ size: 1 })).toEqual(Buffer.from([12]));
	});

	it("handles thousands of fragments and returns independent frame storage", () => {
		const buffer = new FilterResponseBuffer({ maximumBytes: 4096 });
		const source = Buffer.from(
			Array.from({ length: 4096 }, (_, index) => index % 256)
		);
		for (let index = 0; index < source.length; index += 1)
			buffer.append({ chunk: source.subarray(index, index + 1) });
		const result = buffer.read({ size: 4096 });
		expect(result).toEqual(source);
		source.fill(0);
		expect(result?.at(257)).toBe(1);
	});

	it("rejects overflow before retaining bytes and frees capacity after reads", () => {
		const buffer = new FilterResponseBuffer({ maximumBytes: 4 });
		buffer.append({ chunk: Buffer.from([1, 2, 3]) });
		expect(() => buffer.append({ chunk: Buffer.from([4, 5]) })).toThrow(
			"Invalid Metal frame response"
		);
		buffer.append({ chunk: Buffer.from([4]) });
		expect(buffer.read({ size: 4 })).toEqual(Buffer.from([1, 2, 3, 4]));
		buffer.append({ chunk: Buffer.from([5, 6, 7, 8]) });
		expect(buffer.read({ size: 4 })).toEqual(Buffer.from([5, 6, 7, 8]));
	});

	it("clears partial input on failure or disposal", () => {
		const buffer = new FilterResponseBuffer({ maximumBytes: 4 });
		buffer.append({ chunk: Buffer.from([1, 2, 3]) });
		buffer.read({ size: 1 });
		buffer.clear();
		expect(buffer.read({ size: 1 })).toBeUndefined();
		buffer.append({ chunk: Buffer.from([4, 5, 6, 7]) });
		expect(buffer.read({ size: 4 })).toEqual(Buffer.from([4, 5, 6, 7]));
	});

	it("ignores empty chunks and rejects invalid read sizes and limits", () => {
		const buffer = new FilterResponseBuffer({ maximumBytes: 4 });
		buffer.append({ chunk: Buffer.alloc(0) });
		expect(buffer.read({ size: 4 })).toBeUndefined();
		for (const size of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 5])
			expect(() => buffer.read({ size })).toThrow(
				"Invalid Metal response size"
			);
		for (const maximumBytes of [0, -1, 1.5, Number.NaN])
			expect(() => new FilterResponseBuffer({ maximumBytes })).toThrow(
				"Invalid Metal response buffer limit"
			);
	});
});
