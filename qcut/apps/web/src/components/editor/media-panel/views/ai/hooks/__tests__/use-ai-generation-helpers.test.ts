import { describe, it, expect } from "vitest";
import {
	getSafeDuration,
	validateGenerationInputs,
	validateTextTab,
	validateImageTab,
	validateAvatarTab,
	buildUnifiedParams,
	getModelCapabilities,
	classifyResponse,
	type ValidationContext,
} from "../use-ai-generation-helpers";
import type { T2VModelCapabilities } from "../../constants/text2video-models-config";

// ---------------------------------------------------------------------------
// getSafeDuration
// ---------------------------------------------------------------------------
describe("getSafeDuration", () => {
	it("returns undefined when capabilities is undefined", () => {
		expect(getSafeDuration(5, undefined)).toBeUndefined();
	});

	it("returns undefined when model does not support duration", () => {
		const caps: T2VModelCapabilities = {
			supportsDuration: false,
			supportsAspectRatio: false,
			supportsResolution: false,
			supportsNegativePrompt: false,
			supportsPromptExpansion: false,
			supportsSeed: false,
			supportsSafetyChecker: false,
		};
		expect(getSafeDuration(5, caps)).toBeUndefined();
	});

	it("returns requested duration when it is in the allowed list", () => {
		const caps: T2VModelCapabilities = {
			supportsDuration: true,
			supportedDurations: [5, 10, 15],
			supportsAspectRatio: false,
			supportsResolution: false,
			supportsNegativePrompt: false,
			supportsPromptExpansion: false,
			supportsSeed: false,
			supportsSafetyChecker: false,
		};
		expect(getSafeDuration(10, caps)).toBe(10);
	});

	it("falls back to defaultDuration when requested is not allowed", () => {
		const caps: T2VModelCapabilities = {
			supportsDuration: true,
			supportedDurations: [5, 10],
			defaultDuration: 5,
			supportsAspectRatio: false,
			supportsResolution: false,
			supportsNegativePrompt: false,
			supportsPromptExpansion: false,
			supportsSeed: false,
			supportsSafetyChecker: false,
		};
		expect(getSafeDuration(7, caps)).toBe(5);
	});

	it("falls back to first allowed duration when no default", () => {
		const caps: T2VModelCapabilities = {
			supportsDuration: true,
			supportedDurations: [3, 6, 9],
			supportsAspectRatio: false,
			supportsResolution: false,
			supportsNegativePrompt: false,
			supportsPromptExpansion: false,
			supportsSeed: false,
			supportsSafetyChecker: false,
		};
		expect(getSafeDuration(12, caps)).toBe(3);
	});

	it("passes through requested duration when allowedDurations is empty", () => {
		const caps: T2VModelCapabilities = {
			supportsDuration: true,
			supportedDurations: [],
			supportsAspectRatio: false,
			supportsResolution: false,
			supportsNegativePrompt: false,
			supportsPromptExpansion: false,
			supportsSeed: false,
			supportsSafetyChecker: false,
		};
		expect(getSafeDuration(8, caps)).toBe(8);
	});
});

