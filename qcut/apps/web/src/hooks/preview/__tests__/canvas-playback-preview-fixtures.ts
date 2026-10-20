import { vi } from "vitest";
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
	const state = { isPlaying: false, pause: vi.fn() };
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
	const cache: CanvasPlaybackCache = {
		id: crypto.randomUUID(),
		bytes: 0,
		frameCount: 0,
		write: vi.fn(async ({ signal }) => signal.throwIfAborted()),
		read: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
		dispose: vi.fn(async () => {}),
	};
	const renderer = {
		render: vi.fn(async ({ frame }: { frame: number }) => capture({ frame })),
		dispose: vi.fn(async () => {}),
	};
	return { cache, renderer };
}

export function playbackStores() {
	return stores;
}
