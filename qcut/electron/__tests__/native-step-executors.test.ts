import { describe, expect, it } from "vitest";
import {
	getInputDataType,
	getOutputDataType,
} from "../native-pipeline/execution/step-executors.js";

describe("step-executors data types", () => {
	describe("getInputDataType", () => {
		it("returns text for text_to_image", () => {
			expect(getInputDataType("text_to_image")).toBe("text");
		});

		it("returns text for text_to_video", () => {
			expect(getInputDataType("text_to_video")).toBe("text");
		});

		it("returns text for text_to_speech", () => {
			expect(getInputDataType("text_to_speech")).toBe("text");
		});

		it("returns image for image_to_video", () => {
			expect(getInputDataType("image_to_video")).toBe("image");
		});

		it("returns image for image_to_image", () => {
			expect(getInputDataType("image_to_image")).toBe("image");
		});

		it("returns image for image_understanding", () => {
			expect(getInputDataType("image_understanding")).toBe("image");
		});

		it("returns image for avatar", () => {
			expect(getInputDataType("avatar")).toBe("image");
		});

		it("returns video for video_to_video", () => {
			expect(getInputDataType("video_to_video")).toBe("video");
		});

		it("returns video for upscale_video", () => {
			expect(getInputDataType("upscale_video")).toBe("video");
		});

		it("returns video for add_audio", () => {
			expect(getInputDataType("add_audio")).toBe("video");
		});

		it("returns audio for speech_to_text", () => {
			expect(getInputDataType("speech_to_text")).toBe("audio");
		});

		it("returns text for prompt_generation", () => {
			expect(getInputDataType("prompt_generation")).toBe("text");
		});
	});

	describe("getOutputDataType", () => {
		it("returns image for text_to_image", () => {
			expect(getOutputDataType("text_to_image")).toBe("image");
		});

		it("returns image for image_to_image", () => {
			expect(getOutputDataType("image_to_image")).toBe("image");
		});

		it("returns video for text_to_video", () => {
			expect(getOutputDataType("text_to_video")).toBe("video");
		});

		it("returns video for image_to_video", () => {
			expect(getOutputDataType("image_to_video")).toBe("video");
		});

		it("returns video for avatar", () => {
			expect(getOutputDataType("avatar")).toBe("video");
		});

		it("returns video for upscale_video", () => {
			expect(getOutputDataType("upscale_video")).toBe("video");
		});

		it("returns audio for text_to_speech", () => {
			expect(getOutputDataType("text_to_speech")).toBe("audio");
		});

		it("returns text for speech_to_text", () => {
			expect(getOutputDataType("speech_to_text")).toBe("text");
		});

		it("returns text for image_understanding", () => {
			expect(getOutputDataType("image_understanding")).toBe("text");
		});

		it("returns text for prompt_generation", () => {
			expect(getOutputDataType("prompt_generation")).toBe("text");
		});
	});
});
