/** Decode into the source/container clock, retaining gaps and trimming codec preroll. */
export async function decodeBrowserAudioSource({
	context,
	bytes,
}: {
	context: BaseAudioContext;
	bytes: ArrayBuffer;
}): Promise<AudioBuffer | null> {
	const { ALL_FORMATS, AudioBufferSink, BlobSource, Input } = await import(
		"mediabunny"
	);
	const input = new Input({
		formats: ALL_FORMATS,
		source: new BlobSource(new Blob([bytes])),
	});
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) return null;
		const [decodable, endTimestamp] = await Promise.all([
			track.canDecode(),
			track.computeDuration(),
		]);
		if (!decodable) throw new Error("Audio track codec cannot be decoded");
		if (!Number.isFinite(endTimestamp) || endTimestamp <= 0) {
			throw new Error("Audio track has an invalid duration");
		}
		let result: AudioBuffer | null = null;
		const sink = new AudioBufferSink(track);
		let decodedSamples = 0;
		// The sink smooths sub-frame packet jitter; decodeAudioData can instead
		// discard every overlap, shortening an otherwise continuous AAC track.
		for await (const { buffer, timestamp } of sink.buffers()) {
			if (!result) {
				// HE-AAC can decode at an extended rate/channel layout which differs
				// from the container's base AAC configuration.
				const { sampleRate, numberOfChannels } = buffer;
				const length = Math.ceil(endTimestamp * sampleRate);
				if (
					!Number.isInteger(sampleRate) ||
					sampleRate <= 0 ||
					!Number.isInteger(numberOfChannels) ||
					numberOfChannels <= 0 ||
					!Number.isSafeInteger(length) ||
					length <= 0
				) {
					throw new Error("Audio decoder returned invalid dimensions");
				}
				result = context.createBuffer(numberOfChannels, length, sampleRate);
			}
			const { sampleRate, numberOfChannels: channels, length } = result;
			if (
				!Number.isFinite(timestamp) ||
				buffer.sampleRate !== sampleRate ||
				buffer.numberOfChannels !== channels
			) {
				throw new Error(
					"Audio decoder returned an invalid timestamp or changed format"
				);
			}
			const offset = Math.round(timestamp * sampleRate);
			if (!Number.isSafeInteger(offset)) {
				throw new Error("Audio decoder timestamp exceeds sample precision");
			}
			const sourceStart = Math.max(0, -offset);
			const targetStart = Math.max(0, offset);
			const count = Math.min(buffer.length - sourceStart, length - targetStart);
			if (count <= 0) continue;
			for (let channel = 0; channel < channels; channel++) {
				// True gaps remain zero; a later overlapping buffer replaces only
				// its own interval, never shortening subsequent presentation time.
				result
					.getChannelData(channel)
					.set(
						buffer
							.getChannelData(channel)
							.subarray(sourceStart, sourceStart + count),
						targetStart
					);
			}
			decodedSamples += count;
		}
		if (!result || decodedSamples === 0)
			throw new Error("Audio track decoded no presentation samples");
		return result;
	} finally {
		input.dispose();
	}
}
