import { afterEach, describe, expect, it, vi } from "vitest";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner.js";
import { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import { handleGenerateExportCommand } from "../native-pipeline/editor/editor-handlers-generate.js";

afterEach(() => {
	vi.unstubAllGlobals();
});

async function startBody(flags: Record<string, unknown>) {
	const fetch = vi.fn(
		async () =>
			new Response(
				JSON.stringify({ success: true, data: { jobId: "export-1" } }),
				{ headers: { "Content-Type": "application/json" } }
			)
	);
	vi.stubGlobal("fetch", fetch);
	const client = new EditorApiClient({
		baseUrl: "http://127.0.0.1:19879",
		skipCapabilityCheck: true,
	});
	const options = {
		command: "editor:export:start",
		projectId: "project-1",
		outputDir: "/tmp",
		json: false,
		verbose: false,
		quiet: false,
		saveIntermediates: false,
		...flags,
	} as CLIRunOptions;
	expect(
		await handleGenerateExportCommand(client, options, vi.fn())
	).toMatchObject({ success: true });
	const [, init] = fetch.mock.calls.find(([url]) =>
		String(url).endsWith("/export/project-1/start")
	) as unknown as [string, RequestInit];
	return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe("editor:export:start", () => {
	it("sends --exclude-tracks as the list of track ids", async () => {
		expect(
			await startBody({ "exclude-tracks": "captions, title-cards,," })
		).toMatchObject({ excludeTracks: ["captions", "title-cards"] });
	});

	it("sends --keep-temp with the request", async () => {
		expect(await startBody({ "keep-temp": true })).toMatchObject({
			keepTemp: true,
		});
	});

	it("sends neither unless asked", async () => {
		const body = await startBody({});
		expect(body).not.toHaveProperty("excludeTracks");
		expect(body).not.toHaveProperty("keepTemp");
	});
});
