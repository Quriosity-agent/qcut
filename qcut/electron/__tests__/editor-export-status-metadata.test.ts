import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import { handleGenerateExportCommand } from "../native-pipeline/editor/editor-handlers-generate.js";
import { formatCommandOutput } from "../native-pipeline/cli/cli-output-formatters.js";
import { emitJsonResult } from "../native-pipeline/cli/json-output.js";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner.js";
import type { ExportAudioValidation } from "../types/export-audio-validation.js";

const cases: {
	label: string;
	audioValidation: ExportAudioValidation;
	warnings?: string[];
}[] = [
	{
		label: "passed",
		audioValidation: { status: "passed", ceilingDbtp: -1, truePeakDbtp: -2 },
	},
	{
		label: "exceeded",
		audioValidation: { status: "exceeded", ceilingDbtp: -1, truePeakDbtp: 0.2 },
		warnings: [
			"The exported audio true peak exceeds the master limiter ceiling.",
		],
	},
	{
		label: "digital silence",
		audioValidation: { status: "passed", ceilingDbtp: -1, truePeakDbtp: null },
	},
	{
		label: "unavailable",
		audioValidation: { status: "unavailable", ceilingDbtp: -1 },
		warnings: [
			"The export was saved, but its audio true peak could not be verified.",
		],
	},
	{
		label: "no audio stream",
		audioValidation: { status: "no-audio", ceilingDbtp: -1 },
	},
];

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe.each([
	{ action: "start", poll: true },
	{ action: "status", poll: false },
])("editor export $action result", ({ action, poll }) => {
	it.each(cases)("preserves $label metadata in plain and JSON output", async ({
		audioValidation,
		warnings,
	}) => {
		const job = {
			jobId: "export-1",
			projectId: "project-1",
			status: "completed",
			presetId: "custom",
			outputPath: "/tmp/trailer.mp4",
			audioValidation,
			...(warnings ? { warnings } : {}),
		};
		const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
			const data = init?.method === "POST" ? { jobId: job.jobId } : job;
			return new Response(JSON.stringify({ success: true, data }), {
				headers: { "Content-Type": "application/json" },
			});
		});
		vi.stubGlobal("fetch", fetch);
		const client = new EditorApiClient({
			baseUrl: "http://127.0.0.1:19879",
			skipCapabilityCheck: true,
		});
		const options: CLIRunOptions = {
			command: `editor:export:${action}`,
			projectId: job.projectId,
			jobId: job.jobId,
			outputDir: "/tmp",
			poll,
			json: false,
			verbose: false,
			quiet: false,
			saveIntermediates: false,
		};
		const result = await handleGenerateExportCommand(client, options, vi.fn());
		expect(result).toEqual({ success: true, data: job });
		expect(fetch).toHaveBeenCalledTimes(poll ? 2 : 1);

		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		formatCommandOutput(options.command, result);
		expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual(job);

		const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		emitJsonResult(options.command, result);
		expect(JSON.parse(String(write.mock.calls[0]?.[0])).data.data).toEqual(job);
		emitJsonResult(options.command, result, undefined, { flat: true });
		expect(JSON.parse(String(write.mock.calls[1]?.[0]))).toEqual(job);
	});
});
