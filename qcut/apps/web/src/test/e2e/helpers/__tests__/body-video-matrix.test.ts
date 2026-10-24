// @vitest-environment node
import { MEDIA_PORTRAIT_ADJUSTMENT_KEYS } from "@qcut/editor-core";
import { describe, expect, it } from "vitest";
import {
	BODY_VIDEO_MATRIX_CONTROLS,
	bodyVideoMatrixCases,
	bodyVideoMatrixConfig,
	matrixCanonicalAdjustments,
} from "../body-video-matrix-config";
import {
	type MatrixJournal,
	type MatrixPipelineReport,
	verifyBodyMatrixCase,
} from "../body-video-matrix-evidence";
import type { WorkerObservation } from "../body-video-worker-types";

describe("bounded dynamic body matrix", () => {
	it("covers the actual ten video controls once, plus smart/manual combinations", () => {
		expect(BODY_VIDEO_MATRIX_CONTROLS.map(({ key }) => key)).toEqual(
			MEDIA_PORTRAIT_ADJUSTMENT_KEYS.filter((key) =>
				key.startsWith("body_adjust_")
			)
		);
		const config = bodyVideoMatrixConfig();
		expect(config.cases).toHaveLength(14);
		expect(config.exportFrameBudget).toBe(180);
		expect(config.previewFrames).toEqual([11, 0, 6]);
		expect(
			config.cases
				.filter(({ manualTool }) => manualTool)
				.map(({ manualTool }) => manualTool)
		).toEqual(["stretch", "slim", "zoom"]);
	});
	it.each([
		"0",
		"5",
		"25",
		"12.5",
		"NaN",
		"Infinity",
	])("rejects an invalid frame budget %s", (frames) => {
		expect(() => bodyVideoMatrixConfig({ frames })).toThrow("6..24");
	});
	it.each([
		"",
		"typo",
		"small-head,small-head",
		"slim-body, slim-arm",
	])("rejects invalid case selection %s", (cases) => {
		expect(() => bodyVideoMatrixConfig({ cases })).toThrow("unique supported");
	});
	it("limits a selected smoke subset and returns fresh mutable case values", () => {
		const config = bodyVideoMatrixConfig({
			frames: "6",
			cases: "smart-manual-zoom,slim-body",
		});
		expect(config.exportFrameBudget).toBe(18);
		expect(config.cases.map(({ id }) => id)).toEqual([
			"smart-manual-zoom",
			"slim-body",
		]);
		config.cases[1].values.body_adjust_SlimBody = 1;
		expect(
			bodyVideoMatrixCases().find(({ id }) => id === "slim-body")?.values
				.body_adjust_SlimBody
		).toBe(40);
	});
});

function fixture({ manual = false } = {}) {
	const entry = bodyVideoMatrixCases().find(
		({ id }) => id === (manual ? "smart-manual-stretch" : "slim-body")
	)!;
	const identity = {
		profile: "swing-coreml-v1",
		generation: "a".repeat(64),
		source: "owned-source",
	};
	const routes = [{ network: "refine", backend: "coreml" }];
	const original = [0, 1].map((frame) => ({
		frame,
		rgbaSha256: "0".repeat(64),
	}));
	const exported = [0, 1].map((frame) => ({
		frame,
		rgbaSha256: String(frame + 1).repeat(64),
	}));
	const observation: WorkerObservation = {
		pending: [],
		completed: 2,
		spawned: [1],
		exited: [],
		sequenceRequests: [],
		cancellations: [],
		evidenceErrors: [],
		resumptions: [],
		sequenceHistory: [0, 1].map((frame) => ({
			requestId: `outer-${frame}`,
			frame,
			clip: "clip",
			fps: 30,
			replay: false,
			sourceTimestampSeconds: 0,
			enteredAt: 1,
			elapsedMs: 20,
			status: "completed",
			sessions: [identity.generation],
			workerRequestIds: [`worker-${frame}`],
		})),
		workerHistory: [0, 1].map((frame) => ({
			pid: 1,
			id: `worker-${frame}`,
			frame,
			startedAt: 1,
			elapsedMs: 10,
			outerRequestId: `outer-${frame}`,
			association: "transport-id",
			outcome: "ok",
			sequence: {
				frame,
				session: identity.generation,
				checkpoints: "/private",
				timestamp: 0,
				executionProfile: identity.profile,
				executionGeneration: identity.generation,
			},
		})),
		executions: [0, 1].map((frame) => ({
			pid: 1,
			frame,
			workerRequestId: `worker-${frame}`,
			outerRequestId: `outer-${frame}`,
			receivedAt: 3,
			file: `report-${frame}`,
			sha256: "unused-in-pure-fixture",
			profile: identity.profile,
			generation: identity.generation,
			routes,
			sequence: {
				frame,
				session: identity.generation,
				checkpoints: "/private",
				timestamp: 0,
				executionProfile: identity.profile,
				executionGeneration: identity.generation,
			},
		})),
	};
	const reports = new Map<string, MatrixPipelineReport>(
		[0, 1].map((frame) => {
			const input = original[frame].rgbaSha256;
			const intermediate = "f".repeat(64);
			return [
				`report-${frame}`,
				{
					passed: true,
					adjustments: matrixCanonicalAdjustments({ entry }),
					outputDimensions: [1080, 1920],
					inputRgbaSha256: input,
					outputRgbaSha256: exported[frame].rgbaSha256,
					nativeInputsUsed: false,
					nativeGeometryUsed: false,
					nativeFallbackUsed: false,
					stages: [
						...(manual
							? [
									{
										id: "manual-body",
										milliseconds: 2,
										inputRgbaSha256: input,
										outputRgbaSha256: intermediate,
										receipt: {},
									},
								]
							: []),
						{
							id: "smart-body",
							milliseconds: 3,
							inputRgbaSha256: manual ? intermediate : input,
							outputRgbaSha256: exported[frame].rgbaSha256,
							receipt: {
								frame,
								timestampSeconds: 0,
								executionIdentity: identity,
								executionRoutes: routes,
							},
						},
					],
				},
			];
		})
	);
	const journals: MatrixJournal[] = [
		{
			session: identity.generation,
			identity,
			frames: [0, 1].map((frame) => ({ frame, routes })),
		},
	];
	return { entry, original, exported, observation, reports, journals, fps: 30 };
}

