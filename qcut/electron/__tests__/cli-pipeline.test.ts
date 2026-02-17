import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelRegistry } from "../native-pipeline/registry.js";
import { initRegistry, resetInitState } from "../native-pipeline/init.js";
import {
  CLIPipelineRunner,
  createProgressReporter,
} from "../native-pipeline/cli-runner.js";
import type { CLIRunOptions } from "../native-pipeline/cli-runner.js";

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

describe("CLI pipeline", () => {
  beforeEach(() => {
    ModelRegistry.clear();
    resetInitState();
    initRegistry();
  });

  describe("initRegistry", () => {
    it("registers 70+ models", () => {
      expect(ModelRegistry.count()).toBeGreaterThanOrEqual(70);
    });

    it("is idempotent — calling twice does not duplicate models", () => {
      const countBefore = ModelRegistry.count();
      initRegistry();
      expect(ModelRegistry.count()).toBe(countBefore);
    });
  });

  describe("CLIPipelineRunner — list-models", () => {
    it("returns all models", async () => {
      const runner = new CLIPipelineRunner();
      const noop = vi.fn();
      const result = await runner.run(defaultOptions({ command: "list-models" }), noop);

      expect(result.success).toBe(true);
      const data = result.data as { models: unknown[]; count: number };
      expect(data.count).toBeGreaterThanOrEqual(70);
      expect(data.models.length).toBe(data.count);
    });

    it("filters by category", async () => {
      const runner = new CLIPipelineRunner();
      const noop = vi.fn();
      const result = await runner.run(
        defaultOptions({ command: "list-models", category: "text_to_video" }),
        noop
      );

      expect(result.success).toBe(true);
      const data = result.data as {
        models: { categories: string[] }[];
        count: number;
      };
      expect(data.count).toBeGreaterThan(0);
      for (const m of data.models) {
        expect(m.categories).toContain("text_to_video");
      }
    });
  });

  describe("CLIPipelineRunner — estimate-cost", () => {
    it("returns cost estimate for known model", async () => {
      const runner = new CLIPipelineRunner();
      const noop = vi.fn();
      const result = await runner.run(
        defaultOptions({ command: "estimate-cost", model: "kling_2_6_pro" }),
        noop
      );

      expect(result.success).toBe(true);
      expect(result.cost).toBeGreaterThan(0);
      expect(result.data).toBeDefined();
      const data = result.data as { model: string; totalCost: number; currency: string };
      expect(data.model).toBe("kling_2_6_pro");
      expect(data.currency).toBe("USD");
    });

    it("errors on missing model", async () => {
      const runner = new CLIPipelineRunner();
      const noop = vi.fn();
      const result = await runner.run(
        defaultOptions({ command: "estimate-cost" }),
        noop
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("--model");
    });

    it("errors on unknown model", async () => {
      const runner = new CLIPipelineRunner();
      const noop = vi.fn();
      const result = await runner.run(
        defaultOptions({ command: "estimate-cost", model: "nonexistent_model" }),
        noop
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("nonexistent_model");
    });
  });

  describe("CLIPipelineRunner — generate validation", () => {
    it("errors on missing model for generate-image", async () => {
      const runner = new CLIPipelineRunner();
      const noop = vi.fn();
      const result = await runner.run(
        defaultOptions({ command: "generate-image", text: "test" }),
        noop
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("--model");
    });

    it("errors on unknown model for create-video", async () => {
      const runner = new CLIPipelineRunner();
      const noop = vi.fn();
      const result = await runner.run(
        defaultOptions({ command: "create-video", model: "fake_model", text: "test" }),
        noop
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("fake_model");
    });
  });

  describe("CLIPipelineRunner — run-pipeline validation", () => {
    it("errors on missing config", async () => {
      const runner = new CLIPipelineRunner();
      const noop = vi.fn();
      const result = await runner.run(
        defaultOptions({ command: "run-pipeline" }),
        noop
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("--config");
    });

    it("errors on non-existent config file", async () => {
      const runner = new CLIPipelineRunner();
      const noop = vi.fn();
      const result = await runner.run(
        defaultOptions({ command: "run-pipeline", config: "/nonexistent/path.yaml" }),
        noop
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot read config");
    });
  });

  describe("CLIPipelineRunner — unknown command", () => {
    it("errors on unrecognized command", async () => {
      const runner = new CLIPipelineRunner();
      const noop = vi.fn();
      const result = await runner.run(
        defaultOptions({ command: "do-magic" }),
        noop
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown command");
    });
  });

  describe("createProgressReporter", () => {
    it("produces no output in quiet mode", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const reporter = createProgressReporter({ json: false, quiet: true });
      reporter({ stage: "processing", percent: 50, message: "Working...", model: "test" });
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("produces JSON output in json mode", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const reporter = createProgressReporter({ json: true, quiet: false });
      reporter({ stage: "processing", percent: 50, message: "Working...", model: "test" });
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.type).toBe("progress");
      expect(parsed.percent).toBe(50);
      expect(parsed.model).toBe("test");
      consoleSpy.mockRestore();
    });
  });
});
