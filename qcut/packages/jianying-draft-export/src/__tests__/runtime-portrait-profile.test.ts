import type { MediaPortraitAdjustments } from "@qcut/editor-core";
import type { QCutDraftExportSnapshotV1 } from "@qcut/editor-core/jianying-draft";
import { describe, expect, it } from "vitest";
import { StandaloneJianyingDraftExportSession } from "../export-session.js";
import type { JsonValue } from "../runtime-json.js";
import { validateSnapshot } from "../snapshot-runtime-validation.js";

const PROFILE_PATH =
	"$.snapshot.tracks[0].elements[0].portraitAdjustments.bodyVideoProfile";

function createSnapshot({
	adjustments = {},
	bodyVideoProfile,
}: {
	adjustments?: Partial<MediaPortraitAdjustments>;
	bodyVideoProfile?: JsonValue;
} = {}): JsonValue {
	const portraitAdjustments: MediaPortraitAdjustments = {
		enabled: true,
		engine: "independent",
		values: { body_adjust_SlimBody: 40 },
		...adjustments,
	};
	const snapshot: QCutDraftExportSnapshotV1 = {
		schemaVersion: 1,
		project: {
			id: "project",
			name: "Body profile",
			sceneId: "scene",
			width: 1920,
			height: 1080,
			fps: 30,
			backgroundColor: "transparent",
			backgroundType: "color",
		},
		media: [],
		timelineDurationByElementId: { clip: 1 },
		tracks: [
			{
				id: "track",
				name: "Video",
				type: "media",
				elements: [
					{
						id: "clip",
						name: "Body video",
						type: "media",
						mediaId: "video",
						startTime: 0,
						duration: 1,
						trimStart: 0,
						trimEnd: 0,
						portraitAdjustments,
					},
				],
			},
		],
	};
	if (bodyVideoProfile !== undefined) {
		Object.assign(portraitAdjustments, {
			bodyVideoProfile,
		});
	}
	return JSON.parse(JSON.stringify(snapshot)) as JsonValue;
}

describe("portrait body profile draft validation", () => {
	it.each([
		{ label: "smart body", adjustments: {} },
		{
			label: "smart and manual body",
			adjustments: {
				manualBody: { zoom: { intensity: 40, x: 0.5, y: 0.5, radius: 0.2 } },
			},
		},
	])("rejects active CoreML $label without dropping its saved selection", ({
		adjustments,
	}) => {
		const snapshot = createSnapshot({
			adjustments,
			bodyVideoProfile: "swing-coreml-v1",
		});
		const before = JSON.stringify(snapshot);
		expect(() =>
			validateSnapshot({ path: "$.snapshot", value: snapshot })
		).toThrowError(
			`${PROFILE_PATH}: CoreML body video execution is not represented in JianYing drafts. Bake the media before draft export.`
		);
		expect(JSON.stringify(snapshot)).toBe(before);
	});

	it.each<{ label: string; adjustments: Partial<MediaPortraitAdjustments> }>([
		{ label: "disabled portrait", adjustments: { enabled: false } },
		{ label: "native engine", adjustments: { engine: "native" } },
		{ label: "legacy native engine", adjustments: { engine: undefined } },
		{ label: "no body values", adjustments: { values: {} } },
		{
			label: "zero body values",
			adjustments: { values: { body_adjust_SlimBody: 0 } },
		},
		{
			label: "face only",
			adjustments: { values: { face_adjust_SmallFace: 40 } },
		},
		{
			label: "manual body only",
			adjustments: {
				values: {},
				manualBody: { zoom: { intensity: 40, x: 0.5, y: 0.5, radius: 0.2 } },
			},
		},
	])("preserves the inactive CoreML preference with $label", ({
		adjustments,
	}) => {
		const snapshot = createSnapshot({
			adjustments,
			bodyVideoProfile: "swing-coreml-v1",
		});
		const before = JSON.stringify(snapshot);
		const validated = validateSnapshot({ path: "$.snapshot", value: snapshot });
		expect(JSON.stringify(validated)).toBe(before);
		expect(validated.tracks[0].elements[0]).toHaveProperty(
			"portraitAdjustments.bodyVideoProfile",
			"swing-coreml-v1"
		);
	});

	it.each([
		null,
		"",
		"automatic",
		"bef-cpu-warm-v1",
		42,
		true,
		{},
		[],
	])("rejects malformed body profile %j at its exact field", (bodyVideoProfile) => {
		expect(() =>
			validateSnapshot({
				path: "$.snapshot",
				value: createSnapshot({ bodyVideoProfile }),
			})
		).toThrowError(
			`${PROFILE_PATH}: Expected swing-coreml-v1 or no body video profile.`
		);
	});

	it.each([
		true,
		false,
	])("preserves legacy warm snapshots (enabled=%s)", (enabled) => {
		const snapshot = createSnapshot({ adjustments: { enabled } });
		const before = JSON.stringify(snapshot);
		const validated = validateSnapshot({ path: "$.snapshot", value: snapshot });
		expect(JSON.stringify(validated)).toBe(before);
		expect(validated.tracks[0].elements[0]).toHaveProperty(
			"portraitAdjustments.values.body_adjust_SlimBody",
			40
		);
		expect(validated.tracks[0].elements[0]).not.toHaveProperty(
			"portraitAdjustments.bodyVideoProfile"
		);
	});

	it("blocks the public plan before an unsupported profile can reach the writer", async () => {
		const session = new StandaloneJianyingDraftExportSession({
			ffprobePath: "/trusted/qcut/ffprobe",
		});
		try {
			await expect(
				session.plan({
					input: {
						draftName: "CoreML body video",
						outputParentDirectory: "/unused-output",
						targetPlatform: "macos",
						snapshot: createSnapshot({ bodyVideoProfile: "swing-coreml-v1" }),
					},
				})
			).rejects.toMatchObject({
				name: "StandaloneJianyingDraftRequestValidationError",
				issues: [
					{
						path: PROFILE_PATH,
						message: expect.stringContaining("Bake the media"),
					},
				],
			});
		} finally {
			session.dispose();
		}
	});
});
