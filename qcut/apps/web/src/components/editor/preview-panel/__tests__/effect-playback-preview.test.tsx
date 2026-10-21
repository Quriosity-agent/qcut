import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasPlaybackSession } from "@/hooks/preview/use-canvas-playback-preview";
import { createCanvasPlaybackReader } from "@/lib/preview/canvas-composition-playback-reader";
import { buildExportRenderIndex } from "@/lib/export/export-render-index";
import { EffectPlaybackCanvas } from "../effect-playback-preview";

interface PlaybackSnapshot {
	isPlaying: boolean;
	currentTime: number;
	previewScrubTime?: number | null;
}

interface MockReader {
	bitmaps: Map<number, ImageBitmap>;
	listeners: Set<() => void>;
	error?: Error;
	setTarget: ReturnType<typeof vi.fn>;
	dispose: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
	state: { isPlaying: false, currentTime: 0 } as PlaybackSnapshot,
	subscribers: new Set<
		(state: PlaybackSnapshot, previous: PlaybackSnapshot) => void
	>(),
	readers: [] as MockReader[],
	play: vi.fn(),
	pause: vi.fn(),
	seek: vi.fn(),
}));

vi.mock("@/stores/editor/playback-store", () => ({
	usePlaybackStore: {
		getState: () => ({
			...mocks.state,
			play: mocks.play,
			pause: mocks.pause,
			seek: mocks.seek,
		}),
		subscribe: (
			listener: (state: PlaybackSnapshot, previous: PlaybackSnapshot) => void
		) => {
			mocks.subscribers.add(listener);
			return () => mocks.subscribers.delete(listener);
		},
	},
}));

vi.mock("@/lib/preview/canvas-composition-playback-reader", () => ({
	PLAYBACK_BITMAP_MAX_FRAMES: 6,
	createCanvasPlaybackReader: vi.fn(() => {
		const reader: MockReader = {
			bitmaps: new Map(),
			listeners: new Set(),
			setTarget: vi.fn(),
			dispose: vi.fn(),
		};
		mocks.readers.push(reader);
		return {
			setTarget: reader.setTarget,
			get: ({ frame }: { frame: number }) => reader.bitmaps.get(frame),
			subscribe: ({ onChange }: { onChange: () => void }) => {
				reader.listeners.add(onChange);
				return () => reader.listeners.delete(onChange);
			},
			get stats() {
				return {
					frames: reader.bitmaps.size,
					bytes: reader.bitmaps.size * 16,
					maxFrames: 6,
					maxBytes: 64 * 1024 * 1024,
				};
			},
			get error() {
				return reader.error;
			},
			dispose: reader.dispose,
		};
	}),
}));

function updatePlayback({ changes }: { changes: Partial<PlaybackSnapshot> }) {
	const previous = mocks.state;
	mocks.state = { ...previous, ...changes };
	for (const listener of mocks.subscribers) listener(mocks.state, previous);
}

function session({ generation = "first" }: { generation?: string } = {}) {
	const plan = {
		tracks: [],
		mediaItems: [],
		width: 2,
		height: 2,
		fps: 30,
		renderIndex: buildExportRenderIndex({
			tracks: [],
			mediaItems: [],
			canvasWidth: 2,
			canvasHeight: 2,
			fps: 30,
		}),
	};
	return {
		plan,
		generation,
		frames: 180,
		cache: {
			id: generation,
			maxBytes: 2 * 1024 ** 3,
			has: vi.fn(() => true),
			remove: vi.fn(async () => {}),
			bytes: 0,
			frameCount: 180,
			read: vi.fn(async () => new Blob()),
			write: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
		},
	} satisfies CanvasPlaybackSession;
}

function streamingSession({ windowEnd = 120 } = {}) {
	let error: Error | undefined;
	let aborted = false;
	const value = session();
	const stream = {
		get aborted() {
			return aborted;
		},
		setTarget: vi.fn(),
		waitForTarget: vi.fn(async () => {}),
		read: value.cache.read,
		setSuspended: vi.fn(),
		dispose: vi.fn(async () => {}),
		stats: {
			segmentFrames: Math.max(1, windowEnd / 2),
			targetFrame: 0,
			windowStart: 0,
			windowEnd,
			cacheBytes: 0,
			cacheBudgetBytes: value.cache.maxBytes,
			residentFrames: 0,
			preparedTotal: 0,
			evictedTotal: 0,
			targetReady: true,
		},
		metrics: {
			renderMs: 0,
			encodeMs: 0,
			writeMs: 0,
			wallMs: 0,
			maxInFlightFrames: 0,
			maxReservedPixelBytes: 0,
			maxPendingPngBytes: 0,
		},
		get error() {
			return error;
		},
	} satisfies NonNullable<CanvasPlaybackSession["stream"]>;
	return {
		session: { ...value, stream },
		abort() {
			aborted = true;
		},
		fail({ message }: { message: string }) {
			error = new Error(message);
		},
	};
}

