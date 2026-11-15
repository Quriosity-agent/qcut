import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { emitJsonResult } from "../native-pipeline/cli/json-output.js";
import { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import { handleTimelineEditingCommand } from "../native-pipeline/editor/editor-handlers-timeline.js";
import {
	BASE_URL,
	clearRoutes,
	installFetchMock,
	makeOpts,
	mockRoute,
	noopProgress,
	originalFetch,
} from "./editor-cli-test-setup";

const TIMELINE = {
	name: "Opening",
	duration: 4,
	fps: 24,
	tracks: [
		{
			id: "main",
			index: 0,
			name: "Main",
			type: "media",
			isMain: true,
			elements: [{ id: "clip", type: "media", startTime: 0, duration: 4 }],
		},
	],
};

/**
 * 问题 10 (2026-11-14): scripts read `timeline export --json` by searching
 * the output for `tracks`. The place is fixed, and this pins it: the
 * command's payload at `.data.data`, an object, never a string of JSON.
 */
describe("where timeline export --json puts the timeline", () => {
	let client: EditorApiClient;

	beforeAll(() => {
		installFetchMock(BASE_URL);
		client = new EditorApiClient({ baseUrl: BASE_URL });
	});

	afterEach(() => {
		clearRoutes();
		vi.restoreAllMocks();
	});

	afterAll(() => {
		globalThis.fetch = originalFetch;
	});

	async function exported({
		mix,
		flat = false,
	}: {
		mix: boolean;
		flat?: boolean;
	}): Promise<unknown> {
		mockRoute("GET", "/api/claude/timeline/p1", {
			success: true,
			data: TIMELINE,
		});
		if (mix) {
			mockRoute("GET", "/api/claude/mix/p1", {
				success: true,
				data: { master: { gainDb: -1 }, buses: [] },
			});
		}
		const result = await handleTimelineEditingCommand(
			client,
			makeOpts({ command: "editor:timeline:export", projectId: "p1" }),
			noopProgress
		);
		const write = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		emitJsonResult("editor:timeline:export", result, undefined, { flat });
		const printed = write.mock.calls.map(([chunk]) => String(chunk)).join("");
		write.mockRestore();
		return JSON.parse(printed);
	}

	it("is the object at .data.data, with the mix beside its tracks", async () => {
		const envelope = (await exported({ mix: true })) as {
			status: string;
			data: {
				schema_version: string;
				command: string;
				data: { tracks: unknown[]; mix: unknown };
			};
		};
		expect(envelope.status).toBe("ok");
		expect(envelope.data.command).toBe("editor:timeline:export");
		expect(typeof envelope.data.data).toBe("object");
		expect(envelope.data.data.tracks).toHaveLength(1);
		expect(envelope.data.data.mix).toEqual({
			master: { gainDb: -1 },
			buses: [],
		});
	});

	it("is at the same place when the editor has no mixer route", async () => {
		const envelope = (await exported({ mix: false })) as {
			data: { data: { tracks: unknown[]; mix?: unknown } };
		};
		expect(envelope.data.data.tracks).toHaveLength(1);
		expect(envelope.data.data.mix).toBeUndefined();
	});

	it("is the whole output under --flat", async () => {
		const timeline = (await exported({ mix: true, flat: true })) as {
			tracks: unknown[];
			status?: unknown;
		};
		expect(timeline.tracks).toHaveLength(1);
		expect(timeline.status).toBeUndefined();
	});
});
