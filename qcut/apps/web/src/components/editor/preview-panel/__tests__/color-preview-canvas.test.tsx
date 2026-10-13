import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drawColorGradedSourceStack } from "@/lib/color/browser-color-rendering";
import { DEFAULT_MEDIA_COLOR_SETTINGS } from "@/lib/color/color-properties";
import type {
	MediaColorSettings,
	MediaPortraitAdjustments,
} from "@/types/timeline";
import { ColorPreviewCanvas } from "../color-preview-canvas";

vi.mock("@/lib/color/browser-color-rendering", () => ({
	drawColorGradedSourceStack: vi.fn(),
}));
vi.mock("@/stores/editor/color-picker-store", () => ({
	useColorPickerStore: (
		select: (state: { active: boolean; complete: () => void }) => unknown
	) => select({ active: false, complete: vi.fn() }),
}));
vi.mock("@/stores/editor/color-preview-store", () => ({
	useColorPreviewStore: (select: (state: { bypassed: boolean }) => unknown) =>
		select({ bypassed: false }),
}));
vi.mock("@/lib/color/color-degradation", () => ({
	subscribeColorDegradation: () => () => {},
}));

const resourceId = "7447126702137904420";
const masks: [] = [];
const settings = ({
	intensity,
}: {
	intensity: number;
}): MediaColorSettings => ({
	...structuredClone(DEFAULT_MEDIA_COLOR_SETTINGS),
	multiPass: {
		enabled: true,
		name: "电影柔光 · QCut CPU",
		intensity,
		presetId: "soft-glow-ui-snapshot",
		fidelity: "native-local",
		passes: [],
		nativeEffect: {
			provider: "qcut-cpu-soft-glow-ui-snapshot-v1",
			resourceId,
			version: "9673f80b8e2f5a07f02f9ce1130b784a",
		},
	},
});
function view({
	intensity,
	portraitAdjustments,
	portraitRenderSize,
	fitMode = "fill",
	sourceSelector = "img",
	frameSeed = 0,
}: {
	intensity: number;
	portraitAdjustments?: MediaPortraitAdjustments;
	portraitRenderSize?: { width: number; height: number };
	fitMode?: "cover" | "contain" | "fill";
	sourceSelector?: "img" | "video";
	frameSeed?: number;
}) {
	return (
		<div>
			{sourceSelector === "img" ? (
				<img src="test.png" alt="source" />
			) : (
				<video src="blob:source" />
			)}
			<ColorPreviewCanvas
				sourceSelector={sourceSelector}
				settings={settings({ intensity })}
				masks={masks}
				fitMode={fitMode}
				frameSeed={frameSeed}
				portraitAdjustments={portraitAdjustments}
				portraitRenderSize={portraitRenderSize}
			/>
		</div>
	);
}
let pending: Array<() => void>;
let active: number;
let peak: number;
let rejected: number;
let started: number[];
beforeEach(() => {
	vi.clearAllMocks();
	pending = [];
	active = 0;
	peak = 0;
	rejected = 0;
	started = [];
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		}
	);
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn(() => 1)
	);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	Object.defineProperty(HTMLElement.prototype, "clientWidth", {
		configurable: true,
		get: () => 480,
	});
	Object.defineProperty(HTMLElement.prototype, "clientHeight", {
		configurable: true,
		get: () => 270,
	});
	for (const name of ["complete", "naturalWidth", "naturalHeight"]) {
		Object.defineProperty(HTMLImageElement.prototype, name, {
			configurable: true,
			get: () => (name === "complete" ? true : 1),
		});
	}
	Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
		configurable: true,
		value: vi.fn(function (this: HTMLCanvasElement) {
			return {
				canvas: this,
				clearRect: vi.fn(),
				scale: vi.fn(),
				drawImage: vi.fn((source: CanvasImageSource) => {
					if (source instanceof HTMLCanvasElement)
						this.dataset.paintedIntensity = source.dataset.paintedIntensity;
				}),
			};
		}),
	});
	vi.mocked(drawColorGradedSourceStack).mockImplementation(
		({ context, layers }) => {
			const intensity = layers[0].settings.multiPass!.intensity;
			if (active >= 4) {
				rejected += 1;
				return Promise.reject(
					new Error("Independent cinematic soft glow provider is busy.")
				);
			}
			active += 1;
			peak = Math.max(peak, active);
			started.push(intensity);
			return new Promise<void>((resolve) => {
				pending.push(() => {
					active -= 1;
					context.canvas.dataset.paintedIntensity = String(intensity);
					resolve();
				});
			});
		}
	);
});

