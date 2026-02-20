/**
 * Component Loader Tests
 *
 * Tests for loading and managing custom Remotion components from external files.
 *
 * @module lib/remotion/__tests__/component-loader.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	loadComponentFromCode,
	loadComponentFromFile,
	DEFAULT_LOAD_OPTIONS,
	type LoadResult,
} from "../component-loader";

// ============================================================================
// Test Fixtures
// ============================================================================

const VALID_COMPONENT_CODE = `
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { z } from "zod";

export const TestComponentSchema = z.object({
  text: z.string().default("Hello"),
  color: z.string().default("#ffffff"),
});

export type TestComponentProps = z.infer<typeof TestComponentSchema>;

export const TestComponentDefaultProps: TestComponentProps = {
  text: "Hello",
  color: "#ffffff",
};

export const TestComponentDefinition = {
  name: "TestComponent",
  description: "A test component for testing",
  category: "animation",
  durationInFrames: 90,
  fps: 30,
  width: 1920,
  height: 1080,
  tags: ["test", "demo"],
  version: "1.0.0",
  author: "Test Author",
};

export function TestComponent({ text, color }: TestComponentProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity }}>
      <div style={{ color }}>{text}</div>
    </AbsoluteFill>
  );
}

export default TestComponent;
`;

const INVALID_COMPONENT_CODE = `
import React from "react";
import { AbsoluteFill } from "remotion";

export function InvalidComponent() {
  // Uses forbidden APIs
  eval("console.log('hacked')");
  fetch("https://evil.com");
  return <AbsoluteFill>Invalid</AbsoluteFill>;
}
`;

const MINIMAL_COMPONENT_CODE = `
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { z } from "zod";

export const MinimalSchema = z.object({});
export const MinimalDefaultProps = {};

export function MinimalComponent() {
  const frame = useCurrentFrame();
  return <AbsoluteFill>Frame: {frame}</AbsoluteFill>;
}
`;

/**
 * Create a mock File object
 */
function createMockFile(content: string, name: string): File {
	const blob = new Blob([content], { type: "text/typescript" });
	return new File([blob], name, { type: "text/typescript" });
}

// ============================================================================
// Setup and Teardown
// ============================================================================

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.clearAllMocks();
});

// ============================================================================
// loadComponentFromCode Tests
// ============================================================================

