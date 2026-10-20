import { expect, type Page } from "@playwright/test";
import { drivePreparedBodyPlayback } from "./body-playback-driver";

interface OutputMarker {
	contextTime: number;
	outputPerformanceMs: number | null;
	receivedPerformanceMs: number;
	outputTimestamp: AudioTimestamp;
}
interface AudioClockFrame {
	frame: number;
	atMs: number;
	isPlaying: boolean;
	media: Array<{
		currentTime: number;
		paused: boolean;
		muted: boolean;
		playbackRate: number;
		contextTime: number;
		outputTime: number;
		outputPerformanceMs: number;
		baseLatency: number;
		outputLatency: number;
		state: string;
	}>;
}
interface AudioClockProbe {
	stage: string | null;
	frames: AudioClockFrame[];
	markers: OutputMarker[];
	errors: string[];
	peak: number;
	taps: Array<{ context: AudioContext; node: AudioWorkletNode }>;
	media: Array<{ context: AudioContext; element: HTMLMediaElement }>;
}
interface AudioClockWindow {
	__bodyAudioClock?: AudioClockProbe;
	__playbackStore: { getState: () => { isPlaying: boolean } };
}

/** Must run before project import/reload so the real preview graph is observed from creation. */
export async function installBodyAudioClockProbe({ page }: { page: Page }) {
	await page.addInitScript(() => {
		const target = window as unknown as AudioClockWindow;
		const state: AudioClockProbe = {
			stage: null,
			frames: [],
			markers: [],
			errors: [],
			peak: 0,
			taps: [],
			media: [],
		};
		target.__bodyAudioClock = state;
		const createSource = AudioContext.prototype.createMediaElementSource;
		AudioContext.prototype.createMediaElementSource = function (element) {
			const result = createSource.call(this, element);
			state.media.push({ context: this, element });
			return result;
		};
		const originalConnect = AudioNode.prototype.connect;
		const connected = new WeakSet<AudioNode>();
		const registrations = new WeakMap<AudioContext, Promise<void>>();
		const attach = async ({
			source,
			context,
		}: {
			source: AudioNode;
			context: AudioContext;
		}) => {
			let registration = registrations.get(context);
			if (!registration) {
				const url = URL.createObjectURL(
					new Blob(
						[
							`
class BodyOutputClock extends AudioWorkletProcessor {
	constructor() { super(); this.active = false; this.blocks = 0; this.maximum = 0; }
	process(inputs) {
		const channels = inputs[0] || [];
		let peak = 0;
		let first = -1;
		for (const channel of channels) {
			for (let i = 0; i < channel.length; i++) {
				const value = Math.abs(channel[i]);
				peak = Math.max(peak, value);
				if (value > 0.01 && (first < 0 || i < first)) first = i;
			}
		}
		if (first >= 0 && !this.active) this.port.postMessage({ marker: true, contextTime: currentTime + first / sampleRate });
		this.active = first >= 0;
		this.maximum = Math.max(this.maximum, peak);
		if (++this.blocks >= 20) {
			this.port.postMessage({ peak: this.maximum });
			this.blocks = 0; this.maximum = 0;
		}
		return true;
	}
}
registerProcessor("qcut-body-output-clock", BodyOutputClock);
`,
						],
						{ type: "application/javascript" }
					)
				);
				registration = context.audioWorklet
					.addModule(url)
					.finally(() => URL.revokeObjectURL(url));
				registrations.set(context, registration);
			}
			await registration;
			const node = new AudioWorkletNode(context, "qcut-body-output-clock", {
				numberOfInputs: 1,
				numberOfOutputs: 1,
				outputChannelCount: [1],
			});
			node.port.onmessage = ({
				data,
			}: MessageEvent<{
				marker?: boolean;
				contextTime?: number;
				peak?: number;
			}>) => {
				if (!state.stage) return;
				if (typeof data.peak === "number")
					state.peak = Math.max(state.peak, data.peak);
				if (data.marker && typeof data.contextTime === "number") {
					const stamp = context.getOutputTimestamp();
					state.markers.push({
						contextTime: data.contextTime,
						outputPerformanceMs:
							typeof stamp.performanceTime === "number" &&
							typeof stamp.contextTime === "number" &&
							stamp.performanceTime > 0
								? stamp.performanceTime +
									(data.contextTime - stamp.contextTime) * 1000
								: null,
						receivedPerformanceMs: performance.now(),
						outputTimestamp: stamp,
					});
				}
			};
			// Existing destination connection stays intact; the observer's extra output is all zeroes.
			Reflect.apply(originalConnect, source, [node]);
			Reflect.apply(originalConnect, node, [context.destination]);
			state.taps.push({ context, node });
		};
		AudioNode.prototype.connect = function (
			this: AudioNode,
			...args: unknown[]
		) {
			const result = Reflect.apply(originalConnect, this, args);
			const destination = args[0] as unknown;
			if (
				destination instanceof AudioDestinationNode &&
				this.context instanceof AudioContext &&
				!connected.has(this)
			) {
				connected.add(this);
				void attach({ source: this, context: this.context }).catch(
					(error: unknown) =>
						state.errors.push(
							error instanceof Error ? error.message : String(error)
						)
				);
			}
			return result;
		} as AudioNode["connect"];
		document.addEventListener(
			"qcut-effect-playback-frame",
			(event) => {
				if (!state.stage) return;
				const frame = (event as CustomEvent<{ frame: number }>).detail.frame;
				state.frames.push({
					frame,
					atMs: performance.now(),
					isPlaying: target.__playbackStore.getState().isPlaying,
					media: state.media
						.filter(({ element }) => element.isConnected)
						.map(({ element, context }) => {
							const stamp = context.getOutputTimestamp();
							return {
								currentTime: element.currentTime,
								paused: element.paused,
								muted: element.muted,
								playbackRate: element.playbackRate,
								contextTime: context.currentTime,
								outputTime: Number(stamp.contextTime),
								outputPerformanceMs: Number(stamp.performanceTime),
								baseLatency: context.baseLatency,
								outputLatency: context.outputLatency,
								state: context.state,
							};
						}),
				});
			},
			true
		);
	});
}

