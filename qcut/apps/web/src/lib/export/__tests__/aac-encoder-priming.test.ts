import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createPrimingBurst,
	locatePrimingFrames,
	measureAacEncoderPriming,
} from "../aac-encoder-priming";

describe("locatePrimingFrames", () => {
	it("finds the burst at its shifted position", () => {
		const reference = createPrimingBurst();
		const decoded = new Float32Array(16_384);
		decoded.set(
			reference.map((sample) => sample * 0.7),
			4096 + 2112
		);

		const result = locatePrimingFrames({
			reference,
			decoded,
			burstStart: 4096,
			maxLag: 8192,
		});

		expect(result.frames).toBe(2112);
		expect(result.correlation).toBeCloseTo(1, 5);
	});

	it("reports no correlation when the burst never comes back", () => {
		const result = locatePrimingFrames({
			reference: createPrimingBurst(),
			decoded: new Float32Array(16_384),
			burstStart: 4096,
			maxLag: 8192,
		});

		expect(result.correlation).toBe(0);
	});
});

/**
 * WebCodecs stand-ins: the "encoder" prepends `priming` silent frames to
 * channel 0 and the "decoder" hands them straight back.
 */
function stubWebCodecs({
	priming,
	supported = true,
	encoders,
}: {
	priming: number;
	supported?: boolean;
	encoders: { count: number; codecs?: string[] };
}) {
	vi.stubGlobal(
		"AudioData",
		class {
			readonly numberOfFrames: number;
			readonly samples: Float32Array;
			constructor(init: { numberOfFrames: number; data: Float32Array }) {
				this.numberOfFrames = init.numberOfFrames;
				this.samples = init.data.slice(0, init.numberOfFrames);
			}
			close() {}
		}
	);
	vi.stubGlobal(
		"AudioEncoder",
		class {
			static isConfigSupported = async () => ({ supported });
			state = "unconfigured";
			private input: Float32Array | null = null;
			constructor(
				private readonly init: {
					output: (chunk: unknown, meta?: unknown) => void;
				}
			) {
				encoders.count += 1;
			}
			configure(config: { codec: string }) {
				this.state = "configured";
				encoders.codecs?.push(config.codec);
			}
			encode(data: { samples: Float32Array }) {
				this.input = data.samples;
			}
			async flush() {
				const primed = new Float32Array(priming + (this.input?.length ?? 0));
				primed.set(this.input ?? new Float32Array(), priming);
				this.init.output(
					{ samples: primed },
					{ decoderConfig: { codec: "mp4a.40.2" } }
				);
			}
			close() {
				this.state = "closed";
			}
		}
	);
	vi.stubGlobal(
		"AudioDecoder",
		class {
			state = "unconfigured";
			constructor(private readonly init: { output: (data: unknown) => void }) {}
			configure() {
				this.state = "configured";
			}
			decode(chunk: { samples: Float32Array }) {
				this.init.output({
					numberOfFrames: chunk.samples.length,
					copyTo: (destination: Float32Array) => destination.set(chunk.samples),
					close: () => {},
				});
			}
			async flush() {}
			close() {
				this.state = "closed";
			}
		}
	);
}

describe("measureAacEncoderPriming", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("measures the encoder's priming once per configuration", async () => {
		const encoders = { count: 0 };
		stubWebCodecs({ priming: 2112, encoders });
		const config = { sampleRate: 48_000, numberOfChannels: 1, bitrate: 96_000 };

		await expect(measureAacEncoderPriming(config)).resolves.toBe(2112);
		await expect(measureAacEncoderPriming(config)).resolves.toBe(2112);

		expect(encoders.count).toBe(1);
	});

	it("retries a configuration whose measurement failed", async () => {
		const encoders = { count: 0 };
		const config = { sampleRate: 44_100, numberOfChannels: 1, bitrate: 64_000 };
		stubWebCodecs({ priming: 1024, supported: false, encoders });
		await expect(measureAacEncoderPriming(config)).rejects.toThrow(
			"AAC encoding is not supported"
		);

		vi.unstubAllGlobals();
		stubWebCodecs({ priming: 1024, encoders });
		await expect(measureAacEncoderPriming(config)).resolves.toBe(1024);
	});

	it("probes the AAC profile mediabunny encodes with", async () => {
		const encoders = { count: 0, codecs: [] as string[] };
		stubWebCodecs({ priming: 2048, encoders });
		for (const config of [
			{ sampleRate: 22_050, numberOfChannels: 2, bitrate: 48_000 },
			{ sampleRate: 22_050, numberOfChannels: 1, bitrate: 48_000 },
			{ sampleRate: 32_000, numberOfChannels: 2, bitrate: 48_000 },
		]) {
			await measureAacEncoderPriming(config);
		}

		expect(encoders.codecs).toEqual(["mp4a.40.29", "mp4a.40.5", "mp4a.40.2"]);
	});
});
