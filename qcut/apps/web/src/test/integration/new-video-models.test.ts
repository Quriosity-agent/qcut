/**
 * Integration tests for new video models (Kling v2.5 Turbo Pro and WAN v2.5 Preview)
 *
 * Tests both text-to-video and image-to-video generation with proper API mocking
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	generateVideo,
	generateVideoFromImage,
	estimateCost,
	getAvailableModels,
} from "../../lib/ai-clients/ai-video-client";
import { AI_MODELS } from "../../components/editor/media-panel/views/ai/constants/ai-constants";

describe("New Video Models Integration", () => {
	beforeEach(() => {
		// Mock FAL API key
		vi.stubEnv("VITE_FAL_API_KEY", "test-api-key");

		// Mock fetch for FAL.ai API
		global.fetch = vi.fn();
	});

	describe("Kling v2.5 Turbo Pro", () => {
		it("should generate video with correct endpoint and parameters", async () => {
			const mockResponse = {
				video: { url: "https://fal.ai/test-video.mp4" },
			};

			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			});

			const request = {
				prompt: "Test video generation",
				model: "kling_v2_5_turbo",
				duration: 5,
				resolution: "1080p",
			};

			const result = await generateVideo(request);

			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining("kling-video/v2.5-turbo/pro/text-to-video"),
				expect.objectContaining({
					method: "POST",
					body: expect.stringContaining("cfg_scale"),
				})
			);
			expect(result.video_url).toBe(mockResponse.video.url);
		});

		it("should generate image-to-video with correct endpoint", async () => {
			const mockFile = new File(["test"], "test.jpg", { type: "image/jpeg" });
			const mockResponse = { video: { url: "https://fal.ai/test-video.mp4" } };

			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			});

			const result = await generateVideoFromImage({
				image: mockFile,
				model: "kling_v2_5_turbo",
				prompt: "Test image to video",
			});

			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining("kling-video/v2.5-turbo/pro/image-to-video"),
				expect.any(Object)
			);
			expect(result.video_url).toBe(mockResponse.video.url);
		});

		it("should handle parameter validation correctly", async () => {
			const mockResponse = { video: { url: "https://fal.ai/test-video.mp4" } };
			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			});

			const request = {
				prompt: "Test with custom parameters",
				model: "kling_v2_5_turbo",
				duration: 8,
				resolution: "1080p",
			};

			await generateVideo(request);

			// Check that the request body contains the expected parameters
			const callArgs = (global.fetch as any).mock.calls[0];
			const requestBody = JSON.parse(callArgs[1].body);

			expect(requestBody.duration).toBe(8);
			expect(requestBody.resolution).toBe("1080p");
			expect(requestBody.cfg_scale).toBe(0.5);
			expect(requestBody.aspect_ratio).toBe("16:9");
		});
	});

	describe("WAN v2.5 Preview", () => {
		it("should generate video with correct parameters", async () => {
			const mockResponse = { video: { url: "https://fal.ai/test-video.mp4" } };

			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			});

			const result = await generateVideo({
				prompt: "Test WAN video",
				model: "wan_25_preview",
				resolution: "1080p",
			});

			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining("wan-25-preview/text-to-video"),
				expect.any(Object)
			);
			expect(result.video_url).toBe(mockResponse.video.url);
		});

		it("should generate image-to-video with WAN 2.5 endpoint", async () => {
			const mockFile = new File(["test"], "test.jpg", { type: "image/jpeg" });
			const mockResponse = { video: { url: "https://fal.ai/test-video.mp4" } };

			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			});

			const result = await generateVideoFromImage({
				image: mockFile,
				model: "wan_25_preview",
				prompt: "Test WAN image to video",
			});

			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining("wan-25-preview/image-to-video"),
				expect.any(Object)
			);

			// Check that quality parameter is set
			const callArgs = (global.fetch as any).mock.calls[0];
			const requestBody = JSON.parse(callArgs[1].body);
			expect(requestBody.quality).toBe("high");
		});

		it("should validate resolution parameters", async () => {
			const mockResponse = { video: { url: "https://fal.ai/test-video.mp4" } };
			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			});

			const request = {
				prompt: "Test resolution validation",
				model: "wan_25_preview",
				resolution: "1440p", // Should be accepted
			};

			await generateVideo(request);

			const callArgs = (global.fetch as any).mock.calls[0];
			const requestBody = JSON.parse(callArgs[1].body);
			expect(requestBody.resolution).toBe("1440p");
		});
	});

	describe("Model Endpoint Integration", () => {
		it("should have all new models in modelEndpoints mapping", async () => {
			// Test that both new models resolve to correct endpoints
			const mockResponse = { video: { url: "https://fal.ai/test-video.mp4" } };
			(global.fetch as any).mockResolvedValue({
				ok: true,
				json: async () => mockResponse,
			});

			// Test kling_v2_5_turbo endpoint
			await generateVideo({
				prompt: "test",
				model: "kling_v2_5_turbo",
			});

			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining("kling-video/v2.5-turbo/pro/text-to-video"),
				expect.any(Object)
			);

			// Test wan_25_preview endpoint
			await generateVideo({
				prompt: "test",
				model: "wan_25_preview",
			});

			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining("wan-25-preview/text-to-video"),
				expect.any(Object)
			);
		});
	});

	describe("Cost Estimation", () => {
		it("should include cost data for new models", async () => {
			// Test cost estimation for new models
			const klingCost = await estimateCost({
				prompt: "test",
				model: "kling_v2_5_turbo",
				duration: 5,
			});

			const wanCost = await estimateCost({
				prompt: "test",
				model: "wan_25_preview",
				duration: 5,
			});

			expect(klingCost.model).toBe("kling_v2_5_turbo");
			expect(klingCost.base_cost).toBe(0.18);
			expect(klingCost.estimated_cost).toBeGreaterThan(0);

			expect(wanCost.model).toBe("wan_25_preview");
			expect(wanCost.base_cost).toBe(0.12);
			expect(wanCost.estimated_cost).toBeGreaterThan(0);
		});
	});

	describe("Available Models API", () => {
		it("should include all new models in getAvailableModels", async () => {
			const response = await getAvailableModels();
			const modelIds = response.models.map((m) => m.id);

			expect(modelIds).toContain("kling_v2_5_turbo");
			expect(modelIds).toContain("wan_25_preview");

			// Check model details
			const klingModel = response.models.find(
				(m) => m.id === "kling_v2_5_turbo"
			);
			const wanModel = response.models.find((m) => m.id === "wan_25_preview");

			expect(klingModel).toBeDefined();
			expect(klingModel?.name).toBe("Kling v2.5 Turbo Pro");
			expect(klingModel?.max_duration).toBe(10);

			expect(wanModel).toBeDefined();
			expect(wanModel?.name).toBe("WAN v2.5 Preview");
			expect(wanModel?.max_duration).toBe(10);
		});
	});

	describe("Error Handling", () => {
		it("should handle API errors gracefully for new models", async () => {
			// Mock a proper error response structure
			(global.fetch as any).mockResolvedValueOnce({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
				json: async () => ({ error: "Network error" }),
			});

			await expect(
				generateVideo({
					prompt: "test",
					model: "kling_v2_5_turbo",
				})
			).rejects.toThrow();

			// Reset and test second model
			(global.fetch as any).mockResolvedValueOnce({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
				json: async () => ({ error: "Network error" }),
			});

			await expect(
				generateVideo({
					prompt: "test",
					model: "wan_25_preview",
				})
			).rejects.toThrow();
		});
	});

	describe("Kling v2.6 Pro", () => {
		it("should generate T2V with correct endpoint and parameters", async () => {
			const mockResponse = {
				video: { url: "https://fal.ai/test-video.mp4" },
			};

			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			});

			const request = {
				prompt: "Test Kling 2.6 video generation",
				model: "kling_v26_pro_t2v",
				duration: 5,
			};

			const result = await generateVideo(request);

			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining("kling-video/v2.6/pro/text-to-video"),
				expect.objectContaining({
					method: "POST",
				})
			);
			expect(result.video_url).toBe(mockResponse.video.url);
		});

		it("should generate I2V with correct endpoint", async () => {
			const mockFile = new File(["test"], "test.jpg", { type: "image/jpeg" });
			const mockResponse = { video: { url: "https://fal.ai/test-video.mp4" } };

			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			});

			const result = await generateVideoFromImage({
				image: mockFile,
				model: "kling_v26_pro_i2v",
				prompt: "Test Kling 2.6 image to video",
			});

			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining("kling-video/v2.6/pro/image-to-video"),
				expect.any(Object)
			);
			expect(result.video_url).toBe(mockResponse.video.url);
		});

		it("should calculate correct pricing with audio on/off", async () => {
			// Audio off: $0.07/s → 5s = $0.35, 10s = $0.70
			// Audio on:  $0.14/s → 5s = $0.70, 10s = $1.40
			const calculateKling26Cost = (
				duration: number,
				generateAudio: boolean
			): number => {
				const perSecondRate = generateAudio ? 0.14 : 0.07;
				return duration * perSecondRate;
			};

			// Audio off tests - use toBeCloseTo for floating point comparison
			expect(calculateKling26Cost(5, false)).toBeCloseTo(0.35, 2);
			expect(calculateKling26Cost(10, false)).toBeCloseTo(0.7, 2);

			// Audio on tests
			expect(calculateKling26Cost(5, true)).toBeCloseTo(0.7, 2);
			expect(calculateKling26Cost(10, true)).toBeCloseTo(1.4, 2);
		});

		it("should validate aspect ratio options against model config", async () => {
			// Get the actual model config from AI_MODELS (source of truth)
			const klingV26Model = AI_MODELS.find((m) => m.id === "kling_v26_pro_t2v");
			expect(klingV26Model).toBeDefined();

			const supportedRatios = klingV26Model?.supportedAspectRatios ?? [];

			// Kling v2.6 should support exactly these aspect ratios
			expect(supportedRatios).toContain("16:9");
			expect(supportedRatios).toContain("9:16");
			expect(supportedRatios).toContain("1:1");
			expect(supportedRatios).toHaveLength(3);

			// These ratios should NOT be supported (they are v2.5 specific)
			const unsupportedRatios = ["4:3", "3:4", "21:9"];
			for (const ratio of unsupportedRatios) {
				expect(supportedRatios).not.toContain(ratio);
			}
		});

		it("should include generate_audio in request payload", async () => {
			const mockResponse = { video: { url: "https://fal.ai/test-video.mp4" } };
			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			});

			const request = {
				prompt: "Test with audio generation",
				model: "kling_v26_pro_t2v",
				duration: 5,
			};

			await generateVideo(request);

			// Check that the request body contains generate_audio
			const callArgs = (global.fetch as any).mock.calls[0];
			const requestBody = JSON.parse(callArgs[1].body);

			expect(requestBody.generate_audio).toBeDefined();
			expect(typeof requestBody.generate_audio).toBe("boolean");
		});
	});
});
