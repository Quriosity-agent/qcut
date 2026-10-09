import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// -- XDG Paths (Section 3.3) --

import {
	configDir,
	cacheDir,
	stateDir,
	defaultConfigPath,
	ensureDir,
} from "../native-pipeline/infra/xdg-paths.js";

describe("XDG directory support", () => {
	it("configDir respects XDG_CONFIG_HOME", () => {
		const orig = process.env.XDG_CONFIG_HOME;
		const testPath = path.join(os.tmpdir(), "test-xdg-config");
		process.env.XDG_CONFIG_HOME = testPath;
		try {
			const dir = configDir();
			expect(dir).toContain("qcut-pipeline");
			expect(path.normalize(dir)).toContain(path.normalize(testPath));
		} finally {
			if (orig) process.env.XDG_CONFIG_HOME = orig;
			else delete process.env.XDG_CONFIG_HOME;
			fs.rmSync(testPath, { recursive: true, force: true });
		}
	});

	it("cacheDir respects XDG_CACHE_HOME", () => {
		const orig = process.env.XDG_CACHE_HOME;
		const testPath = path.join(os.tmpdir(), "test-xdg-cache");
		process.env.XDG_CACHE_HOME = testPath;
		try {
			const dir = cacheDir();
			expect(dir).toContain("qcut-pipeline");
			expect(path.normalize(dir)).toContain(path.normalize(testPath));
		} finally {
			if (orig) process.env.XDG_CACHE_HOME = orig;
			else delete process.env.XDG_CACHE_HOME;
			fs.rmSync(testPath, { recursive: true, force: true });
		}
	});

	it("stateDir respects XDG_STATE_HOME", () => {
		const orig = process.env.XDG_STATE_HOME;
		const testPath = path.join(os.tmpdir(), "test-xdg-state");
		process.env.XDG_STATE_HOME = testPath;
		try {
			const dir = stateDir();
			expect(dir).toContain("qcut-pipeline");
			expect(path.normalize(dir)).toContain(path.normalize(testPath));
		} finally {
			if (orig) process.env.XDG_STATE_HOME = orig;
			else delete process.env.XDG_STATE_HOME;
			fs.rmSync(testPath, { recursive: true, force: true });
		}
	});

	it("override parameter takes priority", () => {
		const testPath = path.join(os.tmpdir(), "test-override-config");
		const dir = configDir(testPath);
		expect(dir).toBe(testPath);
		fs.rmSync(testPath, { recursive: true, force: true });
	});

	it("defaultConfigPath returns yaml file path", () => {
		const testPath = path.join(os.tmpdir(), "test-cfg-path");
		const p = defaultConfigPath(testPath);
		expect(p).toContain("config.yaml");
		fs.rmSync(testPath, { recursive: true, force: true });
	});

	it("ensureDir creates directory", () => {
		const dir = path.join(os.tmpdir(), `test-ensure-${Date.now()}`);
		const result = ensureDir(dir);
		expect(result).toBe(dir);
		expect(fs.existsSync(dir)).toBe(true);
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
