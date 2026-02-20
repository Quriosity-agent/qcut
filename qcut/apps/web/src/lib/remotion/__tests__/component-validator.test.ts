/**
 * Component Validator Tests
 *
 * Tests for validating Remotion component code for security and correctness.
 *
 * @module lib/remotion/__tests__/component-validator.test
 */

import { describe, it, expect } from "vitest";
import {
	validateComponent,
	quickValidate,
	DEFAULT_VALIDATION_OPTIONS,
	type ValidationResult,
} from "../component-validator";

// ============================================================================
// Test Fixtures
// ============================================================================

const VALID_COMPONENT = `
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
  description: "A test component",
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

const MINIMAL_VALID_COMPONENT = `
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

// ============================================================================
// Forbidden Pattern Tests
// ============================================================================

describe("Component Validator - Forbidden Patterns", () => {
	describe("File System Access", () => {
		it("should reject code using fs module", () => {
			const code = `
        import React from "react";
        import { AbsoluteFill } from "remotion";
        import fs from "fs";

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          const content = fs.readFileSync("file.txt");
          return <AbsoluteFill>{content}</AbsoluteFill>;
        }
      `;

			const result = validateComponent(code);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("File system access (fs) is not allowed");
		});

		it("should reject code using require(fs)", () => {
			const code = `
        import React from "react";
        import { AbsoluteFill } from "remotion";
        const fs = require("fs");

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          return <AbsoluteFill>Test</AbsoluteFill>;
        }
      `;

			const result = validateComponent(code);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("File system access (fs) is not allowed");
		});

		it("should reject code using path module", () => {
			const code = `
        import React from "react";
        import { AbsoluteFill } from "remotion";
        import path from "path";

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          const dir = path.resolve(".");
          return <AbsoluteFill>{dir}</AbsoluteFill>;
        }
      `;

			const result = validateComponent(code);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Path module access is not allowed");
		});

		it("should reject code using child_process", () => {
			const code = `
        import React from "react";
        import { AbsoluteFill } from "remotion";
        import { exec } from "child_process";

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          exec("rm -rf /");
          return <AbsoluteFill>Test</AbsoluteFill>;
        }
      `;

			const result = validateComponent(code);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Child process access is not allowed");
		});
	});

	describe("Network Access", () => {
		it("should reject code using fetch", () => {
			const code = `
        import React from "react";
        import { AbsoluteFill } from "remotion";

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          fetch("https://example.com/data");
          return <AbsoluteFill>Test</AbsoluteFill>;
        }
      `;

			const result = validateComponent(code);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				"Network fetch is not allowed in components"
			);
		});

		it("should reject code using XMLHttpRequest", () => {
			const code = `
        import React from "react";
        import { AbsoluteFill } from "remotion";

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          const xhr = new XMLHttpRequest();
          return <AbsoluteFill>Test</AbsoluteFill>;
        }
      `;

			const result = validateComponent(code);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("XMLHttpRequest is not allowed");
		});

		it("should reject code using WebSocket", () => {
			const code = `
        import React from "react";
        import { AbsoluteFill } from "remotion";

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          const ws = new WebSocket("ws://example.com");
          return <AbsoluteFill>Test</AbsoluteFill>;
        }
      `;

			const result = validateComponent(code);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("WebSocket is not allowed");
		});

		it("should reject code using axios", () => {
			const code = `
        import React from "react";
        import { AbsoluteFill } from "remotion";
        import axios from "axios";

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          axios.get("https://example.com");
          return <AbsoluteFill>Test</AbsoluteFill>;
        }
      `;

			const result = validateComponent(code);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Axios HTTP client is not allowed");
		});

		it("should allow network access when option is enabled", () => {
			const code = `
        import React from "react";
        import { AbsoluteFill, useCurrentFrame } from "remotion";
        import { z } from "zod";

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          const frame = useCurrentFrame();
          // This would normally be forbidden
          // fetch("https://example.com");
          return <AbsoluteFill>Test {frame}</AbsoluteFill>;
        }
      `;

			const result = validateComponent(code, { allowNetwork: true });
			// Should still validate other things, but network is now allowed
			expect(result.errors).not.toContain(
				"Network fetch is not allowed in components"
			);
		});
	});

	describe("Dangerous Globals", () => {
		it("should reject code using eval", () => {
			const code = `
        import React from "react";
        import { AbsoluteFill } from "remotion";

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          eval("alert('hacked')");
          return <AbsoluteFill>Test</AbsoluteFill>;
        }
      `;

			const result = validateComponent(code);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("eval() is not allowed");
		});

		it("should reject code using Function constructor", () => {
			const code = `
        import React from "react";
        import { AbsoluteFill } from "remotion";

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          const fn = new Function("return 42");
          return <AbsoluteFill>{fn()}</AbsoluteFill>;
        }
      `;

			const result = validateComponent(code);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Function constructor is not allowed");
		});

		it("should reject code accessing process.env", () => {
			const code = `
        import React from "react";
        import { AbsoluteFill } from "remotion";

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          const secret = process.env.SECRET_KEY;
          return <AbsoluteFill>{secret}</AbsoluteFill>;
        }
      `;

			const result = validateComponent(code);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				"Environment variable access is not allowed"
			);
		});

		it("should reject code using global/globalThis", () => {
			const code = `
        import React from "react";
        import { AbsoluteFill } from "remotion";

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          globalThis.customValue = 42;
          return <AbsoluteFill>Test</AbsoluteFill>;
        }
      `;

			const result = validateComponent(code);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Global object access is not allowed");
		});
	});

	describe("DOM Manipulation", () => {
		it("should reject code using document.write", () => {
			const code = `
        import React from "react";
        import { AbsoluteFill } from "remotion";

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          document.write("<script>alert('xss')</script>");
          return <AbsoluteFill>Test</AbsoluteFill>;
        }
      `;

			const result = validateComponent(code);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("document.write is not allowed");
		});

		it("should warn about innerHTML assignment", () => {
			const code = `
        import React from "react";
        import { AbsoluteFill, useCurrentFrame } from "remotion";
        import { z } from "zod";

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          const frame = useCurrentFrame();
          const ref = React.useRef<HTMLDivElement>(null);
          if (ref.current) {
            ref.current.innerHTML = "<p>test</p>";
          }
          return <AbsoluteFill ref={ref}>Test {frame}</AbsoluteFill>;
        }
      `;

			const result = validateComponent(code);
			expect(result.warnings).toContain(
				"Direct innerHTML assignment is not recommended"
			);
		});
	});

	describe("Electron/Node Access", () => {
		it("should reject code requiring electron", () => {
			const code = `
        import React from "react";
        import { AbsoluteFill } from "remotion";
        const { ipcRenderer } = require("electron");

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          ipcRenderer.send("message");
          return <AbsoluteFill>Test</AbsoluteFill>;
        }
      `;

			const result = validateComponent(code);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Electron access is not allowed");
		});

		it("should reject code using window.electronAPI", () => {
			const code = `
        import React from "react";
        import { AbsoluteFill } from "remotion";

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          window.electronAPI.sendMessage("test");
          return <AbsoluteFill>Test</AbsoluteFill>;
        }
      `;

			const result = validateComponent(code);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Electron API access is not allowed");
		});
	});

	describe("Storage APIs", () => {
		it("should warn about localStorage usage", () => {
			const code = `
        import React from "react";
        import { AbsoluteFill, useCurrentFrame } from "remotion";
        import { z } from "zod";

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          const frame = useCurrentFrame();
          localStorage.setItem("key", "value");
          return <AbsoluteFill>Test {frame}</AbsoluteFill>;
        }
      `;

			const result = validateComponent(code);
			expect(result.warnings).toContain(
				"localStorage access is not allowed in components"
			);
		});

		it("should warn about sessionStorage usage", () => {
			const code = `
        import React from "react";
        import { AbsoluteFill, useCurrentFrame } from "remotion";
        import { z } from "zod";

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          const frame = useCurrentFrame();
          sessionStorage.setItem("key", "value");
          return <AbsoluteFill>Test {frame}</AbsoluteFill>;
        }
      `;

			const result = validateComponent(code);
			expect(result.warnings).toContain(
				"sessionStorage access is not allowed in components"
			);
		});

		it("should warn about indexedDB usage", () => {
			const code = `
        import React from "react";
        import { AbsoluteFill, useCurrentFrame } from "remotion";
        import { z } from "zod";

        export const Schema = z.object({});
        export const DefaultProps = {};

        export function Component() {
          const frame = useCurrentFrame();
          indexedDB.open("db");
          return <AbsoluteFill>Test {frame}</AbsoluteFill>;
        }
      `;

			const result = validateComponent(code);
			expect(result.warnings).toContain(
				"IndexedDB access is not allowed in components"
			);
		});
	});
});

