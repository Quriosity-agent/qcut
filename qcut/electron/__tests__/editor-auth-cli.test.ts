import { beforeEach, describe, expect, it, vi } from "vitest";

const readHiddenInput = vi.fn(async () => "");

vi.mock("../native-pipeline/cli/interactive.js", () => ({
	readHiddenInput: (prompt: string) => readHiddenInput(prompt),
	isInteractive: () => false,
	confirm: vi.fn(async () => false),
	readStdin: vi.fn(async () => ""),
}));

import { handleAuthCommand } from "../native-pipeline/cli/cli-handlers-editor.js";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";

function options(
	command: string,
	overrides: Partial<CLIRunOptions> = {}
): CLIRunOptions {
	return {
		command,
		outputDir: "./output",
		saveIntermediates: false,
		json: true,
		verbose: false,
		quiet: false,
		...overrides,
	};
}

function createClient({ token = "abcdefghijkl" }: { token?: string } = {}) {
	const post = vi.fn(async () => ({ ok: true }));
	const get = vi.fn(async () => ({ token, authenticated: true }));
	return { client: { post, get } as unknown as EditorApiClient, post, get };
}

beforeEach(() => {
	readHiddenInput.mockReset();
	readHiddenInput.mockResolvedValue("");
});

describe("editor auth token input", () => {
	it("sets the token from the hidden prompt instead of argv", async () => {
		readHiddenInput.mockResolvedValue("  piped-secret \n");
		const { client, post } = createClient();

		const result = await handleAuthCommand(
			client,
			options("editor:auth:token", { fromStdin: true })
		);

		expect(result.success).toBe(true);
		expect(readHiddenInput).toHaveBeenCalledWith("Enter auth token: ");
		expect(post).toHaveBeenCalledWith("/api/claude/auth/token", {
			token: "piped-secret",
		});
	});

	it("fails instead of clearing the token when the hidden input is empty", async () => {
		const { client, post, get } = createClient();

		const result = await handleAuthCommand(
			client,
			options("editor:auth:token", { fromStdin: true })
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain("No auth token was entered");
		expect(post).not.toHaveBeenCalled();
		expect(get).not.toHaveBeenCalled();
	});

	it("masks short and long tokens unless --reveal is given", async () => {
		const short = await handleAuthCommand(
			createClient({ token: "tiny" }).client,
			options("editor:auth:token")
		);
		const long = await handleAuthCommand(
			createClient({ token: "abcdefghijkl" }).client,
			options("editor:auth:token")
		);
		const revealed = await handleAuthCommand(
			createClient({ token: "tiny" }).client,
			options("editor:auth:token", { reveal: true })
		);

		expect(short.data).toEqual(expect.objectContaining({ token: "****" }));
		expect(long.data).toEqual(
			expect.objectContaining({ token: "abcd...ijkl" })
		);
		expect(revealed.data).toEqual(expect.objectContaining({ token: "tiny" }));
	});

	it("activates from the hidden prompt and still accepts --token", async () => {
		readHiddenInput.mockResolvedValue("license-token");
		const { client, post } = createClient();

		const prompted = await handleAuthCommand(
			client,
			options("editor:auth:activate", { fromStdin: true })
		);
		const missing = await handleAuthCommand(
			client,
			options("editor:auth:activate")
		);

		expect(prompted.success).toBe(true);
		expect(post).toHaveBeenCalledWith(
			"/api/claude/auth/activate",
			expect.objectContaining({ token: "license-token" })
		);
		expect(missing.success).toBe(false);
		expect(missing.error).toContain("--from-stdin");
	});
});
