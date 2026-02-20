import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

interface ManifestPlatformEntry {
	filename: string;
	size?: number;
	sha256?: string;
	downloadUrl?: string;
}

interface ManifestBinaryEntry {
	version: string;
	minQCutVersion: string;
	platforms: Record<string, ManifestPlatformEntry>;
}

interface BinaryManifest {
	binaries: Record<string, ManifestBinaryEntry>;
}

function loadJsonFile<T>({ filePath }: { filePath: string }): T {
	try {
		const content = readFileSync(filePath, "utf8");
		return JSON.parse(content) as T;
	} catch (error: unknown) {
		throw new Error(
			`Failed to load JSON file at ${filePath}: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}
}

describe("binary manifest schema contract", () => {
	// Resolve from test file location (electron/__tests__/) up to repo root
	const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
	const schemaPath = join(repoRoot, "resources", "bin", "manifest.schema.json");
	const manifestPath = join(repoRoot, "resources", "bin", "manifest.json");

	it("includes per-platform sha256 in PlatformEntry schema", () => {
		const schema = loadJsonFile<Record<string, unknown>>({
			filePath: schemaPath,
		});
		const definitions = (schema.definitions || {}) as Record<string, unknown>;
		const platformEntry = (definitions.PlatformEntry || {}) as Record<
			string,
			unknown
		>;
		const properties = (platformEntry.properties || {}) as Record<
			string,
			unknown
		>;

		expect(properties.sha256).toBeDefined();
		const sha256Definition = properties.sha256 as Record<string, unknown>;
		expect(sha256Definition.type).toBe("string");
		expect(sha256Definition.pattern).toBe("^[a-f0-9]{64}$");
	});

	it("aicp manifest platform entries use expected structure", () => {
		const manifest = loadJsonFile<BinaryManifest>({ filePath: manifestPath });
		const aicpEntry = manifest.binaries.aicp;

		expect(aicpEntry).toBeDefined();
		expect(aicpEntry.platforms).toBeDefined();

		const expectedTargets = [
			"darwin-arm64",
			"darwin-x64",
			"win32-x64",
			"linux-x64",
		];

		for (const target of expectedTargets) {
			const platformEntry = aicpEntry.platforms[target];
			expect(platformEntry).toBeDefined();
			expect(typeof platformEntry.filename).toBe("string");

			if (platformEntry.size !== undefined) {
				expect(typeof platformEntry.size).toBe("number");
				expect(platformEntry.size).toBeGreaterThanOrEqual(0);
			}

			if (platformEntry.sha256 !== undefined) {
				expect(platformEntry.sha256).toMatch(/^[a-f0-9]{64}$/);
			}

			if (platformEntry.downloadUrl !== undefined) {
				expect(platformEntry.downloadUrl).toMatch(/^https?:\/\//);
			}
		}
	});
});
