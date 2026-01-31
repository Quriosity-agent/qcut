/**
 * Tests for Component Loader - Analysis Integration
 *
 * @module lib/remotion/__tests__/component-loader-analysis.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LoadResult } from "../component-loader";
import type { AnalysisResult } from "../sequence-analysis-service";

// Mock the sequence analysis service
const mockAnalyzeComponent = vi.fn();
const mockInvalidateCache = vi.fn();

vi.mock("../sequence-analysis-service", () => ({
  getSequenceAnalysisService: () => ({
    analyzeComponent: mockAnalyzeComponent,
    invalidateCache: mockInvalidateCache,
  }),
}));

// Mock component validator - needs to be before the import
vi.mock("../component-validator", () => ({
  validateComponent: () => ({
    valid: true,
    errors: [],
    warnings: [],
    metadata: {
      name: "TestComponent",
      description: "A test component",
      category: "templates",
      durationInFrames: 300,
      fps: 30,
      width: 1920,
      height: 1080,
      hasSchema: true,
      hasDefaultProps: true,
      exports: ["default", "TestComponent"],
    },
  }),
}));

// Import after mocks are set up
import { loadComponentFromCode } from "../component-loader";

describe("Component Loader - Analysis Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock return for analysis
    mockAnalyzeComponent.mockResolvedValue({
      componentId: "test-component",
      parsed: {
        sequences: [
          { name: "Scene1", from: 0, durationInFrames: 60, line: 5, isTransitionSequence: false },
          { name: "Scene2", from: 60, durationInFrames: 90, line: 10, isTransitionSequence: false },
        ],
        transitions: [],
        usesTransitionSeries: false,
        errors: [],
      },
      structure: {
        sequences: [
          { name: "Scene1", from: 0, durationInFrames: 60 },
          { name: "Scene2", from: 60, durationInFrames: 90 },
        ],
      },
      hasDynamicValues: false,
      analyzedAt: Date.now(),
      sourceHash: "abc123",
    });
  });

  describe("loadComponentFromCode", () => {
    it("analyzes source code during load", async () => {
      const sourceCode = `
        import { Sequence } from "remotion";

        export const TestComponent = () => (
          <div>
            <Sequence durationInFrames={60} name="Scene1">
              <Content1 />
            </Sequence>
            <Sequence durationInFrames={90} name="Scene2">
              <Content2 />
            </Sequence>
          </div>
        );
      `;

      const result = await loadComponentFromCode(sourceCode, "TestComponent.tsx", {
        storeInDB: false,
      });

      expect(mockAnalyzeComponent).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("attaches sequenceStructure to definition when sequences found", async () => {
      const result = await loadComponentFromCode("source", "Test.tsx", {
        storeInDB: false,
      });

      expect(result.success).toBe(true);
      expect(result.component?.sequenceStructure).toBeDefined();
      expect(result.component?.sequenceStructure?.sequences).toHaveLength(2);
      expect(result.component?.sequenceStructure?.sequences[0].name).toBe("Scene1");
    });

    it("returns analysisResult in load result", async () => {
      const result = await loadComponentFromCode("source", "Test.tsx", {
        storeInDB: false,
      });

      expect(result.analysisResult).toBeDefined();
      expect(result.analysisResult?.parsed.sequences).toHaveLength(2);
    });

    it("handles components without sequences", async () => {
      mockAnalyzeComponent.mockResolvedValueOnce({
        componentId: "no-seq",
        parsed: {
          sequences: [],
          transitions: [],
          usesTransitionSeries: false,
          errors: [],
        },
        structure: null,
        hasDynamicValues: false,
        analyzedAt: Date.now(),
        sourceHash: "empty",
      });

      const result = await loadComponentFromCode("source", "NoSeq.tsx", {
        storeInDB: false,
      });

      expect(result.success).toBe(true);
      expect(result.component?.sequenceStructure).toBeUndefined();
      expect(result.analysisResult?.structure).toBeNull();
    });

    it("handles parsing errors gracefully", async () => {
      mockAnalyzeComponent.mockRejectedValueOnce(new Error("Parse error"));

      const result = await loadComponentFromCode("invalid source", "Bad.tsx", {
        storeInDB: false,
      });

      // Component should still load successfully even if analysis fails
      expect(result.success).toBe(true);
      expect(result.analysisResult).toBeUndefined();
    });
  });
});

describe("LoadResult interface", () => {
  it("includes analysisResult field", () => {
    const result: LoadResult = {
      success: true,
      component: undefined,
      analysisResult: {
        componentId: "test",
        parsed: {
          sequences: [],
          transitions: [],
          usesTransitionSeries: false,
          errors: [],
        },
        structure: null,
        hasDynamicValues: false,
        analyzedAt: Date.now(),
        sourceHash: "hash",
      },
    };

    expect(result.analysisResult).toBeDefined();
  });
});
