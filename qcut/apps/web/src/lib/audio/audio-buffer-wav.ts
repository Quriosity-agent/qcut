function writeAscii({
	view,
	offset,
	value,
}: {
	view: DataView;
	offset: number;
	value: string;
}) {
	for (let index = 0; index < value.length; index += 1) {
		view.setUint8(offset + index, value.charCodeAt(index));
	}
}

function pcm16({ sample }: { sample: number }): number {
	const clamped = Math.max(-1, Math.min(1, sample));
	return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}

/**
 * `pcm16` clips anything past full scale; `float32` keeps samples as rendered,
 * which is what stems need since they are taken before the master limiter.
 */
export type WavSampleFormat = "pcm16" | "float32";

export function encodeAudioBufferAsWav({
	buffer,
	format = "pcm16",
}: {
	buffer: AudioBuffer;
	format?: WavSampleFormat;
}): ArrayBuffer {
	const channelCount = Math.min(2, Math.max(1, buffer.numberOfChannels));
	const bytesPerSample = format === "float32" ? 4 : 2;
	const dataSize = buffer.length * channelCount * bytesPerSample;
	const output = new ArrayBuffer(44 + dataSize);
	const view = new DataView(output);

	writeAscii({ view, offset: 0, value: "RIFF" });
	view.setUint32(4, 36 + dataSize, true);
	writeAscii({ view, offset: 8, value: "WAVE" });
	writeAscii({ view, offset: 12, value: "fmt " });
	view.setUint32(16, 16, true);
	// 1 = integer PCM, 3 = IEEE float.
	view.setUint16(20, format === "float32" ? 3 : 1, true);
	view.setUint16(22, channelCount, true);
	view.setUint32(24, buffer.sampleRate, true);
	view.setUint32(28, buffer.sampleRate * channelCount * bytesPerSample, true);
	view.setUint16(32, channelCount * bytesPerSample, true);
	view.setUint16(34, bytesPerSample * 8, true);
	writeAscii({ view, offset: 36, value: "data" });
	view.setUint32(40, dataSize, true);

	const channels = Array.from({ length: channelCount }, (_, channel) =>
		buffer.getChannelData(channel)
	);
	let offset = 44;
	for (let frame = 0; frame < buffer.length; frame += 1) {
		for (const channel of channels) {
			if (format === "float32") {
				view.setFloat32(offset, channel[frame], true);
			} else {
				view.setInt16(offset, pcm16({ sample: channel[frame] }), true);
			}
			offset += bytesPerSample;
		}
	}
	return output;
}
