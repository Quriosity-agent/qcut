/**
 * Tests for v3 Python→TypeScript parity gaps.
 *
 * Tests: negativePrompt/voiceId wiring, --project-id option,
 * script2video --no-references fix, adapter convenience functions,
 * getAvailableReferenceModels(), and configDir override.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelRegistry } from "../native-pipeline/registry.js";
import { initRegistry, resetInitState } from "../native-pipeline/init.js";
import { parseCliArgs } from "../native-pipeline/cli.js";
import {
	ImageGeneratorAdapter,
	generateImage,
	generateImageWithReference,
} from "../native-pipeline/vimax/adapters/image-adapter.js";
import {
	VideoGeneratorAdapter,
	generateVideo,
} from "../native-pipeline/vimax/adapters/video-adapter.js";
import {
	LLMAdapter,
	chat,
	generate,
} from "../native-pipeline/vimax/adapters/llm-adapter.js";

describe("CLI v3 gaps — unused option wiring", () => {
	let exitSpy: ReturnType<typeof vi.spyOn>;
	let consoleSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		ModelRegistry.clear();
		resetInitState();
		initRegistry();
		exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit");
		});
		consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		exitSpy.mockRestore();
		consoleSpy.mockRestore();
	});

	describe("--negative-prompt option", () => {
		it("parses --negative-prompt for generate-image", () => {
			const opts = parseCliArgs([
				"generate-image",
				"--model",
				"flux_dev",
				"--text",
				"A cat",
				"--negative-prompt",
				"ugly, blurry",
			]);
			expect(opts.negativePrompt).toBe("ugly, blurry");
		});

		it("parses --negative-prompt for create-video", () => {
			const opts = parseCliArgs([
				"create-video",
				"--model",
				"kling",
				"--text",
				"Ocean waves",
				"--negative-prompt",
				"low quality",
			]);
			expect(opts.negativePrompt).toBe("low quality");
		});
	});

	describe("--voice-id option", () => {
		it("parses --voice-id for generate-avatar", () => {
			const opts = parseCliArgs([
				"generate-avatar",
				"--model",
				"heygen_avatar",
				"--voice-id",
				"rachel",
			]);
			expect(opts.voiceId).toBe("rachel");
		});
	});

	describe("--project-id option", () => {
		it("parses --project-id for vimax:create-registry", () => {
			const opts = parseCliArgs([
				"vimax:create-registry",
				"--input",
				"./portraits",
				"--project-id",
				"my-film",
			]);
			expect(opts.projectId).toBe("my-film");
		});

		it("projectId defaults to undefined when not provided", () => {
			const opts = parseCliArgs([
				"vimax:create-registry",
				"--input",
				"./portraits",
			]);
			expect(opts.projectId).toBeUndefined();
		});
	});

	describe("--no-references for vimax:script2video", () => {
		it("parses --no-references flag", () => {
			const opts = parseCliArgs([
				"vimax:script2video",
				"--script",
				"script.json",
				"--no-references",
			]);
			expect(opts.noReferences).toBe(true);
		});

		it("noReferences defaults to false", () => {
			const opts = parseCliArgs([
				"vimax:script2video",
				"--script",
				"script.json",
			]);
			expect(opts.noReferences).toBe(false);
		});
	});

	describe("--config-dir option", () => {
		it("parses --config-dir", () => {
			const opts = parseCliArgs([
				"list-models",
				"--config-dir",
				"/custom/config",
			]);
			expect(opts.configDir).toBe("/custom/config");
		});

		it("parses --cache-dir", () => {
			const opts = parseCliArgs([
				"list-models",
				"--cache-dir",
				"/custom/cache",
			]);
			expect(opts.cacheDir).toBe("/custom/cache");
		});

		it("parses --state-dir", () => {
			const opts = parseCliArgs([
				"list-models",
				"--state-dir",
				"/custom/state",
			]);
			expect(opts.stateDir).toBe("/custom/state");
		});
	});
});

describe("ImageGeneratorAdapter.getAvailableReferenceModels", () => {
	it("returns reference model keys", () => {
		const models = ImageGeneratorAdapter.getAvailableReferenceModels();
		expect(models.length).toBeGreaterThan(0);
		expect(models).toContain("nano_banana_pro");
		expect(models).toContain("flux_kontext");
		expect(models).toContain("flux_redux");
	});

	it("returned models are all reference-capable", () => {
		const refModels = ImageGeneratorAdapter.getAvailableReferenceModels();
		for (const model of refModels) {
			expect(ImageGeneratorAdapter.supportsReferenceImages(model)).toBe(true);
		}
	});

	it("does not include non-reference models", () => {
		const refModels = ImageGeneratorAdapter.getAvailableReferenceModels();
		const allModels = ImageGeneratorAdapter.getAvailableModels();
		// Reference models should be a subset, not all text-to-image models
		const nonRefModel = allModels.find(
			(m) => !ImageGeneratorAdapter.supportsReferenceImages(m)
		);
		expect(nonRefModel).toBeDefined();
		expect(refModels).not.toContain(nonRefModel);
	});
});

describe("Adapter convenience functions", () => {
	describe("generateImage", () => {
		it("is an exported async function", () => {
			expect(typeof generateImage).toBe("function");
		});
	});

	describe("generateImageWithReference", () => {
		it("is an exported async function", () => {
			expect(typeof generateImageWithReference).toBe("function");
		});
	});

	describe("generateVideo", () => {
		it("is an exported async function", () => {
			expect(typeof generateVideo).toBe("function");
		});
	});

	describe("chat", () => {
		it("is an exported async function", () => {
			expect(typeof chat).toBe("function");
		});
	});

	describe("generate", () => {
		it("is an exported async function", () => {
			expect(typeof generate).toBe("function");
		});
	});
});
