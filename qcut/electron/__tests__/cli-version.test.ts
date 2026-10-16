import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	describeCliInstall,
	describeVersionMismatch,
	findCliPackage,
} from "../native-pipeline/cli/cli-version.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

function fakePackage({ version, depth }: { version: string; depth: string[] }) {
	const root = mkdtempSync(join(tmpdir(), "qcut-cli-version-"));
	dirs.push(root);
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({ name: "qcut", version })
	);
	const moduleDir = join(root, ...depth);
	mkdirSync(moduleDir, { recursive: true });
	return { root, moduleDir };
}

describe("cli version", () => {
	it("finds the qcut package above the compiled CLI in a checkout and in an app", () => {
		const checkout = fakePackage({
			version: "2026.10.1601",
			depth: ["dist", "electron", "native-pipeline", "cli"],
		});
		expect(findCliPackage({ startDir: checkout.moduleDir })).toEqual({
			dir: checkout.root,
			version: "2026.10.1601",
		});
		const asar = fakePackage({
			version: "2026.10.1402",
			depth: ["electron", "native-pipeline", "cli"],
		});
		expect(findCliPackage({ startDir: asar.moduleDir })?.version).toBe(
			"2026.10.1402"
		);
	});

	it("reports the release-form version and whether it runs from an app", () => {
		const checkout = fakePackage({
			version: "2026.10.1601",
			depth: ["dist", "electron", "native-pipeline", "cli"],
		});
		expect(
			describeCliInstall({
				moduleDir: checkout.moduleDir,
				scriptPath: join(checkout.moduleDir, "cli.js"),
			})
		).toMatchObject({
			version: "2026.10.16.1",
			packageDir: checkout.root,
			bundledInApp: false,
		});
		expect(
			describeCliInstall({
				moduleDir:
					"/Applications/QCut.app/Contents/Resources/app.asar/electron/native-pipeline/cli",
				scriptPath:
					"/Applications/QCut.app/Contents/Resources/app.asar/electron/native-pipeline/cli/cli.js",
			})
		).toMatchObject({ version: "unknown", bundledInApp: true });
	});

	it("warns only when the command and the app disagree", () => {
		expect(
			describeVersionMismatch({
				cliVersion: "2026.10.16.1",
				appVersion: "2026.10.1601",
				cliPath: "/x/cli.js",
			})
		).toBeUndefined();
		expect(
			describeVersionMismatch({
				cliVersion: "2026.10.14.2",
				appVersion: "2026.10.16.1",
				cliPath: "/Users/me/.bun/bin/qcut",
			})
		).toContain("does not match QCut 2026.10.16.1");
		expect(
			describeVersionMismatch({
				cliVersion: "unknown",
				appVersion: "2026.10.16.1",
				cliPath: "/x",
			})
		).toBeUndefined();
	});
});