async function completePending({
	rounds = 5,
}: {
	rounds?: number;
} = {}): Promise<void> {
	await act(async () => {
		for (const complete of pending.splice(0)) complete();
	});
	if (rounds > 1) await completePending({ rounds: rounds - 1 });
}

describe("color preview async commits", () => {
	it.each([
		{ fitMode: "cover" as const, width: 1080, height: 1977, x: 0, y: -28.5 },
		{
			fitMode: "contain" as const,
			width: (360 * 1920) / 659,
			height: 1920,
			x: (1080 - (360 * 1920) / 659) / 2,
			y: 0,
		},
		{ fitMode: "fill" as const, width: 1080, height: 1920, x: 0, y: 0 },
	])("renders the full display-pixel video source before $fitMode clipping", async ({
		fitMode,
		...bounds
	}) => {
		Object.defineProperties(HTMLVideoElement.prototype, {
			readyState: { configurable: true, get: () => 2 },
			videoWidth: { configurable: true, get: () => 360 },
			videoHeight: { configurable: true, get: () => 659 },
		});
		const portraitAdjustments: MediaPortraitAdjustments = {
			enabled: true,
			engine: "independent",
			values: { face_adjust_Whiten: 45 },
		};
		const { container } = render(
			view({
				intensity: 10,
				fitMode,
				sourceSelector: "video",
				portraitAdjustments,
				portraitRenderSize: { width: 1080, height: 1920 },
			})
		);
		await completePending();
		const call = vi.mocked(drawColorGradedSourceStack).mock.calls.at(-1)![0];
		expect(call.source).toBe(container.querySelector("video"));
		expect(call.portraitAdjustments).toBe(portraitAdjustments);
		for (const key of ["x", "y", "width", "height"] as const)
			expect(call[key]).toBeCloseTo(bounds[key]);
		expect(screen.getByTestId("color-preview-canvas")).toHaveAttribute(
			"data-rendered-portrait-status",
			"applied"
		);
	});

	it("keeps UHD engine input at logical resolution while limiting display pixels", async () => {
		Object.defineProperties(HTMLImageElement.prototype, {
			naturalWidth: { configurable: true, get: () => 2160 },
			naturalHeight: { configurable: true, get: () => 3840 },
		});
		const { container } = render(
			view({
				intensity: 10,
				fitMode: "cover",
				portraitAdjustments: {
					enabled: true,
					engine: "independent",
					values: { face_adjust_Whiten: 45 },
				},
				portraitRenderSize: { width: 2160, height: 3840 },
			})
		);
		await completePending();
		const call = vi.mocked(drawColorGradedSourceStack).mock.calls.at(-1)![0];
		expect(call.source).toBe(container.querySelector("img"));
		expect(call).toMatchObject({ x: 0, y: 0, width: 2160, height: 3840 });
		expect(call.context.scale).toHaveBeenCalledWith(0.5, 0.5);
		expect(screen.getByTestId("color-preview-canvas")).toHaveAttribute(
			"width",
			"1080"
		);
	});

	it("commits only the current resolved portrait settings and frame metadata", async () => {
		const initial: MediaPortraitAdjustments = {
			enabled: true,
			engine: "independent",
			values: { face_adjust_Whiten: 20 },
		};
		const next = { ...initial, values: { face_adjust_Whiten: 80 } };
		const props = {
			intensity: 10,
			portraitAdjustments: initial,
			portraitRenderSize: { width: 1080, height: 1920 },
			frameSeed: 15,
		};
		const { rerender } = render(view(props));
		await act(async () => {});
		const first = vi.mocked(drawColorGradedSourceStack).mock.calls[0][0];
		await act(async () =>
			rerender(view({ ...props, portraitAdjustments: next, frameSeed: 30 }))
		);
		expect(first.signal?.aborted).toBe(true);
		await act(async () => pending.shift()!());
		const canvas = screen.getByTestId("color-preview-canvas");
		expect(canvas.dataset.renderedFrameSeed).toBeUndefined();
		await completePending();
		const latest = vi.mocked(drawColorGradedSourceStack).mock.calls.at(-1)![0];
		expect(latest.portraitAdjustments).toBe(next);
		expect(latest.frameSeed).toBe(30);
		expect(canvas.dataset.renderedFrameSeed).toBe("30");
		expect(canvas.dataset.renderedSourceTimestampSeconds).toBe("0");
		expect(JSON.parse(canvas.dataset.renderedPortraitGeometry!)).toMatchObject({
			logicalSize: { width: 1080, height: 1920 },
			processing: { width: 1080, height: 1920 },
		});
	});

	it("marks an original-frame fallback instead of reporting a portrait render", async () => {
		vi.mocked(drawColorGradedSourceStack).mockRejectedValueOnce(
			new Error("Independent worker failed")
		);
		render(
			view({
				intensity: 10,
				portraitAdjustments: {
					enabled: true,
					engine: "independent",
					values: { face_adjust_Whiten: 45 },
				},
			})
		);
		await completePending();
		const canvas = screen.getByTestId("color-preview-canvas");
		expect(canvas.dataset.renderedPortraitStatus).toBe("fallback");
		expect(canvas.dataset.renderedPortraitEngine).toBe("none");
		expect(
			vi.mocked(drawColorGradedSourceStack).mock.calls.at(-1)![0]
				.portraitAdjustments
		).toBeUndefined();
	});

	it("does not commit an old frame when seeking during asynchronous post-processing", async () => {
		Object.defineProperties(HTMLVideoElement.prototype, {
			readyState: { configurable: true, get: () => 2 },
			videoWidth: { configurable: true, get: () => 854 },
			videoHeight: { configurable: true, get: () => 480 },
		});
		const { container } = render(
			<div>
				<video src="blob:source" />
				<ColorPreviewCanvas
					sourceSelector="video"
					settings={settings({ intensity: 10 })}
					masks={masks}
					fitMode="contain"
					frameSeed={0}
					portraitAdjustments={{
						enabled: true,
						engine: "independent",
						values: { face_adjust_Whiten: 40 },
					}}
				/>
			</div>
		);
		await act(async () => {});
		const first = vi.mocked(drawColorGradedSourceStack).mock.calls.at(-1)![0];
		await act(async () => {
			const video = container.querySelector("video")!;
			video.currentTime = 1.5;
			video.dispatchEvent(new Event("seeked"));
		});
		expect(first.signal?.aborted).toBe(true);
		await act(async () => pending.shift()!());
		const canvas = screen.getByTestId("color-preview-canvas");
		expect(canvas.dataset.renderedFrameCount).toBeUndefined();
		expect(canvas.dataset.paintedIntensity).toBeUndefined();
		await completePending();
		expect(canvas.dataset.renderedFrameCount).toBe("1");
		expect(canvas.dataset.paintedIntensity).toBe("10");
		expect(
			vi.mocked(drawColorGradedSourceStack).mock.calls.at(-1)![0]
				.timestampSeconds
		).toBe(1.5);
	});

	it("binds video recovery to the current source and aborts it on unmount", async () => {
		Object.defineProperties(HTMLVideoElement.prototype, {
			readyState: { configurable: true, get: () => 2 },
			videoWidth: { configurable: true, get: () => 854 },
			videoHeight: { configurable: true, get: () => 480 },
		});
		const { container, unmount } = render(
			<div>
				<video src="blob:source-A" />
				<ColorPreviewCanvas
					sourceSelector="video"
					settings={settings({ intensity: 10 })}
					masks={masks}
					fitMode="contain"
					frameSeed={65}
					portraitAdjustments={{
						enabled: true,
						values: { face_adjust_EnlargeEye: 60 },
					}}
				/>
			</div>
		);
		await completePending();
		const first = vi.mocked(drawColorGradedSourceStack).mock.calls.at(-1)![0];
		expect(first.readPortraitSourcePreRoll).toBeTypeOf("function");
		expect(first.sourceKey).toContain("source-A");
		await act(async () => {
			const video = container.querySelector("video")!;
			video.src = "blob:source-B";
			video.currentTime = 2.2;
			video.dispatchEvent(new Event("seeked"));
		});
		await completePending();
		const next = vi.mocked(drawColorGradedSourceStack).mock.calls.at(-1)![0];
		expect(next.sourceKey).toContain("source-B");
		expect(next.timestampSeconds).toBe(2.2);
		expect(next.signal?.aborted).toBe(false);
		unmount();
		expect(next.signal?.aborted).toBe(true);
	});
	it("preserves blemish source detail before fitting without enlarging the displayed canvas", async () => {
		Object.defineProperties(HTMLImageElement.prototype, {
			naturalWidth: { configurable: true, get: () => 4000 },
			naturalHeight: { configurable: true, get: () => 6000 },
		});
		const { container } = render(
			view({
				intensity: 10,
				portraitAdjustments: {
					enabled: true,
					values: { face_adjust_SpotAcne: 50 },
				},
				portraitRenderSize: { width: 1080, height: 1620 },
			})
		);
		await completePending();
		const call = vi.mocked(drawColorGradedSourceStack).mock.calls.at(-1)![0];
		expect(call.source).toBe(container.querySelector("img"));
		expect(call).toMatchObject({ width: 1080, height: 1620 });
		const canvas = screen.getByTestId("color-preview-canvas");
		expect(JSON.parse(canvas.dataset.renderedPortraitGeometry!)).toMatchObject({
			processing: { width: 2160, height: 3240 },
		});
		expect(canvas).toHaveAttribute("width", "1080");
		expect(canvas).toHaveAttribute("height", "1620");
	});
	it("uses logical dimensions only for enabled portrait processing", async () => {
		const props = {
			intensity: 10,
			portraitAdjustments: {
				enabled: true,
				values: { face_adjust_inner_corner: 99 },
			},
			portraitRenderSize: { width: 1080, height: 1620 },
		};
		const { rerender } = render(view(props));
		await completePending();
		const canvas = screen.getByTestId("color-preview-canvas");
		expect(canvas).toHaveAttribute("width", "1080");
		expect(canvas).toHaveAttribute("height", "1620");
		expect(HTMLCanvasElement.prototype.getContext).toHaveBeenNthCalledWith(
			1,
			"2d",
			{ willReadFrequently: true }
		);
		await act(async () =>
			rerender(
				view({
					...props,
					portraitAdjustments: { ...props.portraitAdjustments, enabled: false },
				})
			)
		);
		await completePending();
		expect(canvas).toHaveAttribute("width", "480");
		expect(canvas).toHaveAttribute("height", "270");
	});
	it("falls back to display dimensions when logical dimensions are unavailable", async () => {
		render(
			view({
				intensity: 10,
				portraitAdjustments: {
					enabled: true,
					values: { face_adjust_inner_corner: 99 },
				},
			})
		);
		await completePending();
		expect(screen.getByTestId("color-preview-canvas")).toHaveAttribute(
			"width",
			"480"
		);
	});
	it("serializes across effects and paints the latest intensity after a rapid paused update", async () => {
		const { rerender } = render(view({ intensity: 0 }));
		await completePending();
		const canvas = screen.getByTestId("color-preview-canvas");
		expect(canvas.dataset.renderedColorResources).toBe(`${resourceId}:0`);
		await act(async () => rerender(view({ intensity: 10 })));
		await act(async () => rerender(view({ intensity: 20 })));
		await act(async () => rerender(view({ intensity: 30 })));
		await act(async () => rerender(view({ intensity: 37 })));
		await act(async () => rerender(view({ intensity: 37 })));
		await completePending();
		expect(canvas.dataset.renderedColorResources).toBe(`${resourceId}:37`);
		expect(canvas.dataset.paintedIntensity).toBe("37");
		expect(peak).toBe(1);
		expect(rejected).toBe(0);
		expect(started).toEqual([0, 10, 37]);
	});
	it("does not submit queued work or paint after unmount", async () => {
		const { rerender, unmount } = render(view({ intensity: 10 }));
		await act(async () => {});
		await act(async () => rerender(view({ intensity: 37 })));
		const canvas = screen.getByTestId("color-preview-canvas");
		unmount();
		await completePending();
		expect(started).toEqual([10]);
		expect(canvas.dataset.renderedColorResources).toBeUndefined();
	});
});
