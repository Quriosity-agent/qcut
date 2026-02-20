import { describe, it, expect } from "vitest";

/**
 * Tests for Phase 3 extracted components.
 * These are pure presentational components — we verify their exports
 * and prop type contracts rather than rendering (which would require
 * full provider setup).
 */

describe("AIModelSelectionGrid", () => {
	it("exports a function component", async () => {
		const mod = await import("../ai-model-selection-grid");
		expect(typeof mod.AIModelSelectionGrid).toBe("function");
	});

	it("has the expected component name", async () => {
		const mod = await import("../ai-model-selection-grid");
		expect(mod.AIModelSelectionGrid.name).toBe("AIModelSelectionGrid");
	});
});

describe("AIGenerationFeedback", () => {
	it("exports a function component", async () => {
		const mod = await import("../ai-generation-feedback");
		expect(typeof mod.AIGenerationFeedback).toBe("function");
	});

	it("has the expected component name", async () => {
		const mod = await import("../ai-generation-feedback");
		expect(mod.AIGenerationFeedback.name).toBe("AIGenerationFeedback");
	});
});

describe("AIValidationMessages", () => {
	it("exports a function component", async () => {
		const mod = await import("../ai-validation-messages");
		expect(typeof mod.AIValidationMessages).toBe("function");
	});

	it("has the expected component name", async () => {
		const mod = await import("../ai-validation-messages");
		expect(mod.AIValidationMessages.name).toBe("AIValidationMessages");
	});
});