// ============================================================================
// Dynamic Import Tests
// ============================================================================

describe("Component Validator - Dynamic Imports", () => {
	it("should reject dynamic import()", () => {
		const code = `
      import React from "react";
      import { AbsoluteFill } from "remotion";

      export const Schema = z.object({});
      export const DefaultProps = {};

      export async function Component() {
        const module = await import("./malicious-module");
        return <AbsoluteFill>Test</AbsoluteFill>;
      }
    `;

		const result = validateComponent(code);
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("Dynamic imports are not allowed");
	});

	it("should reject dynamic require with variables", () => {
		const code = `
      import React from "react";
      import { AbsoluteFill } from "remotion";

      export const Schema = z.object({});
      export const DefaultProps = {};

      export function Component() {
        const moduleName = "fs";
        const mod = require(moduleName);
        return <AbsoluteFill>Test</AbsoluteFill>;
      }
    `;

		const result = validateComponent(code);
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("Dynamic require is not allowed");
	});

	it("should allow dynamic imports when option is enabled", () => {
		const code = `
      import React from "react";
      import { AbsoluteFill, useCurrentFrame } from "remotion";
      import { z } from "zod";

      export const Schema = z.object({});
      export const DefaultProps = {};

      export function Component() {
        const frame = useCurrentFrame();
        return <AbsoluteFill>Test {frame}</AbsoluteFill>;
      }
    `;

		const result = validateComponent(code, { allowDynamicImports: true });
		expect(result.errors).not.toContain("Dynamic imports are not allowed");
	});
});

