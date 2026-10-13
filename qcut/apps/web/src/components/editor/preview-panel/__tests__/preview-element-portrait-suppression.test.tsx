import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MEDIA_COLOR_SETTINGS } from "@/lib/color/color-properties";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import type { ActiveElement } from "../types";
import { ColorPreviewCanvas } from "../color-preview-canvas";
import {
	PreviewElementRenderer,
	shouldSuppressDomPortraitPreview,
} from "../preview-element-renderer";

vi.mock("../color-preview-canvas", () => ({
	ColorPreviewCanvas: vi.fn(() => <canvas data-testid="graded-preview" />),
}));
vi.mock("@/components/ui/video-player", () => ({
	VideoPlayer: () => <video data-testid="source-video" />,
}));
vi.mock("../portrait-manual-body-overlay", () => ({
	PortraitManualBodyOverlay: () => null,
}));
vi.mock("../planar-tracking-selection-overlay", () => ({
	PlanarTrackingSelectionOverlay: () => null,
}));
vi.mock("@/hooks/preview/use-native-video-enhancement-preview", () => ({
	useNativeVideoEnhancementPreview: () => ({ status: "idle" }),
}));
vi.mock("@/hooks/preview/use-video-enhancement-proxy", () => ({
	useVideoEnhancementProxy: () => ({ status: "idle" }),
	useVideoEnhancementProxyWindow: () => ({ sourceStart: 0, sourceDuration: 4 }),
}));

const portrait: MediaPortraitAdjustments = {
	enabled: true,
	engine: "independent",
	values: { face_adjust_TotalFace: 25 },
};

function fixture({
	mediaType = "video",
	color = false,
	engine = "independent",
	imageWidth,
}: {
	mediaType?: "video" | "image";
	color?: boolean;
	engine?: "native" | "independent";
	imageWidth?: number;
} = {}): ComponentProps<typeof PreviewElementRenderer> {
	const elementData: ActiveElement = {
		element: {
			id: "clip",
			type: "media",
			name: "portrait",
			mediaId: "source",
			startTime: 0,
			duration: 4,
			trimStart: 0,
			trimEnd: 0,
			portraitAdjustments: { ...portrait, engine },
			width: imageWidth,
			color: color
				? {
						...structuredClone(DEFAULT_MEDIA_COLOR_SETTINGS),
						basic: { ...DEFAULT_MEDIA_COLOR_SETTINGS.basic, exposure: 20 },
					}
				: undefined,
		},
		track: { id: "track", name: "Video", type: "media", elements: [] },
		mediaItem: {
			id: "source",
			name: "portrait",
			type: mediaType,
			file: new File(["fixture"], "source.mp4"),
			url: "blob:source",
			width: 1080,
			height: 1920,
		},
	};
	return {
		elementData,
		index: 0,
		previewDimensions: { width: 1080, height: 1920 },
		canvasSize: { width: 1080, height: 1920 },
		currentTime: 1,
		videoSourcesById: new Map([
			["source", { type: "remote", src: "blob:source" }],
		]),
		currentMediaElement: elementData,
		dragState: {
			isDragging: false,
			elementId: null,
			trackId: null,
			startX: 0,
			startY: 0,
			initialElementX: 0,
			initialElementY: 0,
			currentX: 0,
			currentY: 0,
			elementWidth: 0,
			elementHeight: 0,
		},
		isPlaying: false,
		activeProject: null,
		tracks: [elementData.track],
		compositionPreviewEnabled: false,
		hideJianyingTextFallback: false,
		additionalColorLayers: [],
		onTextPointerDown: vi.fn(),
		onElementSelect: vi.fn(),
		onElementResize: vi.fn(),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("DOM portrait work under exact composition", () => {
	it.each([
		{ canvasCompositionEnabled: true, status: "idle", expected: true },
		{ canvasCompositionEnabled: true, status: "rendering", expected: true },
		{ canvasCompositionEnabled: true, status: "ready", expected: true },
		{ canvasCompositionEnabled: true, status: "error", expected: false },
		{ canvasCompositionEnabled: false, status: "idle", expected: false },
		{ canvasCompositionEnabled: false, status: "rendering", expected: false },
		{ canvasCompositionEnabled: false, status: "ready", expected: false },
		{ canvasCompositionEnabled: false, status: "error", expected: false },
	] as const)("suppresses=$expected for exact enabled=$canvasCompositionEnabled status=$status", ({
		canvasCompositionEnabled,
		status,
		expected,
	}) => {
		expect(
			shouldSuppressDomPortraitPreview({ canvasCompositionEnabled, status })
		).toBe(expected);
	});

	it.each([
		{ mediaType: "video", engine: "native" },
		{ mediaType: "video", engine: "independent" },
		{ mediaType: "image", engine: "native" },
		{ mediaType: "image", engine: "independent" },
		{ mediaType: "image", engine: "native", imageWidth: 400 },
		{ mediaType: "image", engine: "independent", imageWidth: 400 },
	] as const)("keeps ordinary color without $engine portrait for $mediaType width=$imageWidth", (options) => {
		const props = fixture({ ...options, color: true });
		render(<PreviewElementRenderer {...props} suppressDomPortraitPreview />);
		const rendered = vi.mocked(ColorPreviewCanvas).mock.calls.at(-1)?.[0];
		expect(rendered?.settings.basic.exposure).toBe(20);
		expect(rendered?.portraitAdjustments).toBeUndefined();
	});

	it("preserves adjustment-layer color work without a portrait request", () => {
		const props = fixture();
		const layer = {
			settings: structuredClone(DEFAULT_MEDIA_COLOR_SETTINGS),
			masks: [],
		};
		render(
			<PreviewElementRenderer
				{...props}
				additionalColorLayers={[layer]}
				suppressDomPortraitPreview
			/>
		);
		const rendered = vi.mocked(ColorPreviewCanvas).mock.calls.at(-1)?.[0];
		expect(rendered?.additionalLayers).toContainEqual(layer);
		expect(rendered?.portraitAdjustments).toBeUndefined();
	});

	it("retains legacy portrait behavior when no suppression flag is supplied", () => {
		render(<PreviewElementRenderer {...fixture()} />);
		expect(
			vi.mocked(ColorPreviewCanvas).mock.calls.at(-1)?.[0].portraitAdjustments
		).toMatchObject(portrait);
	});
	it("does not mount the portrait-only canvas while exact composition owns it", () => {
		render(
			<PreviewElementRenderer {...fixture()} suppressDomPortraitPreview />
		);
		expect(screen.getByTestId("source-video")).toBeInTheDocument();
		expect(ColorPreviewCanvas).not.toHaveBeenCalled();
	});

	it("keeps color grading mounted but excludes portrait model settings", () => {
		render(
			<PreviewElementRenderer
				{...fixture({ color: true })}
				suppressDomPortraitPreview
			/>
		);
		expect(screen.getByTestId("graded-preview")).toBeInTheDocument();
		const props = vi.mocked(ColorPreviewCanvas).mock.calls.at(-1)?.[0];
		expect(props?.settings.enabled).toBe(true);
		expect(props?.portraitAdjustments).toBeUndefined();
	});

	it("restores the portrait fallback when suppression is removed", () => {
		const props = fixture();
		const view = render(
			<PreviewElementRenderer {...props} suppressDomPortraitPreview />
		);
		view.rerender(
			<PreviewElementRenderer {...props} suppressDomPortraitPreview={false} />
		);
		expect(
			vi.mocked(ColorPreviewCanvas).mock.calls.at(-1)?.[0].portraitAdjustments
		).toMatchObject(portrait);
	});
});
