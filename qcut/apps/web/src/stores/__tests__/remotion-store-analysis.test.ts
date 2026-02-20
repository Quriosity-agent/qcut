/**
 * Tests for Remotion Store - Sequence Analysis Integration
 *
 * @module stores/__tests__/remotion-store-analysis.test
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRemotionStore, useComponentAnalysis } from "../remotion-store";
import type { AnalysisResult } from "@/lib/remotion/sequence-analysis-service";

// Mock the analysis service
vi.mock("@/lib/remotion/sequence-analysis-service", () => ({
	getSequenceAnalysisService: () => ({
		analyzeComponent: vi.fn().mockResolvedValue({
			componentId: "test-component",
			parsed: {
				sequences: [
					{
						name: "Intro",
						from: 0,
						durationInFrames: 60,
						line: 1,
						isTransitionSequence: false,
					},
				],
				transitions: [],
				usesTransitionSeries: false,
				errors: [],
			},
			structure: {
				sequences: [{ name: "Intro", from: 0, durationInFrames: 60 }],
			},
			hasDynamicValues: false,
			analyzedAt: Date.now(),
			sourceHash: "abc123",
		}),
		invalidateCache: vi.fn(),
	}),
}));

describe("RemotionStore - Sequence Analysis", () => {
	beforeEach(() => {
		// Reset store state before each test
		const store = useRemotionStore.getState();
		store.reset();
	});

	describe("setAnalysisResult", () => {
		it("stores analysis result by componentId", () => {
			const mockResult: AnalysisResult = {
				componentId: "test-comp",
				parsed: {
					sequences: [],
					transitions: [],
					usesTransitionSeries: false,
					errors: [],
				},
				structure: null,
				hasDynamicValues: false,
				analyzedAt: Date.now(),
				sourceHash: "hash123",
			};

			useRemotionStore.getState().setAnalysisResult("test-comp", mockResult);

			// Re-get state after update
			expect(
				useRemotionStore.getState().analyzedSequences.get("test-comp")
			).toEqual(mockResult);
		});

		it("overwrites existing result for same componentId", () => {
			const result1: AnalysisResult = {
				componentId: "test-comp",
				parsed: {
					sequences: [],
					transitions: [],
					usesTransitionSeries: false,
					errors: [],
				},
				structure: null,
				hasDynamicValues: false,
				analyzedAt: 1000,
				sourceHash: "hash1",
			};
			const result2: AnalysisResult = {
				componentId: "test-comp",
				parsed: {
					sequences: [],
					transitions: [],
					usesTransitionSeries: false,
					errors: [],
				},
				structure: null,
				hasDynamicValues: true,
				analyzedAt: 2000,
				sourceHash: "hash2",
			};

			useRemotionStore.getState().setAnalysisResult("test-comp", result1);
			useRemotionStore.getState().setAnalysisResult("test-comp", result2);

			// Re-get the state after the update
			const updatedState = useRemotionStore.getState();
			expect(updatedState.analyzedSequences.get("test-comp")?.sourceHash).toBe(
				"hash2"
			);
			expect(
				updatedState.analyzedSequences.get("test-comp")?.hasDynamicValues
			).toBe(true);
		});
	});

	describe("getAnalysisResult", () => {
		it("returns stored result", () => {
			const store = useRemotionStore.getState();
			const mockResult: AnalysisResult = {
				componentId: "get-test",
				parsed: {
					sequences: [],
					transitions: [],
					usesTransitionSeries: false,
					errors: [],
				},
				structure: null,
				hasDynamicValues: false,
				analyzedAt: Date.now(),
				sourceHash: "gethash",
			};

			store.setAnalysisResult("get-test", mockResult);
			const retrieved = store.getAnalysisResult("get-test");

			expect(retrieved).toEqual(mockResult);
		});

		it("returns undefined for unknown componentId", () => {
			const store = useRemotionStore.getState();
			const result = store.getAnalysisResult("unknown-comp");

			expect(result).toBeUndefined();
		});
	});

	describe("clearAnalysisResult", () => {
		it("removes analysis for componentId", () => {
			const mockResult: AnalysisResult = {
				componentId: "clear-test",
				parsed: {
					sequences: [],
					transitions: [],
					usesTransitionSeries: false,
					errors: [],
				},
				structure: null,
				hasDynamicValues: false,
				analyzedAt: Date.now(),
				sourceHash: "clearhash",
			};

			useRemotionStore.getState().setAnalysisResult("clear-test", mockResult);
			expect(
				useRemotionStore.getState().analyzedSequences.has("clear-test")
			).toBe(true);

			useRemotionStore.getState().clearAnalysisResult("clear-test");
			expect(
				useRemotionStore.getState().analyzedSequences.has("clear-test")
			).toBe(false);
		});

		it("does nothing for unknown componentId", () => {
			const initialSize = useRemotionStore.getState().analyzedSequences.size;

			useRemotionStore.getState().clearAnalysisResult("nonexistent");

			expect(useRemotionStore.getState().analyzedSequences.size).toBe(
				initialSize
			);
		});
	});

	describe("analyzeComponentSource", () => {
		it("analyzes source and stores result", async () => {
			const sourceCode = `<Sequence durationInFrames={60} name="Test"><Content /></Sequence>`;

			const result = await useRemotionStore
				.getState()
				.analyzeComponentSource("analyze-test", sourceCode);

			expect(result.componentId).toBe("test-component");
			expect(
				useRemotionStore.getState().analyzedSequences.has("analyze-test")
			).toBe(true);
		});

		it("returns the analysis result", async () => {
			const result = await useRemotionStore
				.getState()
				.analyzeComponentSource("result-test", "source");

			expect(result).toBeDefined();
			expect(result.parsed).toBeDefined();
		});
	});

	describe("useComponentAnalysis hook", () => {
		it("returns analysis result for valid componentId", () => {
			const store = useRemotionStore.getState();
			const mockResult: AnalysisResult = {
				componentId: "hook-test",
				parsed: {
					sequences: [],
					transitions: [],
					usesTransitionSeries: false,
					errors: [],
				},
				structure: null,
				hasDynamicValues: false,
				analyzedAt: Date.now(),
				sourceHash: "hookhash",
			};
			store.setAnalysisResult("hook-test", mockResult);

			const { result } = renderHook(() => useComponentAnalysis("hook-test"));

			expect(result.current).toEqual(mockResult);
		});

		it("returns undefined for undefined componentId", () => {
			const { result } = renderHook(() => useComponentAnalysis(undefined));

			expect(result.current).toBeUndefined();
		});

		it("updates when analysis changes", () => {
			const store = useRemotionStore.getState();

			const { result, rerender } = renderHook(() =>
				useComponentAnalysis("reactive-test")
			);

			expect(result.current).toBeUndefined();

			const mockResult: AnalysisResult = {
				componentId: "reactive-test",
				parsed: {
					sequences: [],
					transitions: [],
					usesTransitionSeries: false,
					errors: [],
				},
				structure: null,
				hasDynamicValues: true,
				analyzedAt: Date.now(),
				sourceHash: "reactivehash",
			};

			act(() => {
				store.setAnalysisResult("reactive-test", mockResult);
			});

			rerender();

			expect(result.current?.hasDynamicValues).toBe(true);
		});
	});

	describe("reset", () => {
		it("clears analyzedSequences on reset", () => {
			const store = useRemotionStore.getState();
			const mockResult: AnalysisResult = {
				componentId: "reset-test",
				parsed: {
					sequences: [],
					transitions: [],
					usesTransitionSeries: false,
					errors: [],
				},
				structure: null,
				hasDynamicValues: false,
				analyzedAt: Date.now(),
				sourceHash: "resethash",
			};

			store.setAnalysisResult("reset-test", mockResult);

			// Verify the result was stored
			const storedResult = useRemotionStore
				.getState()
				.analyzedSequences.get("reset-test");
			expect(storedResult).toBeDefined();

			store.reset();

			// After reset, the map should be empty
			const afterReset = useRemotionStore.getState().analyzedSequences;
			expect(afterReset.size).toBe(0);
		});
	});
});