// ============================================================================
// React Pattern Tests
// ============================================================================

describe("Component Validator - React Patterns", () => {
	it("should require React import", () => {
		const code = `
      import { AbsoluteFill, useCurrentFrame } from "remotion";

      export const Schema = z.object({});
      export const DefaultProps = {};

      export function Component() {
        const frame = useCurrentFrame();
        return <AbsoluteFill>Test {frame}</AbsoluteFill>;
      }
    `;

		const result = validateComponent(code);
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("Component must import React");
	});

	it("should warn if not using Remotion hooks", () => {
		const code = `
      import React from "react";
      import { AbsoluteFill } from "remotion";
      import { z } from "zod";

      export const Schema = z.object({});
      export const DefaultProps = {};

      export function Component() {
        return <AbsoluteFill>Static content</AbsoluteFill>;
      }
    `;

		const result = validateComponent(code);
		expect(result.warnings).toContain(
			"Component does not use Remotion hooks (useCurrentFrame, useVideoConfig)"
		);
	});

	it("should require a component function", () => {
		const code = `
      import React from "react";
      import { AbsoluteFill, useCurrentFrame } from "remotion";
      import { z } from "zod";

      export const Schema = z.object({});
      export const DefaultProps = {};

      // No component function exported
      const someValue = 42;
    `;

		const result = validateComponent(code);
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("No React component function found");
	});
});

// ============================================================================
// Metadata Extraction Tests
// ============================================================================