// ---------------------------------------------------------------------------
// validateGenerationInputs
// ---------------------------------------------------------------------------
describe("validateGenerationInputs", () => {
	const baseCtx: ValidationContext = {
		prompt: "test prompt",
		selectedModels: ["model_a"],
		selectedImage: null,
		firstFrame: null,
		lastFrame: null,
		sourceVideo: null,
		audioFile: null,
		avatarImage: null,
		referenceImages: [],
	};

	describe("text tab", () => {
		it("returns error for empty prompt", () => {
			const err = validateTextTab("", ["model_a"]);
			expect(err).toBe("Missing prompt for text tab");
		});

		it("returns error for whitespace-only prompt", () => {
			const err = validateTextTab("   ", ["model_a"]);
			expect(err).toBe("Missing prompt for text tab");
		});

		it("returns error when no models selected", () => {
			const err = validateTextTab("hello", []);
			expect(err).toBe("No models selected for text tab");
		});

		it("returns null for valid text input", () => {
			const err = validateGenerationInputs("text", baseCtx);
			expect(err).toBeNull();
		});
	});

	describe("image tab", () => {
		it("returns error when no models selected", () => {
			const err = validateImageTab([], null, null, null);
			expect(err).toBe("Missing models for image tab");
		});

		it("returns error when frame model without frames", () => {
			const err = validateImageTab(["veo31_frame_to_video"], null, null, null);
			expect(err).toBe("Frame-to-video models require first and last frames");
		});

		it("returns error when image model without image", () => {
			const err = validateImageTab(["sora2_image_to_video"], null, null, null);
			expect(err).toBe("Image-to-video models require an image");
		});

		it("returns null for valid image input", () => {
			const err = validateGenerationInputs("image", {
				...baseCtx,
				selectedImage: new File([""], "test.png"),
			});
			expect(err).toBeNull();
		});
	});

	describe("avatar tab", () => {
		it("returns error when no models selected", () => {
			const err = validateAvatarTab([], null, null, null, []);
			expect(err).toBe("Missing models for avatar tab");
		});

		it("returns error for V2V model without source video", () => {
			const err = validateAvatarTab(
				["wan_animate_replace"],
				null,
				null,
				null,
				[]
			);
			expect(err).toBe("Video-to-video model requires source video");
		});

		it("returns error for audio model without audio", () => {
			const err = validateAvatarTab(
				["kling_avatar_pro"],
				null,
				null,
				new File([""], "avatar.png"),
				[]
			);
			expect(err).toBe("Audio-based avatar model requires audio file");
		});

		it("returns error for audio model without avatar image", () => {
			const err = validateAvatarTab(
				["kling_avatar_pro"],
				null,
				new File([""], "audio.mp3"),
				null,
				[]
			);
			expect(err).toBe("Audio-based avatar model requires avatar image");
		});

		it("returns error for ref2video without reference images", () => {
			const err = validateAvatarTab(
				["kling_o1_ref2video"],
				null,
				null,
				null,
				[]
			);
			expect(err).toBe(
				"Kling O1 Reference-to-Video requires at least one reference image"
			);
		});

		it("returns null for valid avatar config", () => {
			const err = validateAvatarTab(
				["kling_avatar_pro"],
				null,
				new File([""], "audio.mp3"),
				new File([""], "avatar.png"),
				[]
			);
			expect(err).toBeNull();
		});
	});

	describe("other tabs", () => {
		it("returns null for upscale tab (no pre-validation)", () => {
			const err = validateGenerationInputs("upscale", baseCtx);
			expect(err).toBeNull();
		});

		it("returns null for unknown tab", () => {
			const err = validateGenerationInputs("unknown", baseCtx);
			expect(err).toBeNull();
		});
	});
});