export async function captureBodyAudioPlayback({
	page,
	frames,
	fps,
	stage,
}: {
	page: Page;
	frames: number;
	fps: number;
	stage: string;
}) {
	await expect
		.poll(
			() =>
				page.evaluate(
					() =>
						(window as unknown as AudioClockWindow).__bodyAudioClock?.taps
							.length ?? 0
				),
			{ timeout: 30_000 }
		)
		.toBeGreaterThan(0);
	await drivePreparedBodyPlayback({
		page,
		frames,
		fps,
		beforePlay: () =>
			page.evaluate((stage) => {
				const state = (window as unknown as AudioClockWindow).__bodyAudioClock;
				if (!state) throw new Error("Audio output clock probe missing");
				state.stage = stage;
				state.frames = [];
				state.markers = [];
				state.peak = 0;
			}, stage),
	});
	return page.evaluate(() => {
		const state = (window as unknown as AudioClockWindow).__bodyAudioClock;
		if (!state) throw new Error("Audio output clock probe missing");
		state.stage = null;
		return {
			frames: state.frames,
			markers: state.markers,
			errors: state.errors,
			peak: state.peak,
			taps: state.taps.length,
			contexts: state.taps.map(({ context }) => ({
				state: context.state,
				baseLatency: context.baseLatency,
				outputLatency: context.outputLatency,
				sampleRate: context.sampleRate,
				timestamp: context.getOutputTimestamp(),
			})),
		};
	});
}

export function evaluateBodyAudioClock({
	capture,
	expectedMarkers,
	fps,
}: {
	capture: Awaited<ReturnType<typeof captureBodyAudioPlayback>>;
	expectedMarkers: number[];
	fps: number;
}) {
	const markers = capture.markers.map((marker, index) => {
		const preceding =
			marker.outputPerformanceMs === null
				? undefined
				: capture.frames
						.filter((frame) => frame.atMs <= marker.outputPerformanceMs!)
						.at(-1);
		return {
			...marker,
			expectedMediaSeconds: expectedMarkers[index] ?? null,
			visualFrame: preceding?.frame ?? null,
			driftMs:
				preceding && expectedMarkers[index] !== undefined
					? (preceding.frame / fps - expectedMarkers[index]) * 1000
					: null,
		};
	});
	const frameDrifts = capture.frames
		.filter((frame) => frame.isPlaying && frame.frame / fps >= 0.25)
		.flatMap((frame) =>
			frame.media
				.filter(
					(media) =>
						!media.paused &&
						!media.muted &&
						media.state === "running" &&
						media.outputPerformanceMs > 0
				)
				.map((media) => ({
					frame: frame.frame,
					mediaDriftMs: (media.currentTime - frame.frame / fps) * 1000,
					estimatedOutputDriftMs:
						(media.currentTime -
							Math.max(0, media.contextTime - media.outputTime) *
								media.playbackRate -
							frame.frame / fps) *
						1000,
				}))
		);
	const absolute = markers
		.flatMap((marker) =>
			marker.driftMs === null ? [] : [Math.abs(marker.driftMs)]
		)
		.sort((left, right) => left - right);
	return {
		markers,
		frameDrifts,
		expectedMarkerCount: expectedMarkers.length,
		actualMarkerCount: markers.length,
		markerP95Ms: absolute.length
			? absolute[
					Math.min(absolute.length - 1, Math.ceil(absolute.length * 0.95) - 1)
				]
			: null,
		markerMaxMs: absolute.length ? Math.max(...absolute) : null,
		outputClockAvailable:
			markers.length > 0 &&
			markers.every((marker) => marker.outputPerformanceMs !== null),
		observedPeak: capture.peak,
		errors: capture.errors,
		scope:
			"Post-mix PCM tap and browser output timestamp; physical speaker/OS loopback latency not measured",
	};
}

export function expectBodyAudioClock({
	result,
}: {
	result: ReturnType<typeof evaluateBodyAudioClock>;
}) {
	expect(result.errors).toEqual([]);
	expect(
		result.outputClockAvailable,
		"Device output timestamp evidence is required"
	).toBe(true);
	expect(
		result.observedPeak,
		"Actual post-mix PCM must contain the marker signal"
	).toBeGreaterThan(0.02);
	expect(result.actualMarkerCount).toBe(result.expectedMarkerCount);
	for (const marker of result.markers) {
		expect(marker.visualFrame).not.toBeNull();
		expect(marker.driftMs).not.toBeNull();
		expect(Number.isFinite(marker.driftMs)).toBe(true);
	}
	expect(result.frameDrifts.length).toBeGreaterThan(10);
	expect(result.markerP95Ms).not.toBeNull();
	expect(result.markerP95Ms!).toBeLessThanOrEqual(80);
	expect(result.markerMaxMs!).toBeLessThanOrEqual(150);
}