describe("Component Validator - Metadata Extraction", () => {
	it("should extract component name from definition", () => {
		const result = validateComponent(VALID_COMPONENT);
		expect(result.valid).toBe(true);
		expect(result.metadata?.name).toBe("TestComponent");
	});

	it("should extract category", () => {
		const result = validateComponent(VALID_COMPONENT);
		expect(result.metadata?.category).toBe("animation");
	});

	it("should extract duration", () => {
		const result = validateComponent(VALID_COMPONENT);
		expect(result.metadata?.durationInFrames).toBe(90);
	});

	it("should extract fps", () => {
		const result = validateComponent(VALID_COMPONENT);
		expect(result.metadata?.fps).toBe(30);
	});

	it("should extract dimensions", () => {
		const result = validateComponent(VALID_COMPONENT);
		expect(result.metadata?.width).toBe(1920);
		expect(result.metadata?.height).toBe(1080);
	});

	it("should extract description", () => {
		const result = validateComponent(VALID_COMPONENT);
		expect(result.metadata?.description).toBe("A test component");
	});

	it("should extract tags", () => {
		const result = validateComponent(VALID_COMPONENT);
		expect(result.metadata?.tags).toEqual(["test", "demo"]);
	});

	it("should extract version", () => {
		const result = validateComponent(VALID_COMPONENT);
		expect(result.metadata?.version).toBe("1.0.0");
	});

	it("should extract author", () => {
		const result = validateComponent(VALID_COMPONENT);
		expect(result.metadata?.author).toBe("Test Author");
	});

	it("should detect schema export", () => {
		const result = validateComponent(VALID_COMPONENT);
		expect(result.metadata?.hasSchema).toBe(true);
	});

	it("should detect default props export", () => {
		const result = validateComponent(VALID_COMPONENT);
		expect(result.metadata?.hasDefaultProps).toBe(true);
	});

	it("should provide default values for missing metadata", () => {
		const result = validateComponent(MINIMAL_VALID_COMPONENT);
		expect(result.valid).toBe(true);
		expect(result.metadata?.name).toBe("Unknown Component");
		expect(result.metadata?.category).toBe("animation");
		expect(result.metadata?.durationInFrames).toBe(90);
		expect(result.metadata?.fps).toBe(30);
		expect(result.metadata?.width).toBe(1920);
		expect(result.metadata?.height).toBe(1080);
	});

	it("should warn about missing category", () => {
		const result = validateComponent(MINIMAL_VALID_COMPONENT);
		expect(result.warnings).toContain("Component category not detected");
	});

	it("should warn about missing duration", () => {
		const result = validateComponent(MINIMAL_VALID_COMPONENT);
		expect(result.warnings).toContain("Duration in frames not detected");
	});

	it("should warn about missing fps", () => {
		const result = validateComponent(MINIMAL_VALID_COMPONENT);
		expect(result.warnings).toContain(
			"FPS not detected, will use project default"
		);
	});
});

// ============================================================================
// Required Exports Tests
// ============================================================================

describe("Component Validator - Required Exports", () => {
	it("should require schema export when option is enabled", () => {
		const code = `
      import React from "react";
      import { AbsoluteFill, useCurrentFrame } from "remotion";

      export const DefaultProps = {};

      export function Component() {
        const frame = useCurrentFrame();
        return <AbsoluteFill>Test {frame}</AbsoluteFill>;
      }
    `;

		const result = validateComponent(code, { requireSchema: true });
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("Component must export a Zod schema");
	});

	it("should require default props export when option is enabled", () => {
		const code = `
      import React from "react";
      import { AbsoluteFill, useCurrentFrame } from "remotion";
      import { z } from "zod";

      export const Schema = z.object({});

      export function Component() {
        const frame = useCurrentFrame();
        return <AbsoluteFill>Test {frame}</AbsoluteFill>;
      }
    `;

		const result = validateComponent(code, { requireDefaultProps: true });
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("Component must export default props");
	});

	it("should not require schema when option is disabled", () => {
		const code = `
      import React from "react";
      import { AbsoluteFill, useCurrentFrame } from "remotion";

      export const DefaultProps = {};

      export function Component() {
        const frame = useCurrentFrame();
        return <AbsoluteFill>Test {frame}</AbsoluteFill>;
      }
    `;

		const result = validateComponent(code, {
			requireSchema: false,
			requireDefaultProps: false,
		});
		expect(result.errors).not.toContain("Component must export a Zod schema");
	});
});

// ============================================================================
// File Size Tests
// ============================================================================

describe("Component Validator - File Size", () => {
	it("should reject files exceeding size limit", () => {
		// Create a large string
		const largeCode = "a".repeat(600 * 1024); // 600KB

		const result = validateComponent(largeCode, {
			maxFileSizeBytes: 500 * 1024,
		});
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("File size"))).toBe(true);
	});

	it("should accept files within size limit", () => {
		const result = validateComponent(VALID_COMPONENT, {
			maxFileSizeBytes: 500 * 1024,
		});
		expect(result.errors.filter((e) => e.includes("File size"))).toHaveLength(
			0
		);
	});
});

