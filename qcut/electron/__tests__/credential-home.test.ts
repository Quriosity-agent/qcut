import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	aicpCredentialsFilePath,
	qcutEnvFilePath,
} from "../native-pipeline/infra/credential-home.js";
import { checkKeys, setKey } from "../native-pipeline/infra/key-manager.js";
import { keyProblem } from "../native-pipeline/infra/key-validity.js";

/**
 * N10 (2026-10-28 trailer report): an E2E run saved its placeholder FAL key
 * into the user's real ~/.qcut/.env and AICP credentials.env, and the
 * installed QCut then used it. Isolated test apps now get their own copies.
 */

describe("credential files", () => {
	let home: string;
	let previous: string | undefined;
	let previousFal: string | undefined;

	beforeEach(() => {
		home = mkdtempSync(path.join(tmpdir(), "qcut-credential-home-"));
		previous = process.env.QCUT_CREDENTIALS_HOME;
		previousFal = process.env.FAL_KEY;
		process.env.QCUT_CREDENTIALS_HOME = home;
		delete process.env.FAL_KEY;
	});

	afterEach(() => {
		if (previous === undefined) delete process.env.QCUT_CREDENTIALS_HOME;
		else process.env.QCUT_CREDENTIALS_HOME = previous;
		if (previousFal === undefined) delete process.env.FAL_KEY;
		else process.env.FAL_KEY = previousFal;
		rmSync(home, { recursive: true, force: true });
	});

	it("moves both credential files under QCUT_CREDENTIALS_HOME", () => {
		expect(qcutEnvFilePath()).toBe(path.join(home, ".qcut", ".env"));
		expect(aicpCredentialsFilePath()).toBe(
			path.join(home, ".config", "video-ai-studio", "credentials.env")
		);
		expect(qcutEnvFilePath().startsWith(homedir())).toBe(false);
	});

	it("saves keys into the overridden home, not the user's", () => {
		setKey("FAL_KEY", "test-fal-api-key-e2e");
		expect(readFileSync(path.join(home, ".qcut", ".env"), "utf8")).toContain(
			"FAL_KEY=test-fal-api-key-e2e"
		);
		expect(existsSync(qcutEnvFilePath())).toBe(true);
	});

	it("flags a placeholder key in the key report", () => {
		setKey("FAL_KEY", "test-fal-api-key-e2e");
		const fal = checkKeys().find((status) => status.name === "FAL_KEY");
		expect(fal).toMatchObject({
			configured: true,
			source: "envfile",
			warning: expect.stringContaining("test placeholder"),
		});
	});
});

describe("key problems", () => {
	it("knows placeholders and FAL's key format", () => {
		expect(
			keyProblem({ name: "FAL_KEY", value: "test-fal-api-key-e2e" })
		).toContain("test placeholder");
		expect(keyProblem({ name: "FAL_KEY", value: "abc" })).toContain(
			"key_id:key_secret"
		);
		expect(keyProblem({ name: "FAL_KEY", value: "id-1:secret-2" })).toBe(
			undefined
		);
		expect(keyProblem({ name: "ELEVENLABS_API_KEY", value: "sk_3f9a" })).toBe(
			undefined
		);
	});
});
