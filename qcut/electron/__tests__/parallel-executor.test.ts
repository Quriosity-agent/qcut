import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ParallelPipelineExecutor,
  MergeStrategy,
} from "../native-pipeline/parallel-executor.js";
import type { PipelineChain, PipelineStep } from "../native-pipeline/executor.js";
import { PipelineExecutor } from "../native-pipeline/executor.js";
import { ModelRegistry } from "../native-pipeline/registry.js";
import { initRegistry, resetInitState } from "../native-pipeline/init.js";
import { parseChainConfig, hasParallelGroups } from "../native-pipeline/chain-parser.js";

describe("Parallel Executor", () => {
  beforeEach(() => {
    ModelRegistry.clear();
    resetInitState();
    initRegistry();
  });

  describe("ParallelPipelineExecutor construction", () => {
    it("creates with default config", () => {
      const exec = new ParallelPipelineExecutor();
      expect(exec.getStats().speedupFactor).toBe(1);
    });

    it("creates with custom config", () => {
      const exec = new ParallelPipelineExecutor({
        enabled: true,
        maxWorkers: 4,
      });
      expect(exec.getStats().parallelGroups).toBe(0);
    });
  });

  describe("analyzeParallelOpportunities", () => {
    it("identifies independent text_to_image steps as parallelizable", () => {
      const exec = new ParallelPipelineExecutor();
      const steps: PipelineStep[] = [
        { type: "text_to_image", model: "flux_dev", params: { prompt: "cat" }, enabled: true, retryCount: 0 },
        { type: "text_to_image", model: "flux_schnell", params: { prompt: "dog" }, enabled: true, retryCount: 0 },
      ];
      const plan = exec.analyzeParallelOpportunities(steps);
      expect(plan.groups.length).toBe(1);
      expect(plan.groups[0].parallel).toBe(true);
      expect(plan.groups[0].steps.length).toBe(2);
    });

    it("marks dependent steps as sequential", () => {
      const exec = new ParallelPipelineExecutor();
      const steps: PipelineStep[] = [
        { type: "text_to_image", model: "flux_dev", params: { prompt: "cat" }, enabled: true, retryCount: 0 },
        { type: "image_to_video", model: "wan_2_6", params: {}, enabled: true, retryCount: 0 },
      ];
      const plan = exec.analyzeParallelOpportunities(steps);
      const sequentialGroups = plan.groups.filter((g) => !g.parallel);
      expect(sequentialGroups.length).toBeGreaterThan(0);
    });

    it("handles single step", () => {
      const exec = new ParallelPipelineExecutor();
      const steps: PipelineStep[] = [
        { type: "text_to_image", model: "flux_dev", params: {}, enabled: true, retryCount: 0 },
      ];
      const plan = exec.analyzeParallelOpportunities(steps);
      expect(plan.groups.length).toBe(1);
      expect(plan.groups[0].parallel).toBe(false);
    });

    it("does not parallelize steps with template references", () => {
      const exec = new ParallelPipelineExecutor();
      const steps: PipelineStep[] = [
        { type: "text_to_image", model: "flux_dev", params: { prompt: "cat" }, enabled: true, retryCount: 0 },
        { type: "text_to_image", model: "flux_schnell", params: { prompt: "{{prev.output}}" }, enabled: true, retryCount: 0 },
      ];
      const plan = exec.analyzeParallelOpportunities(steps);
      const parallelGroups = plan.groups.filter((g) => g.parallel);
      expect(parallelGroups.length).toBe(0);
    });
  });

  describe("canParallelizeStep", () => {
    it("returns true for text_to_image at index 0", () => {
      const exec = new ParallelPipelineExecutor();
      const step: PipelineStep = {
        type: "text_to_image",
        model: "flux_dev",
        params: {},
        enabled: true,
        retryCount: 0,
      };
      expect(exec.canParallelizeStep(step, 0, [step])).toBe(true);
    });

    it("returns true for prompt_generation", () => {
      const exec = new ParallelPipelineExecutor();
      const step: PipelineStep = {
        type: "prompt_generation",
        model: "openrouter_video_prompt",
        params: {},
        enabled: true,
        retryCount: 0,
      };
      expect(exec.canParallelizeStep(step, 0, [step])).toBe(true);
    });

    it("returns false for unsupported categories", () => {
      const exec = new ParallelPipelineExecutor();
      const step: PipelineStep = {
        type: "upscale" as never,
        model: "topaz",
        params: {},
        enabled: true,
        retryCount: 0,
      };
      expect(exec.canParallelizeStep(step, 0, [step])).toBe(false);
    });
  });

  describe("MergeStrategy enum", () => {
    it("has all expected values", () => {
      expect(MergeStrategy.COLLECT_ALL).toBe("COLLECT_ALL");
      expect(MergeStrategy.FIRST_SUCCESS).toBe("FIRST_SUCCESS");
      expect(MergeStrategy.BEST_QUALITY).toBe("BEST_QUALITY");
      expect(MergeStrategy.MERGE_OUTPUTS).toBe("MERGE_OUTPUTS");
    });
  });

  describe("executeChain with disabled parallel", () => {
    it("falls back to sequential execution", async () => {
      const exec = new ParallelPipelineExecutor({ enabled: false });

      const mockExecuteStep = vi.spyOn(PipelineExecutor.prototype, "executeStep")
        .mockResolvedValue({
          success: true,
          outputPath: "/tmp/test.png",
          duration: 1,
          cost: 0.01,
        });

      const chain: PipelineChain = {
        name: "test",
        steps: [
          { type: "text_to_image", model: "flux_dev", params: {}, enabled: true, retryCount: 0 },
        ],
        config: {},
      };

      const result = await exec.executeChain(chain, "test prompt", vi.fn());
      expect(result.success).toBe(true);

      mockExecuteStep.mockRestore();
    });
  });

  describe("executeChain handles empty steps", () => {
    it("returns error for no enabled steps", async () => {
      const exec = new ParallelPipelineExecutor();
      const chain: PipelineChain = {
        name: "empty",
        steps: [
          { type: "text_to_image", model: "flux_dev", params: {}, enabled: false, retryCount: 0 },
        ],
        config: {},
      };
      const result = await exec.executeChain(chain, "test", vi.fn());
      expect(result.success).toBe(false);
      expect(result.error).toContain("No enabled steps");
    });
  });

  describe("executeChain handles cancellation", () => {
    it("returns cancelled result when signal is aborted", async () => {
      const exec = new ParallelPipelineExecutor();
      const controller = new AbortController();
      controller.abort();

      const chain: PipelineChain = {
        name: "test",
        steps: [
          { type: "text_to_image", model: "flux_dev", params: {}, enabled: true, retryCount: 0 },
        ],
        config: {},
      };

      const result = await exec.executeChain(chain, "test", vi.fn(), controller.signal);
      expect(result.success).toBe(false);
      expect(result.error).toContain("cancelled");
    });
  });

  describe("YAML parallel_group parsing", () => {
    it("parses parallel_group steps", () => {
      const yaml = `
name: parallel-test
steps:
  - type: parallel_group
    merge_strategy: COLLECT_ALL
    steps:
      - type: text_to_image
        model: flux_dev
        params:
          prompt: "cat"
      - type: text_to_image
        model: flux_schnell
        params:
          prompt: "dog"
config:
  parallel: true
`;
      const chain = parseChainConfig(yaml);
      expect(chain.name).toBe("parallel-test");
      expect(chain.steps.length).toBe(2);
      expect(chain.config.parallel).toBe(true);
    });

    it("hasParallelGroups detects parallel_group markers", () => {
      const yaml = `
name: parallel-test
steps:
  - type: parallel_group
    merge_strategy: FIRST_SUCCESS
    steps:
      - type: text_to_image
        model: flux_dev
        params:
          prompt: "test"
      - type: text_to_image
        model: flux_schnell
        params:
          prompt: "test"
`;
      const chain = parseChainConfig(yaml);
      expect(hasParallelGroups(chain)).toBe(true);
    });

    it("hasParallelGroups returns false for sequential pipelines", () => {
      const yaml = `
name: sequential-test
steps:
  - type: text_to_image
    model: flux_dev
    params:
      prompt: "test"
`;
      const chain = parseChainConfig(yaml);
      expect(hasParallelGroups(chain)).toBe(false);
    });
  });
});
