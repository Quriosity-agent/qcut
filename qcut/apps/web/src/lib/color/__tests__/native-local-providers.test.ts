import {
	INDEPENDENT_FILTER_PROVIDERS,
	NATIVE_LOCAL_EFFECT_PROVIDERS,
	isIndependentFilterProvider,
	isNativeLocalEffectProvider,
} from "@qcut/editor-core";
import type { NativeLocalEffectProvider } from "@qcut/editor-core";
import { describe, expect, it } from "vitest";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import { DEFAULT_MEDIA_COLOR_SETTINGS } from "@/lib/color/color-properties";
import { independentFogSettings } from "../../../../../../electron/qcut-independent-filter/contract";
import { requiresJianyingLocalColorExport } from "@/lib/export/jianying-local-color-export";
import { canRenderJianyingLocalEffect } from "../jianying-local-effect-preview";

function colorFor(provider: NativeLocalEffectProvider) {
	const color = structuredClone(DEFAULT_MEDIA_COLOR_SETTINGS);
	color.enabled = true;
	// Start from a real settings object so the shape stays valid as
	// ColorMultiPassSettings grows; only the provider varies here.
	color.multiPass = independentFogSettings();
	color.multiPass.intensity = 100;
	if (color.multiPass.nativeEffect)
		color.multiPass.nativeEffect.provider = provider;
	return color;
}

function tracks({ element }: { element: MediaElement }): TimelineTrack[] {
	return [
		{
			id: "track-1",
			name: "Media",
			type: "media",
			locked: false,
			muted: false,
			elements: [element],
		},
	];
}

function mediaElement(): MediaElement {
	return {
		id: "media-1",
		type: "media",
		mediaId: "asset-1",
		name: "Clip",
		startTime: 0,
		duration: 1,
		trimStart: 0,
		trimEnd: 0,
	} as MediaElement;
}

describe("native-local effect providers", () => {
	it("keeps the two lists in the documented relationship", () => {
		expect(NATIVE_LOCAL_EFFECT_PROVIDERS).toEqual([
			"jianying-local-effect-v1",
			...INDEPENDENT_FILTER_PROVIDERS,
		]);
		expect(isIndependentFilterProvider("jianying-local-effect-v1")).toBe(false);
		expect(isNativeLocalEffectProvider("jianying-local-effect-v1")).toBe(true);
		expect(isIndependentFilterProvider(undefined)).toBe(false);
		expect(isNativeLocalEffectProvider("not-a-provider")).toBe(false);
	});

	// A provider that reaches only some consumers degrades silently: the
	// preview drops back to CSS, or the export runs FFmpeg with the effect
	// removed and no error anywhere. Adding one to the shared list has to
	// light up every consumer at once, so each is asserted over the whole
	// list rather than over a hand-written copy of it.
	it.each(
		NATIVE_LOCAL_EFFECT_PROVIDERS
	)("routes %s through both the preview and the export", (provider) => {
		const color = colorFor(provider);
		expect(canRenderJianyingLocalEffect({ settings: color })).toBe(true);
		const element = mediaElement();
		element.color = color;
		expect(
			requiresJianyingLocalColorExport({ tracks: tracks({ element }) })
		).toBe(true);
	});
});
