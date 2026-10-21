import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import {
	createCanvasCompositionRenderer,
	type CanvasCompositionFrame,
	type CanvasCompositionPreviewPlan,
} from "@/lib/preview/canvas-composition-frame";
import {
	createCanvasPlaybackCache,
	type CanvasPlaybackCache,
} from "@/lib/preview/canvas-composition-playback-cache";

type StoreState = Record<string, unknown>;
type StoreListener = (state: StoreState, previous: StoreState) => void;

const stores = vi.hoisted(() => {
	const listeners = Array.from({ length: 5 }, () => new Set<StoreListener>());
	const state = { isPlaying: false, currentTime: 0, pause: vi.fn() };
	return {
		listeners,
		state,
		subscribe: listeners.map((set) => (listener: StoreListener) => {
			set.add(listener);
			return () => set.delete(listener);
		}),
	};
});
vi.mock("@/lib/preview/canvas-composition-frame", () => ({
	createCanvasCompositionRenderer: vi.fn(),
}));
vi.mock("@/lib/preview/canvas-composition-playback-cache", () => ({
	createCanvasPlaybackCache: vi.fn(),
}));
vi.mock("@/stores/editor/playback-store", () => ({
	usePlaybackStore: { getState: () => stores.state },
}));
vi.mock("@/stores/ai/effects-store", () => ({
	useEffectsStore: { subscribe: stores.subscribe[0] },
}));
vi.mock("@/stores/stickers-overlay-store", () => ({
	useStickersOverlayStore: { subscribe: stores.subscribe[1] },
}));
vi.mock("@/stores/screen-recording-store", () => ({
	useScreenRecordingEnhancementStore: { subscribe: stores.subscribe[2] },
}));
vi.mock("@/stores/webcam-overlay-store", () => ({
	useWebcamOverlayStore: { subscribe: stores.subscribe[3] },
}));
vi.mock("@/stores/figure-annotations-store", () => ({
	useFigureAnnotationsStore: { subscribe: stores.subscribe[4] },
}));

export const createCache = vi.mocked(createCanvasPlaybackCache);
export const createRenderer = vi.mocked(createCanvasCompositionRenderer);
export const plan: CanvasCompositionPreviewPlan = {
	tracks: [],
	mediaItems: [],
	width: 1080,
	height: 1920,
	fps: 30,
	renderIndex: {
		timelineStickerIds: new Set(),
		mediaItemsById: new Map(),
		clipTransitions: {
			canvasTracks: null,
			canvasTransitions: [],
			jianyingTransitions: [],
			unsupported: [],
		},
	},
};
export const options = {
	enabled: true,
	plan,
	projectId: "project-a",
	totalDuration: 2 / 30,
	backgroundColor: "#123456",
};

export function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

export function capture({ frame }: { frame: number }): CanvasCompositionFrame {
	return {
		blob: new Blob([`frame-${frame}`], { type: "image/png" }),
		frame,
		timeSeconds: frame / 30,
		timings: { renderMs: 10, encodeMs: 5 },
		width: 1080,
		height: 1920,
	};
}

export function resources() {
	const frames = new Map<number, Blob>();
	const writeFrame: CanvasPlaybackCache["write"] = async ({
		frame,
		blob,
		signal,
	}) => {
		signal.throwIfAborted();
		frames.set(frame, blob);
	};
	const cache: CanvasPlaybackCache = {
		id: crypto.randomUUID(),
		maxBytes: 2 * 1024 ** 3,
		get bytes() {
			return [...frames.values()].reduce((total, blob) => total + blob.size, 0);
		},
		get frameCount() {
			return frames.size;
		},
		has: vi.fn(({ frame }) => frames.has(frame)),
		write: vi.fn(writeFrame),
		read: vi.fn(async ({ frame, signal }) => {
			signal.throwIfAborted();
			const blob = frames.get(frame);
			if (!blob) throw new Error(`Frame ${frame} is unavailable`);
			return blob;
		}),
		remove: vi.fn(async ({ frames: removed, signal }) => {
			signal.throwIfAborted();
			for (const frame of removed) frames.delete(frame);
		}),
		dispose: vi.fn(async () => frames.clear()),
	};
	const renderer = {
		render: vi.fn(async ({ frame }: { frame: number }) => capture({ frame })),
		dispose: vi.fn(async () => {}),
	};
	return { cache, renderer, writeFrame };
}

export function setupPlaybackPreviewTests() {
	beforeEach(() => {
		vi.resetAllMocks();
		stores.state.isPlaying = false;
		stores.state.currentTime = 0;
		stores.state.pause.mockImplementation(() => {
			stores.state.isPlaying = false;
		});
		const { cache, renderer } = resources();
		createCache.mockResolvedValue(cache);
		createRenderer.mockReturnValue(renderer);
	});
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		for (const listeners of stores.listeners) listeners.clear();
	});
	return stores;
}