function fill({ reader, frames }: { reader: MockReader; frames: number[] }) {
	for (const frame of frames)
		reader.bitmaps.set(frame, {
			width: 2,
			height: 2,
			close: vi.fn(),
		} as ImageBitmap);
	for (const listener of reader.listeners) listener();
}

describe("effect playback surface lifecycle", () => {
	const originalContext = Object.getOwnPropertyDescriptor(
		HTMLCanvasElement.prototype,
		"getContext"
	);
	const drawImage = vi.fn();
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.state = { isPlaying: false, currentTime: 0 };
		mocks.subscribers.clear();
		mocks.readers = [];
		mocks.play.mockImplementation(() => {
			updatePlayback({ changes: { isPlaying: true } });
			window.dispatchEvent(new CustomEvent("playback-play"));
		});
		mocks.pause.mockImplementation(() => {
			updatePlayback({ changes: { isPlaying: false } });
			window.dispatchEvent(new CustomEvent("playback-pause"));
		});
		mocks.seek.mockImplementation((time: number) => {
			updatePlayback({ changes: { currentTime: time } });
			window.dispatchEvent(
				new CustomEvent("playback-seek", { detail: { time } })
			);
		});
		Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
			configurable: true,
			value: vi.fn(() => ({ drawImage })),
		});
	});
	afterEach(() => {
		cleanup();
		if (originalContext)
			Object.defineProperty(
				HTMLCanvasElement.prototype,
				"getContext",
				originalContext
			);
	});

	it("pauses a cache miss, shows the exact target, and resumes only after lookahead is ready", () => {
		render(<EffectPlaybackCanvas session={session()} />);
		const reader = mocks.readers[0];
		act(() => mocks.play());
		expect(mocks.state.isPlaying).toBe(false);
		act(() => fill({ reader, frames: [0] }));
		expect(screen.getByTestId("effect-playback-canvas").dataset.frame).toBe(
			"0"
		);
		expect(mocks.state.isPlaying).toBe(false);
		act(() => fill({ reader, frames: [1, 2] }));
		expect(mocks.state.isPlaying).toBe(false);
		act(() => fill({ reader, frames: [3] }));
		expect(mocks.state.isPlaying).toBe(true);
		expect(mocks.seek).toHaveBeenLastCalledWith(0);
		expect(screen.queryByTestId("effect-playback-buffering")).toBeNull();
		expect(drawImage).toHaveBeenCalledTimes(1);
	});

	it("does not auto-resume after the user seeks while a play request buffers", () => {
		render(<EffectPlaybackCanvas session={session()} />);
		const reader = mocks.readers[0];
		act(() => mocks.play());
		act(() => mocks.seek(1));
		act(() => fill({ reader, frames: [0, 1, 2, 3] }));
		expect(drawImage).not.toHaveBeenCalled();
		act(() => fill({ reader, frames: [30, 31, 32, 33] }));
		expect(screen.getByTestId("effect-playback-canvas").dataset.frame).toBe(
			"30"
		);
		expect(mocks.state.isPlaying).toBe(false);
		expect(mocks.play).toHaveBeenCalledTimes(1);
	});

	it("waits for intermediate frames when parallel decodes finish out of order", () => {
		render(<EffectPlaybackCanvas session={session()} />);
		const reader = mocks.readers[0];
		act(() => mocks.play());
		act(() => fill({ reader, frames: [0, 3] }));
		expect(mocks.state.isPlaying).toBe(false);
		act(() => fill({ reader, frames: [2] }));
		expect(mocks.state.isPlaying).toBe(false);
		act(() => fill({ reader, frames: [1] }));
		expect(mocks.state.isPlaying).toBe(true);
	});

	it("does not auto-resume when the user explicitly pauses an already buffering player", () => {
		render(<EffectPlaybackCanvas session={session()} />);
		const reader = mocks.readers[0];
		act(() => mocks.play());
		act(() => mocks.pause());
		act(() => fill({ reader, frames: [0, 1, 2, 3] }));
		expect(mocks.state.isPlaying).toBe(false);
		expect(mocks.play).toHaveBeenCalledTimes(1);
	});

	it("preserves the resume intent when unrelated playback settings update during buffering", () => {
		render(<EffectPlaybackCanvas session={session()} />);
		const reader = mocks.readers[0];
		act(() => mocks.play());
		act(() => updatePlayback({ changes: {} }));
		act(() => fill({ reader, frames: [0, 1, 2, 3] }));
		expect(mocks.state.isPlaying).toBe(true);
		expect(mocks.play).toHaveBeenCalledTimes(2);
	});

	it("uses live playback time events even when the store time has not advanced", () => {
		render(<EffectPlaybackCanvas session={session()} />);
		const reader = mocks.readers[0];
		act(() => fill({ reader, frames: [0, 1, 2, 3] }));
		act(() => mocks.play());
		act(() => {
			window.dispatchEvent(
				new CustomEvent("playback-update", { detail: { time: 2 / 30 } })
			);
		});
		expect(mocks.state.currentTime).toBe(0);
		expect(screen.getByTestId("effect-playback-canvas").dataset.frame).toBe(
			"2"
		);
		expect(reader.setTarget).toHaveBeenLastCalledWith({ frame: 2 });
	});

	it("discards an old generation's queued publication after replacement or unmount", () => {
		const view = render(<EffectPlaybackCanvas session={session()} />);
		const oldReader = mocks.readers[0];
		const oldPublish = [...oldReader.listeners][0];
		view.rerender(
			<EffectPlaybackCanvas session={session({ generation: "second" })} />
		);
		expect(oldReader.dispose).toHaveBeenCalledOnce();
		const newReader = mocks.readers[1];
		act(() => fill({ reader: oldReader, frames: [0, 1, 2, 3] }));
		act(oldPublish);
		expect(drawImage).not.toHaveBeenCalled();
		act(() => fill({ reader: newReader, frames: [0] }));
		expect(drawImage).toHaveBeenCalledOnce();
		const newPublish = [...newReader.listeners][0];
		view.unmount();
		act(newPublish);
		expect(drawImage).toHaveBeenCalledOnce();
		expect(newReader.dispose).toHaveBeenCalledOnce();
		expect(mocks.subscribers.size).toBe(0);
	});

	it("stops playback and reports a disk/decode error without automatically restarting", () => {
		render(<EffectPlaybackCanvas session={session()} />);
		const reader = mocks.readers[0];
		act(() => mocks.play());
		act(() => {
			reader.error = new Error("Frame is incomplete");
			fill({ reader, frames: [] });
		});
		expect(mocks.state.isPlaying).toBe(false);
		expect(
			screen.getByTestId("effect-playback-buffering").textContent
		).toContain("Frame is incomplete");
		act(() => fill({ reader, frames: [0, 1, 2, 3] }));
		expect(mocks.play).toHaveBeenCalledTimes(1);
		expect(drawImage).not.toHaveBeenCalled();
	});

	it("retargets the rolling stream before the bitmap reader on a distant seek", () => {
		const source = streamingSession();
		render(<EffectPlaybackCanvas session={source.session} />);
		const reader = mocks.readers[0];
		expect(createCanvasPlaybackReader).toHaveBeenCalledWith(
			expect.objectContaining({ cache: source.session.stream })
		);
		source.session.stream.setTarget.mockClear();
		reader.setTarget.mockClear();
		act(() => {
			window.dispatchEvent(
				new CustomEvent("playback-seek", { detail: { time: 4 } })
			);
		});
		expect(source.session.stream.setTarget).toHaveBeenCalledOnce();
		expect(source.session.stream.setTarget).toHaveBeenCalledWith({
			frame: 120,
		});
		expect(reader.setTarget).toHaveBeenCalledWith({ frame: 120 });
		expect(
			source.session.stream.setTarget.mock.invocationCallOrder[0]
		).toBeLessThan(reader.setTarget.mock.invocationCallOrder[0]);
	});

	it("keeps a pending scrub when the prepared canvas mounts, then follows the playback clock", () => {
		mocks.state = {
			isPlaying: false,
			currentTime: 0,
			previewScrubTime: 2,
		};
		const source = streamingSession();
		render(<EffectPlaybackCanvas session={source.session} />);
		const reader = mocks.readers[0];
		expect(source.session.stream.setTarget).toHaveBeenLastCalledWith({
			frame: 60,
		});
		expect(reader.setTarget).toHaveBeenLastCalledWith({ frame: 60 });
		act(() => fill({ reader, frames: [0, 60] }));
		expect(screen.getByTestId("effect-playback-canvas").dataset.frame).toBe(
			"60"
		);
		act(() => {
			updatePlayback({ changes: { previewScrubTime: null } });
			window.dispatchEvent(new CustomEvent("playback-play"));
		});
		expect(source.session.stream.setTarget).toHaveBeenLastCalledWith({
			frame: 0,
		});
		expect(screen.getByTestId("effect-playback-canvas").dataset.frame).toBe(
			"0"
		);
	});

	it("resumes within a tiny prepared window without waiting for unreachable lookahead frames", () => {
		const source = streamingSession({ windowEnd: 2 });
		render(<EffectPlaybackCanvas session={source.session} />);
		const reader = mocks.readers[0];
		expect(createCanvasPlaybackReader).toHaveBeenCalledWith(
			expect.objectContaining({ maxFrames: 2 })
		);
		act(() => mocks.play());
		act(() => fill({ reader, frames: [0] }));
		expect(mocks.state.isPlaying).toBe(false);
		act(() => fill({ reader, frames: [1] }));
		expect(mocks.state.isPlaying).toBe(true);
		expect(screen.queryByTestId("effect-playback-buffering")).toBeNull();
		expect(reader.bitmaps.has(2)).toBe(false);
	});

	it("pauses once on a stream failure without recursively retargeting or drawing stale frames", () => {
		const source = streamingSession();
		render(<EffectPlaybackCanvas session={source.session} />);
		const reader = mocks.readers[0];
		act(() => fill({ reader, frames: [0, 1, 2, 3] }));
		drawImage.mockClear();
		reader.setTarget.mockClear();
		source.session.stream.setTarget.mockClear();
		source.fail({ message: "Rolling cache is unavailable" });
		act(() => updatePlayback({ changes: { isPlaying: true } }));
		expect(mocks.pause).toHaveBeenCalledOnce();
		expect(mocks.state.isPlaying).toBe(false);
		expect(reader.setTarget).not.toHaveBeenCalled();
		expect(source.session.stream.setTarget).not.toHaveBeenCalled();
		expect(drawImage).not.toHaveBeenCalled();
		expect(
			screen.getByTestId("effect-playback-buffering").textContent
		).toContain("Rolling cache is unavailable");
	});

	it("pauses a reader failure during active playback without reentering target selection", () => {
		const source = streamingSession();
		render(<EffectPlaybackCanvas session={source.session} />);
		const reader = mocks.readers[0];
		act(() => fill({ reader, frames: [0, 1, 2, 3] }));
		act(() => updatePlayback({ changes: { isPlaying: true } }));
		expect(mocks.state.isPlaying).toBe(true);
		reader.setTarget.mockClear();
		source.session.stream.setTarget.mockClear();
		act(() => {
			reader.error = new Error("Decoded frame is corrupt");
			fill({ reader, frames: [] });
		});
		expect(mocks.pause).toHaveBeenCalledOnce();
		expect(mocks.state.isPlaying).toBe(false);
		expect(reader.setTarget).not.toHaveBeenCalled();
		expect(source.session.stream.setTarget).not.toHaveBeenCalled();
		expect(
			screen.getByTestId("effect-playback-buffering").textContent
		).toContain("Decoded frame is corrupt");
	});

	it("ignores a synchronously aborted stream before React removes the old canvas", () => {
		const source = streamingSession();
		render(<EffectPlaybackCanvas session={source.session} />);
		const reader = mocks.readers[0];
		source.session.stream.setTarget.mockClear();
		reader.setTarget.mockClear();
		source.abort();
		source.session.stream.setTarget.mockImplementation(() => {
			throw new DOMException("Old generation aborted", "AbortError");
		});
		act(() => mocks.seek(4));
		act(() => fill({ reader, frames: [0, 1, 2, 3, 120] }));
		expect(source.session.stream.setTarget).not.toHaveBeenCalled();
		expect(reader.setTarget).not.toHaveBeenCalled();
		expect(drawImage).not.toHaveBeenCalled();
		expect(mocks.pause).not.toHaveBeenCalled();
	});
});