describe("dynamic matrix evidence cannot pass from unrelated reports", () => {
	it.each([
		false,
		true,
	])("binds every frame through the original, ordered stages, source PTS, generation, journal and export (manual=%s)", (manual) => {
		const result = verifyBodyMatrixCase(fixture({ manual }));
		expect(result.changedFrames).toEqual([0, 1]);
		expect(result.repeatedOriginalFrames).toEqual([
			{
				frame: 1,
				previousFrame: 0,
				ownedOutputRepeated: false,
				sourceTimestampRepeated: true,
			},
		]);
		expect(result.frames[1]).toMatchObject({
			sourceTimestampSeconds: 0,
			timelineTimestampSeconds: 1 / 30,
			outerElapsedMs: 20,
			workerElapsedMs: 10,
		});
	});
	it("rejects source-clock substitution by the timeline clock", () => {
		const input = fixture();
		input.observation.workerHistory[1].sequence!.timestamp = 1 / 30;
		expect(() => verifyBodyMatrixCase(input)).toThrow();
	});
	it("rejects missing source PTS instead of guessing from frame index", () => {
		const input = fixture();
		input.observation.sequenceHistory[1].sourceTimestampSeconds = undefined;
		expect(() => verifyBodyMatrixCase(input)).toThrow("Decoded source PTS");
	});
	it("rejects reports with matching controls but different output pixels", () => {
		const input = fixture();
		input.exported[1].rgbaSha256 = "9".repeat(64);
		expect(() => verifyBodyMatrixCase(input)).toThrow("Worker output differs");
	});
	it("rejects a broken manual-to-smart hash chain", () => {
		const input = fixture({ manual: true });
		input.reports.get("report-1")!.stages[1].inputRgbaSha256 = "b".repeat(64);
		expect(() => verifyBodyMatrixCase(input)).toThrow("Pipeline hash chain");
	});
	it("rejects a rewritten journal route", () => {
		const input = fixture();
		input.journals[0].frames[1].routes = [
			{ network: "refine", backend: "cpu" },
		];
		expect(() => verifyBodyMatrixCase(input)).toThrow();
	});
	it("rejects plausible timing-only association", () => {
		const input = fixture();
		input.observation.workerHistory[1].association = "unavailable";
		expect(() => verifyBodyMatrixCase(input)).toThrow("Explicit worker/IPC");
	});
	it("binds reused request IDs to the worker process that produced the report", () => {
		const input = fixture();
		input.observation.spawned.push(2);
		input.observation.workerHistory.unshift({
			...input.observation.workerHistory[1],
			pid: 2,
			outerRequestId: "stale-outer-request",
			elapsedMs: 999,
			outcome: "exit",
		});
		const result = verifyBodyMatrixCase(input);
		expect(result.frames[1]).toMatchObject({
			workerRequestId: "worker-1",
			outerRequestId: "outer-1",
			workerElapsedMs: 10,
		});
	});
	it("rejects a matching request ID recorded only in another worker process", () => {
		const input = fixture();
		input.observation.spawned.push(2);
		input.observation.workerHistory[1].pid = 2;
		expect(() => verifyBodyMatrixCase(input)).toThrow(
			"matching worker request and PID"
		);
	});
	it("rejects ambiguous matching IDs within the same worker process", () => {
		const input = fixture();
		input.observation.workerHistory.push({
			...input.observation.workerHistory[1],
		});
		expect(() => verifyBodyMatrixCase(input)).toThrow(
			"matching worker request and PID"
		);
	});
	it("requires a complete generation, not the same frame rendered twice", () => {
		const input = fixture();
		input.observation.executions = [
			input.observation.executions[0],
			input.observation.executions[0],
		];
		expect(() => verifyBodyMatrixCase(input)).toThrow(
			"complete CoreML generation"
		);
	});
	it("does not accept another edit's reports", () => {
		const input = fixture();
		input.entry.values.body_adjust_SlimBody = 55;
		expect(() => verifyBodyMatrixCase(input)).toThrow(
			"complete CoreML generation"
		);
	});
});
