// @vitest-environment node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { E2E_SMOKE_SPECS } from "../../apps/web/src/test/e2e/smoke-specs";

const E2E_DIRECTORY = join(__dirname, "../../apps/web/src/test/e2e");

describe("E2E smoke set", () => {
	it("lists existing, unique Playwright specs", () => {
		expect(new Set(E2E_SMOKE_SPECS).size).toBe(E2E_SMOKE_SPECS.length);
		for (const spec of E2E_SMOKE_SPECS) {
			expect(spec).toMatch(/\.e2e\.ts$/);
			expect(existsSync(join(E2E_DIRECTORY, spec)), spec).toBe(true);
		}
	});
});