// ---------------------------------------------------------------------------
// buildUnifiedParams
// ---------------------------------------------------------------------------
describe("buildUnifiedParams", () => {
	const baseCaps: T2VModelCapabilities = {
		supportsAspectRatio: true,
		supportsResolution: true,
		supportsDuration: true,
		supportedDurations: [5, 10],
		supportsNegativePrompt: true,
		supportsPromptExpansion: true,
		supportsSeed: true,
		supportsSafetyChecker: true,
	};

	it("includes all supported params", () => {
		const result = buildUnifiedParams({
			modelId: "test_model",
			modelCapabilities: baseCaps,
			isSora2TextModel: false,
			t2vAspectRatio: "16:9",
			t2vResolution: "1080p",
			t2vDuration: 5,
			t2vNegativePrompt: "bad quality",
			t2vPromptExpansion: true,
			t2vSeed: 42,
			t2vSafetyChecker: false,
		});

		expect(result.aspect_ratio).toBe("16:9");
		expect(result.resolution).toBe("1080p");
		expect(result.duration).toBe(5);
		expect(result.negative_prompt).toBe("bad quality");
		expect(result.prompt_expansion).toBe(true);
		expect(result.seed).toBe(42);
		expect(result.enable_safety_checker).toBe(false);
	});

	it("skips aspect ratio and resolution for Sora2 text models", () => {
		const result = buildUnifiedParams({
			modelId: "sora2_text_to_video",
			modelCapabilities: baseCaps,
			isSora2TextModel: true,
			t2vAspectRatio: "16:9",
			t2vResolution: "1080p",
			t2vDuration: 5,
			t2vNegativePrompt: "",
			t2vPromptExpansion: false,
			t2vSeed: -1,
			t2vSafetyChecker: false,
		});

		expect(result.aspect_ratio).toBeUndefined();
		expect(result.resolution).toBeUndefined();
		expect(result.duration).toBeUndefined(); // Also skipped for Sora2
	});

	it("sanitizes duration via getSafeDuration", () => {
		const result = buildUnifiedParams({
			modelId: "test_model",
			modelCapabilities: baseCaps,
			isSora2TextModel: false,
			t2vAspectRatio: "",
			t2vResolution: "",
			t2vDuration: 7, // Not in [5, 10], should snap
			t2vNegativePrompt: "",
			t2vPromptExpansion: false,
			t2vSeed: -1,
			t2vSafetyChecker: false,
		});

		// Should fall back to first allowed duration (5)
		expect(result.duration).toBe(5);
	});

	it("returns empty object when capabilities is undefined", () => {
		const result = buildUnifiedParams({
			modelId: "test_model",
			modelCapabilities: undefined,
			isSora2TextModel: false,
			t2vAspectRatio: "16:9",
			t2vResolution: "1080p",
			t2vDuration: 5,
			t2vNegativePrompt: "bad",
			t2vPromptExpansion: true,
			t2vSeed: 42,
			t2vSafetyChecker: true,
		});

		expect(Object.keys(result)).toHaveLength(0);
	});

	it("omits seed when set to -1", () => {
		const result = buildUnifiedParams({
			modelId: "test_model",
			modelCapabilities: baseCaps,
			isSora2TextModel: false,
			t2vAspectRatio: "",
			t2vResolution: "",
			t2vDuration: 5,
			t2vNegativePrompt: "",
			t2vPromptExpansion: false,
			t2vSeed: -1,
			t2vSafetyChecker: false,
		});

		expect(result.seed).toBeUndefined();
	});

	it("trims negative prompt whitespace", () => {
		const result = buildUnifiedParams({
			modelId: "test_model",
			modelCapabilities: baseCaps,
			isSora2TextModel: false,
			t2vAspectRatio: "",
			t2vResolution: "",
			t2vDuration: 5,
			t2vNegativePrompt: "  bad quality  ",
			t2vPromptExpansion: false,
			t2vSeed: -1,
			t2vSafetyChecker: false,
		});

		expect(result.negative_prompt).toBe("bad quality");
	});
});

// ---------------------------------------------------------------------------
// getModelCapabilities
// ---------------------------------------------------------------------------
describe("getModelCapabilities", () => {
	it("returns capabilities for a known model", () => {
		const caps = getModelCapabilities("kling_v3_pro_t2v");
		expect(caps).toBeDefined();
		expect(caps?.supportsDuration).toBe(true);
	});

	it("returns undefined for unknown model", () => {
		expect(getModelCapabilities("nonexistent_model")).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// classifyResponse
// ---------------------------------------------------------------------------
describe("classifyResponse", () => {
	it("classifies direct_with_job when both job_id and video_url", () => {
		expect(
			classifyResponse({
				job_id: "abc",
				video_url: "https://example.com/video.mp4",
			})
		).toEqual({ type: "direct_with_job" });
	});

	it("classifies job_only when only job_id", () => {
		expect(classifyResponse({ job_id: "abc" })).toEqual({
			type: "job_only",
		});
	});

	it("classifies direct_video when only video_url", () => {
		expect(
			classifyResponse({ video_url: "https://example.com/video.mp4" })
		).toEqual({ type: "direct_video" });
	});

	it("classifies empty for undefined response", () => {
		expect(classifyResponse(undefined)).toEqual({ type: "empty" });
	});

	it("classifies empty for empty object", () => {
		expect(classifyResponse({})).toEqual({ type: "empty" });
	});
});