// ============================================================================
// Remotion Import Tests
// ============================================================================

describe("Component Validator - Remotion Imports", () => {
	it("should warn if no Remotion imports found", () => {
		const code = `
      import React from "react";
      import { z } from "zod";

      export const Schema = z.object({});
      export const DefaultProps = {};

      export function Component() {
        return <div>Test</div>;
      }
    `;

		const result = validateComponent(code);
		expect(result.warnings).toContain(
			"Component does not import from Remotion packages"
		);
	});

	it("should not warn when importing from remotion", () => {
		const result = validateComponent(VALID_COMPONENT);
		expect(result.warnings).not.toContain(
			"Component does not import from Remotion packages"
		);
	});

	it("should accept imports from @remotion/player", () => {
		const code = `
      import React from "react";
      import { Player } from "@remotion/player";
      import { z } from "zod";

      export const Schema = z.object({});
      export const DefaultProps = {};

      export function Component() {
        return <div>Test</div>;
      }
    `;

		const result = validateComponent(code);
		expect(result.warnings).not.toContain(
			"Component does not import from Remotion packages"
		);
	});
});

// ============================================================================
// Quick Validate Tests
// ============================================================================

describe("quickValidate", () => {
	it("should reject empty code", () => {
		const result = quickValidate("");
		expect(result.valid).toBe(false);
		expect(result.error).toBe("Empty code");
	});

	it("should reject whitespace-only code", () => {
		const result = quickValidate("   \n  \t  ");
		expect(result.valid).toBe(false);
		expect(result.error).toBe("Empty code");
	});

	it("should reject files that are too large", () => {
		const largeCode = "a".repeat(1001 * 1024);
		const result = quickValidate(largeCode);
		expect(result.valid).toBe(false);
		expect(result.error).toBe("File too large");
	});

	it("should reject code with eval", () => {
		const code = `const x = eval("1+1");`;
		const result = quickValidate(code);
		expect(result.valid).toBe(false);
		expect(result.error).toBe("eval() is not allowed");
	});

	it("should reject code with child_process", () => {
		const code = `import { exec } from "child_process";`;
		const result = quickValidate(code);
		expect(result.valid).toBe(false);
		expect(result.error).toBe("child_process is not allowed");
	});

	it("should pass valid code", () => {
		const result = quickValidate(VALID_COMPONENT);
		expect(result.valid).toBe(true);
		expect(result.error).toBeUndefined();
	});
});

// ============================================================================
// Valid Component Tests
// ============================================================================

describe("Component Validator - Valid Components", () => {
	it("should validate a complete valid component", () => {
		const result = validateComponent(VALID_COMPONENT);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("should validate a minimal valid component", () => {
		const result = validateComponent(MINIMAL_VALID_COMPONENT);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("should return complete metadata for valid component", () => {
		const result = validateComponent(VALID_COMPONENT);
		expect(result.metadata).toBeDefined();
		expect(result.metadata?.name).toBe("TestComponent");
		expect(result.metadata?.category).toBe("animation");
		expect(result.metadata?.durationInFrames).toBe(90);
		expect(result.metadata?.fps).toBe(30);
		expect(result.metadata?.width).toBe(1920);
		expect(result.metadata?.height).toBe(1080);
		expect(result.metadata?.hasSchema).toBe(true);
		expect(result.metadata?.hasDefaultProps).toBe(true);
	});
});

// ============================================================================
// Default Options Tests
// ============================================================================

describe("DEFAULT_VALIDATION_OPTIONS", () => {
	it("should have expected default values", () => {
		expect(DEFAULT_VALIDATION_OPTIONS.allowNetwork).toBe(false);
		expect(DEFAULT_VALIDATION_OPTIONS.allowFileSystem).toBe(false);
		expect(DEFAULT_VALIDATION_OPTIONS.allowDynamicImports).toBe(false);
		expect(DEFAULT_VALIDATION_OPTIONS.maxFileSizeBytes).toBe(500 * 1024);
		expect(DEFAULT_VALIDATION_OPTIONS.requireSchema).toBe(true);
		expect(DEFAULT_VALIDATION_OPTIONS.requireDefaultProps).toBe(true);
	});
});
