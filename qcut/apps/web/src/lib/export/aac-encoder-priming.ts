/**
 * AAC encoders begin their output with priming frames (2112 for macOS
 * AudioToolbox), yet WebCodecs still stamps the first packet at 0. Unless the
 * MP4 declares the priming, every player starts the audio that much late.
 *
 * The amount belongs to the platform encoder, so it is measured rather than
 * assumed: a short noise burst goes through the same encoder configuration
 * the export uses, and the decoded copy is located by cross-correlation.
 * Noise has one sharp correlation peak; a tone would match every period.
 */

const BURST_START_FRAME = 4096;
const BURST_FRAMES = 1024;
const PROBE_FRAMES = 16_384;
const MAX_PRIMING_FRAMES = 8192;
// Measured 0.80–0.87 for AAC-LC at 96–192 kbps; a failed round trip scores
// near zero.
const MIN_CORRELATION = 0.5;

export interface AacPrimingConfig {
	sampleRate: number;
	numberOfChannels: number;
	bitrate: number;
}

/** Deterministic white noise, so every measurement sees the same signal. */
export function createPrimingBurst(): Float32Array {
	const burst = new Float32Array(BURST_FRAMES);
	let seed = 0x2112;
	for (let index = 0; index < burst.length; index += 1) {
		seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
		burst[index] = ((seed / 0xffff_ffff) * 2 - 1) * 0.5;
	}
	return burst;
}

/**
 * Finds how many frames later than `burstStart` the burst reappears in
 * `decoded`, scoring each lag by normalized correlation.
 */
export function locatePrimingFrames({
	reference,
	decoded,
	burstStart,
	maxLag,
}: {
	reference: Float32Array;
	decoded: Float32Array;
	burstStart: number;
	maxLag: number;
}): { frames: number; correlation: number } {
	let referenceEnergy = 0;
	for (const sample of reference) referenceEnergy += sample * sample;
	let best = { frames: -1, correlation: 0 };
	for (let lag = 0; lag <= maxLag; lag += 1) {
		const start = burstStart + lag;
		if (start + reference.length > decoded.length) break;
		let dot = 0;
		let energy = 0;
		for (let index = 0; index < reference.length; index += 1) {
			const sample = decoded[start + index];
			dot += sample * reference[index];
			energy += sample * sample;
		}
		const correlation =
			energy > 0 ? dot / Math.sqrt(energy * referenceEnergy) : 0;
		if (correlation > best.correlation) best = { frames: lag, correlation };
	}
	return best;
}

/**
 * Mirrors mediabunny's `buildAudioCodecString` for `codec: "aac"`, so the probe
 * measures the same profile the export encodes with.
 */
export function aacCodecString({
	sampleRate,
	numberOfChannels,
}: Pick<AacPrimingConfig, "sampleRate" | "numberOfChannels">): string {
	if (sampleRate > 24_000) return "mp4a.40.2"; // AAC-LC
	// HE-AAC v2 (SBR + PS) for stereo, v1 (SBR) for mono.
	return numberOfChannels >= 2 ? "mp4a.40.29" : "mp4a.40.5";
}

function aacEncoderConfig(config: AacPrimingConfig): AudioEncoderConfig {
	return {
		codec: aacCodecString(config),
		sampleRate: config.sampleRate,
		numberOfChannels: config.numberOfChannels,
		bitrate: config.bitrate,
		aac: { format: "aac" },
	} as AudioEncoderConfig;
}

async function encodeProbe({
	config,
	reference,
}: {
	config: AacPrimingConfig;
	reference: Float32Array;
}): Promise<{
	chunks: EncodedAudioChunk[];
	decoderConfig: AudioDecoderConfig;
}> {
	const encoderConfig = aacEncoderConfig(config);
	const support = await AudioEncoder.isConfigSupported(encoderConfig);
	if (!support.supported) {
		throw new Error(
			`AAC encoding is not supported at ${config.sampleRate} Hz, ${config.numberOfChannels} channels`
		);
	}
	const chunks: EncodedAudioChunk[] = [];
	let decoderConfig: AudioDecoderConfig | undefined;
	let failure: unknown;
	const encoder = new AudioEncoder({
		output: (chunk, meta) => {
			if (meta?.decoderConfig) decoderConfig = meta.decoderConfig;
			chunks.push(chunk);
		},
		error: (error) => {
			failure = error;
		},
	});
	const planar = new Float32Array(PROBE_FRAMES * config.numberOfChannels);
	for (let channel = 0; channel < config.numberOfChannels; channel += 1) {
		planar.set(reference, channel * PROBE_FRAMES + BURST_START_FRAME);
	}
	const audio = new AudioData({
		format: "f32-planar",
		sampleRate: config.sampleRate,
		numberOfFrames: PROBE_FRAMES,
		numberOfChannels: config.numberOfChannels,
		timestamp: 0,
		data: planar,
	});
	try {
		encoder.configure(encoderConfig);
		encoder.encode(audio);
		await encoder.flush();
	} finally {
		audio.close();
		if (encoder.state !== "closed") encoder.close();
	}
	if (failure) throw failure;
	if (!decoderConfig) {
		throw new Error("The AAC encoder returned no decoder configuration");
	}
	return { chunks, decoderConfig };
}

async function decodeFirstChannel({
	chunks,
	decoderConfig,
}: {
	chunks: EncodedAudioChunk[];
	decoderConfig: AudioDecoderConfig;
}): Promise<Float32Array> {
	const parts: Float32Array[] = [];
	let failure: unknown;
	const decoder = new AudioDecoder({
		output: (data) => {
			const part = new Float32Array(data.numberOfFrames);
			data.copyTo(part, { planeIndex: 0, format: "f32-planar" });
			parts.push(part);
			data.close();
		},
		error: (error) => {
			failure = error;
		},
	});
	try {
		decoder.configure(decoderConfig);
		for (const chunk of chunks) decoder.decode(chunk);
		await decoder.flush();
	} finally {
		if (decoder.state !== "closed") decoder.close();
	}
	if (failure) throw failure;
	const decoded = new Float32Array(
		parts.reduce((total, part) => total + part.length, 0)
	);
	let offset = 0;
	for (const part of parts) {
		decoded.set(part, offset);
		offset += part.length;
	}
	return decoded;
}

async function roundTripPriming(config: AacPrimingConfig): Promise<number> {
	const reference = createPrimingBurst();
	const encoded = await encodeProbe({ config, reference });
	const decoded = await decodeFirstChannel(encoded);
	const { frames, correlation } = locatePrimingFrames({
		reference,
		decoded,
		burstStart: BURST_START_FRAME,
		maxLag: MAX_PRIMING_FRAMES,
	});
	if (correlation < MIN_CORRELATION) {
		throw new Error(
			`Could not measure the AAC encoder priming (correlation ${correlation.toFixed(2)})`
		);
	}
	return frames;
}

const primingByConfig = new Map<string, Promise<number>>();

/**
 * Frames of priming the platform AAC encoder prepends for `config`. Measured
 * once per configuration; a failed measurement is retried next time.
 */
export function measureAacEncoderPriming(
	config: AacPrimingConfig
): Promise<number> {
	const key = `${config.sampleRate}|${config.numberOfChannels}|${config.bitrate}`;
	let priming = primingByConfig.get(key);
	if (!priming) {
		priming = roundTripPriming(config);
		primingByConfig.set(key, priming);
		priming.catch(() => primingByConfig.delete(key));
	}
	return priming;
}