describe("loadComponentFromCode", () => {
	describe("Valid Components", () => {
		it("should successfully load a valid component", async () => {
			const result = await loadComponentFromCode(
				VALID_COMPONENT_CODE,
				"test-component.tsx",
				{ storeInDB: false }
			);

			expect(result.success).toBe(true);
			expect(result.component).toBeDefined();
			expect(result.error).toBeUndefined();
		});

		it("should extract component name from code", async () => {
			const result = await loadComponentFromCode(
				VALID_COMPONENT_CODE,
				"test-component.tsx",
				{ storeInDB: false }
			);

			expect(result.component?.name).toBe("TestComponent");
		});

		it("should extract component description", async () => {
			const result = await loadComponentFromCode(
				VALID_COMPONENT_CODE,
				"test-component.tsx",
				{ storeInDB: false }
			);

			expect(result.component?.description).toBe(
				"A test component for testing"
			);
		});

		it("should extract component category", async () => {
			const result = await loadComponentFromCode(
				VALID_COMPONENT_CODE,
				"test-component.tsx",
				{ storeInDB: false }
			);

			expect(result.component?.category).toBe("animation");
		});

		it("should extract component dimensions", async () => {
			const result = await loadComponentFromCode(
				VALID_COMPONENT_CODE,
				"test-component.tsx",
				{ storeInDB: false }
			);

			expect(result.component?.width).toBe(1920);
			expect(result.component?.height).toBe(1080);
		});

		it("should extract component timing", async () => {
			const result = await loadComponentFromCode(
				VALID_COMPONENT_CODE,
				"test-component.tsx",
				{ storeInDB: false }
			);

			expect(result.component?.durationInFrames).toBe(90);
			expect(result.component?.fps).toBe(30);
		});

		it("should extract tags", async () => {
			const result = await loadComponentFromCode(
				VALID_COMPONENT_CODE,
				"test-component.tsx",
				{ storeInDB: false }
			);

			expect(result.component?.tags).toEqual(["test", "demo"]);
		});

		it("should extract version and author", async () => {
			const result = await loadComponentFromCode(
				VALID_COMPONENT_CODE,
				"test-component.tsx",
				{ storeInDB: false }
			);

			expect(result.component?.version).toBe("1.0.0");
			expect(result.component?.author).toBe("Test Author");
		});

		it("should set source as imported", async () => {
			const result = await loadComponentFromCode(
				VALID_COMPONENT_CODE,
				"test-component.tsx",
				{ storeInDB: false }
			);

			expect(result.component?.source).toBe("imported");
		});

		it("should generate a unique component ID", async () => {
			const result = await loadComponentFromCode(
				VALID_COMPONENT_CODE,
				"test-component.tsx",
				{ storeInDB: false }
			);

			expect(result.component?.id).toMatch(/^imported-test-component-/);
		});

		it("should use custom ID when provided", async () => {
			const result = await loadComponentFromCode(
				VALID_COMPONENT_CODE,
				"test-component.tsx",
				{ storeInDB: false, customId: "my-custom-id" }
			);

			expect(result.component?.id).toBe("my-custom-id");
		});

		it("should include validation result", async () => {
			const result = await loadComponentFromCode(
				VALID_COMPONENT_CODE,
				"test-component.tsx",
				{ storeInDB: false }
			);

			expect(result.validation).toBeDefined();
			expect(result.validation?.valid).toBe(true);
		});
	});

	describe("Invalid Components", () => {
		it("should reject components with forbidden APIs", async () => {
			const result = await loadComponentFromCode(
				INVALID_COMPONENT_CODE,
				"invalid.tsx",
				{ storeInDB: false }
			);

			expect(result.success).toBe(false);
			expect(result.component).toBeUndefined();
			expect(result.error).toBeDefined();
		});

		it("should include validation errors", async () => {
			const result = await loadComponentFromCode(
				INVALID_COMPONENT_CODE,
				"invalid.tsx",
				{ storeInDB: false }
			);

			expect(result.validation).toBeDefined();
			expect(result.validation?.valid).toBe(false);
			expect(result.validation?.errors.length).toBeGreaterThan(0);
		});

		it("should reject code with eval", async () => {
			const codeWithEval = `
        import React from "react";
        import { AbsoluteFill, useCurrentFrame } from "remotion";
        import { z } from "zod";

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          const frame = useCurrentFrame();
          eval("console.log('bad')");
          return <AbsoluteFill>{frame}</AbsoluteFill>;
        }
      `;

			const result = await loadComponentFromCode(codeWithEval, "test.tsx", {
				storeInDB: false,
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain("eval()");
		});

		it("should reject code with fetch", async () => {
			const codeWithFetch = `
        import React from "react";
        import { AbsoluteFill, useCurrentFrame } from "remotion";
        import { z } from "zod";

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          const frame = useCurrentFrame();
          fetch("https://example.com");
          return <AbsoluteFill>{frame}</AbsoluteFill>;
        }
      `;

			const result = await loadComponentFromCode(codeWithFetch, "test.tsx", {
				storeInDB: false,
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain("Network fetch");
		});
	});

	describe("Minimal Components", () => {
		it("should provide default values for missing metadata", async () => {
			const result = await loadComponentFromCode(
				MINIMAL_COMPONENT_CODE,
				"minimal.tsx",
				{ storeInDB: false }
			);

			expect(result.success).toBe(true);
			expect(result.component?.name).toBe("Unknown Component");
			expect(result.component?.category).toBe("animation");
			expect(result.component?.durationInFrames).toBe(90);
			expect(result.component?.fps).toBe(30);
			expect(result.component?.width).toBe(1920);
			expect(result.component?.height).toBe(1080);
		});
	});
});

// ============================================================================
// loadComponentFromFile Tests
// ============================================================================

describe("loadComponentFromFile", () => {
	it("should reject non-TypeScript files", async () => {
		const file = createMockFile(VALID_COMPONENT_CODE, "component.js");
		const result = await loadComponentFromFile(file, { storeInDB: false });

		expect(result.success).toBe(false);
		expect(result.error).toBe("Only .tsx and .ts files are supported");
	});

	it("should reject .jsx files", async () => {
		const file = createMockFile(VALID_COMPONENT_CODE, "component.jsx");
		const result = await loadComponentFromFile(file, { storeInDB: false });

		expect(result.success).toBe(false);
		expect(result.error).toBe("Only .tsx and .ts files are supported");
	});

	it("should reject .txt files", async () => {
		const file = createMockFile("some text", "component.txt");
		const result = await loadComponentFromFile(file, { storeInDB: false });

		expect(result.success).toBe(false);
		expect(result.error).toBe("Only .tsx and .ts files are supported");
	});
});

// ============================================================================
// DEFAULT_LOAD_OPTIONS Tests
// ============================================================================

describe("DEFAULT_LOAD_OPTIONS", () => {
	it("should have expected default values", () => {
		expect(DEFAULT_LOAD_OPTIONS.sandbox).toBe(true);
		expect(DEFAULT_LOAD_OPTIONS.generateThumbnail).toBe(false);
		expect(DEFAULT_LOAD_OPTIONS.storeInDB).toBe(true);
	});
});

// ============================================================================
// Component ID Generation Tests
// ============================================================================

describe("Component ID Generation", () => {
	it("should sanitize file names with special characters", async () => {
		const result = await loadComponentFromCode(
			VALID_COMPONENT_CODE,
			"My Component (v2).tsx",
			{
				storeInDB: false,
			}
		);

		expect(result.component?.id).toMatch(/^imported-my-component--v2--/);
	});

	it("should lowercase the file name", async () => {
		const result = await loadComponentFromCode(
			VALID_COMPONENT_CODE,
			"MyComponent.tsx",
			{
				storeInDB: false,
			}
		);

		expect(result.component?.id).toMatch(/^imported-mycomponent-/);
	});

	it("should generate unique IDs for different timestamps", async () => {
		const result1 = await loadComponentFromCode(
			VALID_COMPONENT_CODE,
			"component.tsx",
			{
				storeInDB: false,
			}
		);
		// Add a small delay to ensure different timestamps
		await new Promise((resolve) => setTimeout(resolve, 10));
		const result2 = await loadComponentFromCode(
			VALID_COMPONENT_CODE,
			"component.tsx",
			{
				storeInDB: false,
			}
		);

		expect(result1.component?.id).not.toBe(result2.component?.id);
	});
});

// ============================================================================
// Component Definition Tests
// ============================================================================

describe("Component Definition", () => {
	it("should create a valid RemotionComponentDefinition", async () => {
		const result = await loadComponentFromCode(
			VALID_COMPONENT_CODE,
			"test.tsx",
			{ storeInDB: false }
		);

		expect(result.component).toMatchObject({
			id: expect.any(String),
			name: "TestComponent",
			description: "A test component for testing",
			category: "animation",
			durationInFrames: 90,
			fps: 30,
			width: 1920,
			height: 1080,
			source: "imported",
		});
	});

	it("should include a placeholder schema", async () => {
		const result = await loadComponentFromCode(
			VALID_COMPONENT_CODE,
			"test.tsx",
			{ storeInDB: false }
		);

		expect(result.component?.schema).toBeDefined();
		expect(typeof result.component?.schema.safeParse).toBe("function");
	});

	it("should include default props", async () => {
		const result = await loadComponentFromCode(
			VALID_COMPONENT_CODE,
			"test.tsx",
			{ storeInDB: false }
		);

		expect(result.component?.defaultProps).toBeDefined();
	});

	it("should include a placeholder component function", async () => {
		const result = await loadComponentFromCode(
			VALID_COMPONENT_CODE,
			"test.tsx",
			{ storeInDB: false }
		);

		expect(result.component?.component).toBeDefined();
		expect(typeof result.component?.component).toBe("function");
	});
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe("Error Handling", () => {
	it("should handle file read errors gracefully", async () => {
		// Create a file that will fail to read
		const file = {
			name: "test.tsx",
			text: () => Promise.reject(new Error("Read error")),
		} as unknown as File;

		const result = await loadComponentFromFile(file, { storeInDB: false });

		expect(result.success).toBe(false);
		expect(result.error).toContain("Failed to read file");
	});

	it("should include original error message", async () => {
		const file = {
			name: "test.tsx",
			text: () => Promise.reject(new Error("Disk full")),
		} as unknown as File;

		const result = await loadComponentFromFile(file, { storeInDB: false });

		expect(result.error).toContain("Disk full");
	});
});

// ============================================================================
// Options Tests
// ============================================================================

describe("Load Options", () => {
	it("should merge options with defaults", async () => {
		const result = await loadComponentFromCode(
			VALID_COMPONENT_CODE,
			"test.tsx",
			{ customId: "test-id", storeInDB: false }
		);

		expect(result.component?.id).toBe("test-id");
	});
});

// ============================================================================
// Validation Integration Tests
// ============================================================================

describe("Validation Integration", () => {
	it("should fail validation for components without React", async () => {
		const codeWithoutReact = `
      import { AbsoluteFill, useCurrentFrame } from "remotion";
      import { z } from "zod";

      export const Schema = z.object({});
      export const DefaultProps = {};

      export function Component() {
        const frame = useCurrentFrame();
        return <AbsoluteFill>{frame}</AbsoluteFill>;
      }
    `;

		const result = await loadComponentFromCode(codeWithoutReact, "test.tsx", {
			storeInDB: false,
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain("React");
	});
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("Edge Cases", () => {
	it("should handle empty file name", async () => {
		const result = await loadComponentFromCode(VALID_COMPONENT_CODE, "", {
			storeInDB: false,
		});

		expect(result.success).toBe(true);
		expect(result.component?.id).toMatch(/^imported--/);
	});

	it("should handle file name with only extension", async () => {
		const result = await loadComponentFromCode(VALID_COMPONENT_CODE, ".tsx", {
			storeInDB: false,
		});

		expect(result.success).toBe(true);
		expect(result.component?.id).toMatch(/^imported--/);
	});

	it("should handle very long file names", async () => {
		const longName = "a".repeat(200) + ".tsx";
		const result = await loadComponentFromCode(VALID_COMPONENT_CODE, longName, {
			storeInDB: false,
		});

		expect(result.success).toBe(true);
		expect(result.component?.id).toBeDefined();
	});

	it("should handle file names with unicode characters", async () => {
		const unicodeName = "组件-コンポーネント.tsx";
		const result = await loadComponentFromCode(
			VALID_COMPONENT_CODE,
			unicodeName,
			{
				storeInDB: false,
			}
		);

		expect(result.success).toBe(true);
		expect(result.component?.id).toMatch(/^imported-/);
	});
});
