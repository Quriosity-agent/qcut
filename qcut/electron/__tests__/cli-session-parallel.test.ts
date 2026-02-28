import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelRegistry } from "../native-pipeline/infra/registry.js";
import { initRegistry, resetInitState } from "../native-pipeline/init.js";
import { CLIPipelineRunner } from "../native-pipeline/cli/cli-runner.js";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner.js";
import { parseCliArgs } from "../native-pipeline/cli/cli.js";
import { PipelineExecutor } from "../native-pipeline/execution/executor.js";
import * as apiCaller from "../native-pipeline/infra/api-caller.js";
import {
	parseSessionLine,
	resetSessionState,
} from "../native-pipeline/cli/cli-runner/session.js";

function defaultOptions(overrides: Partial<CLIRunOptions> = {}): CLIRunOptions {
	return {
		command: "list-models",
		outputDir: "./test-output",
		saveIntermediates: false,
		json: false,
		verbose: false,
		quiet: false,
		...overrides,
	};
}

describe("CLI session & parallel", () => {
	beforeEach(() => {
		ModelRegistry.clear();
		resetInitState();
		initRegistry();
	});

	describe("Parallel generation (--count / --prompts)", () => {
		it("parses --count flag", () => {
			const opts = parseCliArgs([
				"generate-image",
				"-t",
				"A cat in space",
				"--count",
				"3",
			]);
			expect(opts.count).toBe(3);
		});

		it("parses --prompts flag (multiple)", () => {
			const opts = parseCliArgs([
				"generate-image",
				"--prompts",
				"A cat",
				"--prompts",
				"A dog",
			]);
			expect(opts.prompts).toEqual(["A cat", "A dog"]);
		});

		it("parses --skip-health flag", () => {
			const opts = parseCliArgs(["editor:health", "--skip-health"]);
			expect(opts.skipHealth).toBe(true);
		});

		it("runs parallel generation with --count", async () => {
			let callCount = 0;
			const mockExecuteStep = vi
				.spyOn(PipelineExecutor.prototype, "executeStep")
				.mockImplementation(async () => {
					callCount++;
					return {
						success: true,
						outputPath: `/tmp/output_${callCount}.png`,
						duration: 1.0,
						cost: 0.01,
					};
				});

			const runner = new CLIPipelineRunner();
			const progress = vi.fn();
			const result = await runner.run(
				defaultOptions({
					command: "generate-image",
					text: "A cat",
					count: 3,
				}),
				progress
			);

			expect(result.success).toBe(true);
			expect(result.outputPaths).toHaveLength(3);
			expect(mockExecuteStep).toHaveBeenCalledTimes(3);
			expect(result.cost).toBeCloseTo(0.03, 2);

			mockExecuteStep.mockRestore();
		});

		it("runs parallel generation with --prompts", async () => {
			let callIndex = 0;
			const mockExecuteStep = vi
				.spyOn(PipelineExecutor.prototype, "executeStep")
				.mockImplementation(async () => {
					callIndex++;
					return {
						success: true,
						outputPath: `/tmp/output_${callIndex}.png`,
						duration: 1.0,
						cost: 0.02,
					};
				});

			const runner = new CLIPipelineRunner();
			const result = await runner.run(
				defaultOptions({
					command: "generate-image",
					prompts: ["A cat", "A dog"],
				}),
				vi.fn()
			);

			expect(result.success).toBe(true);
			expect(result.outputPaths).toHaveLength(2);
			expect(mockExecuteStep).toHaveBeenCalledTimes(2);

			mockExecuteStep.mockRestore();
		});

		it("reports partial success when some jobs fail", async () => {
			let callIndex = 0;
			const mockExecuteStep = vi
				.spyOn(PipelineExecutor.prototype, "executeStep")
				.mockImplementation(async () => {
					callIndex++;
					if (callIndex === 2) {
						return { success: false, error: "API timeout", duration: 5 };
					}
					return {
						success: true,
						outputPath: `/tmp/output_${callIndex}.png`,
						duration: 1.0,
						cost: 0.01,
					};
				});

			const runner = new CLIPipelineRunner();
			const result = await runner.run(
				defaultOptions({
					command: "generate-image",
					text: "A cat",
					count: 3,
				}),
				vi.fn()
			);

			// Still succeeds because 2/3 completed
			expect(result.success).toBe(true);
			expect(result.outputPaths).toHaveLength(2);
			expect(result.data).toHaveProperty("errors");

			mockExecuteStep.mockRestore();
		});

		it("fails when all jobs fail", async () => {
			const mockExecuteStep = vi
				.spyOn(PipelineExecutor.prototype, "executeStep")
				.mockResolvedValue({
					success: false,
					error: "API timeout",
					duration: 5,
				});

			const runner = new CLIPipelineRunner();
			const result = await runner.run(
				defaultOptions({
					command: "generate-image",
					text: "A cat",
					count: 2,
				}),
				vi.fn()
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain("All 2 jobs failed");

			mockExecuteStep.mockRestore();
		});

		it("single generation (count=1) uses fast path", async () => {
			const mockExecuteStep = vi
				.spyOn(PipelineExecutor.prototype, "executeStep")
				.mockResolvedValue({
					success: true,
					outputPath: "/tmp/output.png",
					duration: 1.0,
					cost: 0.01,
				});

			const runner = new CLIPipelineRunner();
			const result = await runner.run(
				defaultOptions({
					command: "generate-image",
					text: "A cat",
					count: 1,
				}),
				vi.fn()
			);

			expect(result.success).toBe(true);
			// Single path, not wrapped in batch output
			expect(result.outputPath).toBe("/tmp/output.png");
			expect(mockExecuteStep).toHaveBeenCalledTimes(1);

			mockExecuteStep.mockRestore();
		});
	});

	describe("Session mode (parseSessionLine)", () => {
		afterEach(() => {
			resetSessionState();
		});

		it("parses a simple command", () => {
			const opts = parseSessionLine("list-models", {});
			expect(opts).not.toBeNull();
			expect(opts!.command).toBe("list-models");
		});

		it("parses command with flags", () => {
			const opts = parseSessionLine(
				'generate-image -t "A cat in space" -m flux_dev',
				{}
			);
			expect(opts).not.toBeNull();
			expect(opts!.command).toBe("generate-image");
			expect(opts!.text).toBe("A cat in space");
			expect(opts!.model).toBe("flux_dev");
		});

		it("parses editor command with project-id", () => {
			const opts = parseSessionLine(
				"editor:navigator:open --project-id abc123",
				{}
			);
			expect(opts).not.toBeNull();
			expect(opts!.command).toBe("editor:navigator:open");
			expect(opts!.projectId).toBe("abc123");
		});

		it("returns null for empty lines", () => {
			expect(parseSessionLine("", {})).toBeNull();
			expect(parseSessionLine("   ", {})).toBeNull();
		});

		it("returns null for comments", () => {
			expect(parseSessionLine("# this is a comment", {})).toBeNull();
		});

		it("returns null for exit/quit", () => {
			expect(parseSessionLine("exit", {})).toBeNull();
			expect(parseSessionLine("quit", {})).toBeNull();
		});

		it("inherits base options", () => {
			const opts = parseSessionLine("list-models", {
				json: true,
				host: "192.168.1.1",
				port: "9999",
			});
			expect(opts).not.toBeNull();
			expect(opts!.json).toBe(true);
			expect(opts!.host).toBe("192.168.1.1");
			expect(opts!.port).toBe("9999");
		});

		it("parses --count flag in session", () => {
			const opts = parseSessionLine("generate-image -t test --count 3", {});
			expect(opts).not.toBeNull();
			expect(opts!.count).toBe(3);
		});

		it("handles single-quoted strings", () => {
			const opts = parseSessionLine("generate-image -t 'hello world'", {});
			expect(opts).not.toBeNull();
			expect(opts!.text).toBe("hello world");
		});

		it("dispatches parsed command through runner", async () => {
			const mockExecuteStep = vi
				.spyOn(PipelineExecutor.prototype, "executeStep")
				.mockResolvedValue({
					success: true,
					outputPath: "/tmp/session-out.png",
					duration: 1.0,
					cost: 0.01,
				});

			const runner = new CLIPipelineRunner();
			const opts = parseSessionLine("generate-image -t test", {});
			expect(opts).not.toBeNull();

			const result = await runner.run(opts!, vi.fn());
			expect(result.success).toBe(true);

			mockExecuteStep.mockRestore();
		});
	});

	describe("envApiKeyProvider", () => {
		it("reads FAL_KEY from environment", async () => {
			const orig = process.env.FAL_KEY;
			process.env.FAL_KEY = "test-fal-key";

			const key = await apiCaller.envApiKeyProvider("fal");
			expect(key).toBe("test-fal-key");

			if (orig) process.env.FAL_KEY = orig;
			else delete process.env.FAL_KEY;
		});

		it("reads ELEVENLABS_API_KEY from environment", async () => {
			const orig = process.env.ELEVENLABS_API_KEY;
			process.env.ELEVENLABS_API_KEY = "test-el-key";

			const key = await apiCaller.envApiKeyProvider("elevenlabs");
			expect(key).toBe("test-el-key");

			if (orig) process.env.ELEVENLABS_API_KEY = orig;
			else delete process.env.ELEVENLABS_API_KEY;
		});

		it("returns empty string when no key is set", async () => {
			const origFal = process.env.FAL_KEY;
			const origFalApi = process.env.FAL_API_KEY;
			delete process.env.FAL_KEY;
			delete process.env.FAL_API_KEY;

			const key = await apiCaller.envApiKeyProvider("fal");
			expect(key).toBe("");

			if (origFal) process.env.FAL_KEY = origFal;
			if (origFalApi) process.env.FAL_API_KEY = origFalApi;
		});
	});
});
