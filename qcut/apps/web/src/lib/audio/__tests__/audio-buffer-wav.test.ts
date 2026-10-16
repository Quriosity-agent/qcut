import { describe, expect, it } from "vitest";
import { encodeAudioBufferAsWav } from "../audio-buffer-wav";

function fakeBuffer({
	channels,
	sampleRate = 48_000,
}: {
	channels: Float32Array[];
	sampleRate?: number;
}): AudioBuffer {
	return {
		numberOfChannels: channels.length,
		length: channels[0].length,
		sampleRate,
		getChannelData: (index: number) => channels[index],
	} as unknown as AudioBuffer;
}

describe("encodeAudioBufferAsWav", () => {
	it("writes 16-bit PCM by default and clips past full scale", () => {
		const wav = encodeAudioBufferAsWav({
			buffer: fakeBuffer({
				channels: [
					new Float32Array([0, 0.5, 1.5]),
					new Float32Array([0, -0.5, -1.5]),
				],
			}),
		});
		const view = new DataView(wav);
		expect(view.getUint16(20, true)).toBe(1);
		expect(view.getUint16(34, true)).toBe(16);
		expect(view.getUint32(40, true)).toBe(3 * 2 * 2);
		expect(view.getInt16(44 + 2 * 2 * 2, true)).toBe(0x7fff);
		expect(view.getInt16(44 + 2 * 2 * 2 + 2, true)).toBe(-0x8000);
	});

	it("keeps samples past full scale as 32-bit float when asked", () => {
		const wav = encodeAudioBufferAsWav({
			buffer: fakeBuffer({
				channels: [
					new Float32Array([0.25, 1.5]),
					new Float32Array([-0.25, -1.5]),
				],
			}),
			format: "float32",
		});
		const view = new DataView(wav);
		expect(view.getUint16(20, true)).toBe(3);
		expect(view.getUint16(34, true)).toBe(32);
		expect(view.getUint16(32, true)).toBe(8);
		expect(view.getUint32(28, true)).toBe(48_000 * 8);
		expect(view.getUint32(40, true)).toBe(2 * 2 * 4);
		expect(view.getFloat32(44 + 2 * 4, true)).toBeCloseTo(1.5, 6);
		expect(view.getFloat32(44 + 3 * 4, true)).toBeCloseTo(-1.5, 6);
	});
});
