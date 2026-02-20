/**
 * Tests for Sequence Analysis Service
 *
 * @module lib/remotion/__tests__/sequence-analysis-service.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
	SequenceAnalysisService,
	getSequenceAnalysisService,
	resetSequenceAnalysisService,
} from "../sequence-analysis-service";

describe("SequenceAnalysisService", () => {
	let service: SequenceAnalysisService;

	beforeEach(() => {
		service = new SequenceAnalysisService();
	});

	describe("analyzeComponent", () => {
		it("analyzes source code and returns result", async () => {
			const source = `
        <Sequence durationInFrames={60} name="Test">
          <Content />
        </Sequence>
      `;

			const result = await service.analyzeComponent("test-comp", source);

			expect(result.componentId).toBe("test-comp");
			expect(result.parsed.sequences).toHaveLength(1);
			expect(result.structure).not.toBeNull();
			expect(result.analyzedAt).toBeGreaterThan(0);
		});

		it("returns structure with sequences", async () => {
			const source = `
        import { Sequence } from "remotion";

        export const Comp = () => (
          <div>
            <Sequence durationInFrames={60} name="Intro">
              <Content1 />
            </Sequence>
            <Sequence durationInFrames={90} name="Main">
              <Content2 />
            </Sequence>
          </div>
        );
      `;

			const result = await service.analyzeComponent("multi-seq", source);

			expect(result.structure?.sequences).toHaveLength(2);
			expect(result.structure?.sequences[0].name).toBe("Intro");
			expect(result.structure?.sequences[1].name).toBe("Main");
		});

		it("detects dynamic values", async () => {
			const source = `
        <Sequence durationInFrames={DURATION} name="Dynamic" />
      `;

			const result = await service.analyzeComponent("dynamic", source);

			expect(result.hasDynamicValues).toBe(true);
		});
	});

	describe("caching", () => {
		it("caches analysis results by componentId", async () => {
			const source = "<Sequence durationInFrames={60} />";

			const result1 = await service.analyzeComponent("cached", source);
			const result2 = await service.analyzeComponent("cached", source);

			// Should be the exact same object (cached)
			expect(result1).toBe(result2);
		});

		it("returns cached result on subsequent calls", async () => {
			const source = `<Sequence durationInFrames={60} name="Cached" />`;

			await service.analyzeComponent("to-cache", source);

			const cached = service.getCached("to-cache");

			expect(cached).toBeDefined();
			expect(cached?.componentId).toBe("to-cache");
		});

		it("invalidates cache on request", async () => {
			const source = "<Sequence durationInFrames={60} />";

			await service.analyzeComponent("to-invalidate", source);
			expect(service.hasAnalysis("to-invalidate")).toBe(true);

			service.invalidateCache("to-invalidate");
			expect(service.hasAnalysis("to-invalidate")).toBe(false);
		});

		it("re-analyzes when source changes", async () => {
			const source1 = `<Sequence durationInFrames={60} name="V1" />`;
			const source2 = `<Sequence durationInFrames={90} name="V2" />`;

			const result1 = await service.analyzeComponent("changing", source1);
			const result2 = await service.analyzeComponent("changing", source2);

			// Should be different results since source changed
			expect(result1.sourceHash).not.toBe(result2.sourceHash);
			expect(result1.structure?.sequences[0].name).toBe("V1");
			expect(result2.structure?.sequences[0].name).toBe("V2");
		});
	});

	describe("cache management", () => {
		it("provides cache statistics", async () => {
			await service.analyzeComponent(
				"comp-1",
				"<Sequence durationInFrames={30} />"
			);
			await service.analyzeComponent(
				"comp-2",
				"<Sequence durationInFrames={60} />"
			);

			const stats = service.getCacheStats();

			expect(stats.size).toBe(2);
			expect(stats.componentIds).toContain("comp-1");
			expect(stats.componentIds).toContain("comp-2");
		});

		it("clears cache when requested", async () => {
			await service.analyzeComponent(
				"to-clear-1",
				"<Sequence durationInFrames={30} />"
			);
			await service.analyzeComponent(
				"to-clear-2",
				"<Sequence durationInFrames={60} />"
			);

			service.clearCache();

			expect(service.getCacheStats().size).toBe(0);
		});

		it("evicts oldest entries when at capacity", async () => {
			const smallService = new SequenceAnalysisService({ maxCacheSize: 2 });

			await smallService.analyzeComponent(
				"first",
				"<Sequence durationInFrames={30} />"
			);
			await smallService.analyzeComponent(
				"second",
				"<Sequence durationInFrames={60} />"
			);
			await smallService.analyzeComponent(
				"third",
				"<Sequence durationInFrames={90} />"
			);

			const stats = smallService.getCacheStats();

			expect(stats.size).toBe(2);
			expect(smallService.hasAnalysis("first")).toBe(false);
			expect(smallService.hasAnalysis("second")).toBe(true);
			expect(smallService.hasAnalysis("third")).toBe(true);
		});
	});

	describe("error handling", () => {
		it("handles empty source code", async () => {
			const result = await service.analyzeComponent("empty", "");

			expect(result.parsed.sequences).toHaveLength(0);
			expect(result.structure).toBeNull();
		});

		it("handles malformed JSX", async () => {
			const source = "<Sequence durationInFrames={60";

			const result = await service.analyzeComponent("malformed", source);

			// Should not throw, may have errors in result
			expect(result).toBeDefined();
		});

		it("handles source without sequences", async () => {
			const source = `
        export const Simple = () => <div>Hello World</div>;
      `;

			const result = await service.analyzeComponent("no-seq", source);

			expect(result.parsed.sequences).toHaveLength(0);
			expect(result.structure).toBeNull();
			expect(result.hasDynamicValues).toBe(false);
		});
	});

	describe("hasAnalysis", () => {
		it("returns true for analyzed components", async () => {
			await service.analyzeComponent(
				"check-has",
				"<Sequence durationInFrames={60} />"
			);

			expect(service.hasAnalysis("check-has")).toBe(true);
		});

		it("returns false for unknown components", () => {
			expect(service.hasAnalysis("unknown")).toBe(false);
		});
	});
});

describe("Singleton instance", () => {
	beforeEach(() => {
		resetSequenceAnalysisService();
	});

	it("returns same instance on multiple calls", () => {
		const service1 = getSequenceAnalysisService();
		const service2 = getSequenceAnalysisService();

		expect(service1).toBe(service2);
	});

	it("resets properly", async () => {
		const service1 = getSequenceAnalysisService();
		await service1.analyzeComponent(
			"singleton-test",
			"<Sequence durationInFrames={60} />"
		);

		resetSequenceAnalysisService();

		const service2 = getSequenceAnalysisService();
		expect(service2.hasAnalysis("singleton-test")).toBe(false);
	});
});
