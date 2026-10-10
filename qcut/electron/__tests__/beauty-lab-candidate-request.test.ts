// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	BEAUTY_LAB_CANDIDATE_PROTOCOL,
	type BeautyLabCandidateRequest,
} from "../beauty-lab/beauty-lab-candidate-contract.js";
import {
	beautyLabCandidateIdentity,
	parseBeautyLabCandidateRequest,
} from "../beauty-lab-candidate-request.js";
import type { MediaPortraitAdjustments } from "../jianying-portrait-adjustment-contract.js";
import { parseJianyingPortraitRenderRequest } from "../jianying-portrait-adjustment-runtime/request.js";

function makeRequest({
	patch = {},
}: {
	patch?: Partial<BeautyLabCandidateRequest>;
} = {}): BeautyLabCandidateRequest {
	return {
		protocol: BEAUTY_LAB_CANDIDATE_PROTOCOL,
		requestId: "unit-request:1",
		backendVersion: "unit-stub-v1",
		width: 2,
		height: 1,
		rgba: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 127]),
		adjustments: {
			enabled: true,
			values: { face_adjust_eye: 40, face_adjust_nose: 20 },
		},
		sourceKey: "unit-media:clip-1",
		frameNumber: 3,
		timestampSeconds: 0.125,
		...patch,
	};
}

function detailedAdjustments(): MediaPortraitAdjustments {
	return {
		enabled: true,
		values: { face_adjust_eye: 40, face_adjust_nose: 20 },
		faceTarget: { mode: "single", faceId: 0 },
		faces: [
			{
				trackId: 2,
				personBindingId: "person:1",
				bindingAnchor: {
					rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
					frameNumber: 3,
				},
				values: { face_adjust_eye: 10 },
			},
		],
		manualRetouch: {
			strokes: [
				{
					id: "stroke_1",
					tool: "smooth",
					mode: "paint",
					size: 20,
					intensity: 30,
					points: [
						{ x: 0.2, y: 0.3 },
						{ x: 0.4, y: 0.5 },
					],
				},
			],
		},
		manualBody: {
			zoom: { intensity: 10, x: 0.5, y: 0.5, radius: 0.2 },
		},
	};
}

function reverseObjectKeys({ value }: { value: unknown }): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => reverseObjectKeys({ value: entry }));
	}
	if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
		return Object.fromEntries(
			Object.entries(value)
				.reverse()
				.map(([key, entry]) => [key, reverseObjectKeys({ value: entry })])
		);
	}
	return value;
}

describe("Beauty Lab candidate request (unit contract, not runtime evidence)", () => {
	it("uses the native parser's normalized adjustments and strips untrusted extra fields", () => {
		const request = {
			...makeRequest({ patch: { adjustments: detailedAdjustments() } }),
			inputSha256: "forged-input",
			requestFingerprint: "forged-fingerprint",
			backendId: "untrusted",
		};
		const native = parseJianyingPortraitRenderRequest({ request });
		const parsed = parseBeautyLabCandidateRequest({ request });
		expect(parsed).toEqual({
			...native,
			protocol: BEAUTY_LAB_CANDIDATE_PROTOCOL,
			requestId: request.requestId,
			backendVersion: request.backendVersion,
		});
		expect(parsed.rgba).not.toBe(request.rgba);
		expect(parsed.rgba.buffer).not.toBe(request.rgba.buffer);
		expect(parsed).not.toHaveProperty("inputSha256");
		expect(parsed).not.toHaveProperty("requestFingerprint");
		expect(parsed).not.toHaveProperty("backendId");
	});

	it.each([
		{ label: "missing", request: undefined },
		{ label: "null", request: null },
		{ label: "array", request: [] },
		{ label: "boolean", request: true },
		{ label: "number", request: 1 },
		{ label: "string", request: "request" },
		{ label: "function", request: () => makeRequest() },
		{ label: "empty object", request: {} },
	])("rejects a $label request", ({ request }) => {
		expect(() => parseBeautyLabCandidateRequest({ request })).toThrow();
	});

	it.each(
		[
			"protocol",
			"requestId",
			"backendVersion",
			"sourceKey",
			"frameNumber",
			"timestampSeconds",
		].flatMap((field) => [
			{ field, value: undefined, label: "missing" },
			{ field, value: null, label: "null" },
		])
	)("requires $field ($label)", ({ field, value }) => {
		expect(() =>
			parseBeautyLabCandidateRequest({
				request: { ...makeRequest(), [field]: value },
			})
		).toThrow();
	});

	it.each(
		["qcut-beauty-lab-candidate-v2", "", true, 1].map((value) => ({ value }))
	)("rejects protocol $value", ({ value }) => {
		expect(() =>
			parseBeautyLabCandidateRequest({
				request: { ...makeRequest(), protocol: value },
			})
		).toThrow();
	});

	it.each(
		["requestId", "backendVersion"].flatMap((field) =>
			[
				"",
				" ",
				"contains space",
				"line\nbreak",
				"tab\t",
				"a/b",
				"a\\b",
				"a?b",
				"a".repeat(129),
				"\u00e9",
				1,
				true,
				{},
			].map((value) => ({ field, value }))
		)
	)("rejects unsafe $field $value", ({ field, value }) => {
		expect(() =>
			parseBeautyLabCandidateRequest({
				request: { ...makeRequest(), [field]: value },
			})
		).toThrow();
	});

	it.each(
		["requestId", "backendVersion"].flatMap((field) =>
			["a", "a".repeat(128), "Az09._:-"].map((value) => ({ field, value }))
		)
	)("accepts bounded $field $value", ({ field, value }) => {
		expect(
			parseBeautyLabCandidateRequest({
				request: { ...makeRequest(), [field]: value },
			})[field as "requestId" | "backendVersion"]
		).toBe(value);
	});

	it.each(
		["width", "height"].flatMap((field) =>
			[
				0,
				-1,
				1.5,
				Number.NaN,
				Number.POSITIVE_INFINITY,
				4097,
				Number.MAX_SAFE_INTEGER + 1,
				"2",
				true,
			].map((value) => ({ field, value }))
		)
	)("rejects native dimension $field $value", ({ field, value }) => {
		expect(() =>
			parseBeautyLabCandidateRequest({
				request: { ...makeRequest(), [field]: value },
			})
		).toThrow();
	});

	it.each([
		{ label: "plain array", rgba: [1, 2, 3, 255, 4, 5, 6, 127] },
		{ label: "ArrayBuffer", rgba: new ArrayBuffer(8) },
		{ label: "clamped array", rgba: new Uint8ClampedArray(8) },
		{ label: "16-bit array", rgba: new Uint16Array(4) },
		{ label: "DataView", rgba: new DataView(new ArrayBuffer(8)) },
		{ label: "missing", rgba: undefined },
		{ label: "empty", rgba: new Uint8Array(0) },
		{ label: "short", rgba: new Uint8Array(7) },
		{ label: "long", rgba: new Uint8Array(9) },
	])("rejects $label RGBA", ({ rgba }) => {
		expect(() =>
			parseBeautyLabCandidateRequest({
				request: { ...makeRequest(), rgba },
			})
		).toThrow();
	});

	it.each(
		[
			{
				field: "sourceKey",
				values: [
					"",
					"x".repeat(513),
					"line\nbreak",
					"carriage\rreturn",
					"tab\t",
					1,
					true,
				],
			},
			{
				field: "frameNumber",
				values: [
					-1,
					0.5,
					Number.NaN,
					Number.POSITIVE_INFINITY,
					Number.MAX_SAFE_INTEGER + 1,
					"3",
					true,
				],
			},
			{
				field: "timestampSeconds",
				values: [
					-0.001,
					86400,
					Number.NaN,
					Number.POSITIVE_INFINITY,
					Number.NEGATIVE_INFINITY,
					"0.125",
					true,
				],
			},
		].flatMap(({ field, values }) => values.map((value) => ({ field, value })))
	)("rejects invalid native identity $field $value", ({ field, value }) => {
		expect(() =>
			parseBeautyLabCandidateRequest({
				request: { ...makeRequest(), [field]: value },
			})
		).toThrow();
	});

	it.each([
		{ frameNumber: 0, timestampSeconds: 0, sourceKey: "clip" },
		{
			frameNumber: Number.MAX_SAFE_INTEGER,
			timestampSeconds: 86399,
			sourceKey: "x".repeat(512),
		},
	])("accepts native identity boundary $frameNumber / $timestampSeconds", ({
		frameNumber,
		timestampSeconds,
		sourceKey,
	}) => {
		const patch = { frameNumber, timestampSeconds, sourceKey };
		expect(
			parseBeautyLabCandidateRequest({ request: makeRequest({ patch }) })
		).toMatchObject(patch);
	});

	it.each([
		{ width: 4096, height: 1 },
		{ width: 1, height: 4096 },
	])("accepts bounded $width x $height pixels", ({ width, height }) => {
		const request = makeRequest({
			patch: { width, height, rgba: new Uint8Array(width * height * 4) },
		});
		expect(parseBeautyLabCandidateRequest({ request }).rgba).toHaveLength(
			width * height * 4
		);
	});

	it.each([
		{ label: "missing adjustments", adjustments: undefined },
		{ label: "numeric switch", adjustments: { enabled: 1, values: {} } },
		{
			label: "unknown control",
			adjustments: { enabled: true, values: { unsupported: 1 } },
		},
		{
			label: "out of range",
			adjustments: { enabled: true, values: { face_adjust_eye: 101 } },
		},
		{
			label: "nonfinite control",
			adjustments: { enabled: true, values: { face_adjust_eye: Number.NaN } },
		},
		{
			label: "invalid face target",
			adjustments: {
				enabled: true,
				values: {},
				faceTarget: { mode: "single", faceId: 10 },
			},
		},
		{
			label: "invalid manual point",
			adjustments: {
				...detailedAdjustments(),
				manualRetouch: {
					strokes: [
						{
							...detailedAdjustments().manualRetouch!.strokes[0],
							points: [
								{ x: -1, y: 0 },
								{ x: 0, y: 0 },
							],
						},
					],
				},
			},
		},
	])("retains native rejection of $label", ({ adjustments }) => {
		expect(() =>
			parseBeautyLabCandidateRequest({
				request: { ...makeRequest(), adjustments },
			})
		).toThrow();
	});

	it("accepts disabled controls without inventing an adjustment", () => {
		const request = makeRequest({
			patch: { adjustments: { enabled: false, values: {} } },
		});
		expect(parseBeautyLabCandidateRequest({ request }).adjustments).toEqual(
			request.adjustments
		);
	});

	it.each(
		["uint8-view", "buffer-view"].map((kind) => ({ kind }))
	)("owns only the visible pixels for $kind", ({ kind }) => {
		const bytes = makeRequest().rgba;
		const backing = new ArrayBuffer(12);
		const full = new Uint8Array(backing);
		full.fill(99);
		full.set(bytes, 2);
		const rgba =
			kind === "buffer-view"
				? Buffer.from(backing, 2, 8)
				: new Uint8Array(backing, 2, 8);
		const request = makeRequest({ patch: { rgba } });
		const parsed = parseBeautyLabCandidateRequest({ request });
		const identity = beautyLabCandidateIdentity({ request: parsed });
		expect(parsed.rgba).toEqual(bytes);
		expect(parsed.rgba.buffer.byteLength).toBe(8);
		expect(identity.inputSha256).toBe(
			createHash("sha256").update(bytes).digest("hex")
		);
		full.fill(0);
		expect(parsed.rgba).toEqual(bytes);
		expect(beautyLabCandidateIdentity({ request: parsed })).toEqual(identity);
		parsed.rgba[0] = 80;
		expect(full[2]).toBe(0);
	});

	it.each([
		{ offset: 0 },
		{ offset: 2 },
	])("rejects shared mutable input storage at offset $offset", ({ offset }) => {
		const rgba = new Uint8Array(new SharedArrayBuffer(8 + offset), offset, 8);
		expect(() =>
			parseBeautyLabCandidateRequest({
				request: makeRequest({ patch: { rgba } }),
			})
		).toThrow(/shared/i);
	});

	it("retains owned pixels after the caller detaches its buffer", () => {
		const request = makeRequest();
		const expected = Array.from(request.rgba);
		const parsed = parseBeautyLabCandidateRequest({ request });
		structuredClone(request.rgba.buffer, { transfer: [request.rgba.buffer] });
		expect(request.rgba.byteLength).toBe(0);
		expect(Array.from(parsed.rgba)).toEqual(expected);
	});

	it("owns nested adjustment state in both mutation directions", () => {
		const adjustments = detailedAdjustments();
		const parsed = parseBeautyLabCandidateRequest({
			request: makeRequest({ patch: { adjustments } }),
		});
		const snapshot = structuredClone(parsed.adjustments);
		adjustments.values.face_adjust_eye = 90;
		adjustments.faceTarget!.faceId = 1;
		adjustments.faces![0].values.face_adjust_eye = 80;
		adjustments.faces![0].bindingAnchor!.rect.x = 0.4;
		adjustments.manualRetouch!.strokes[0].points[0].x = 0.8;
		adjustments.manualBody!.zoom!.intensity = 40;
		expect(parsed.adjustments).toEqual(snapshot);
		parsed.adjustments.faces![0].bindingAnchor!.rect.y = 0.6;
		parsed.adjustments.manualRetouch!.strokes[0].points.push({ x: 0, y: 0 });
		expect(adjustments.faces![0].bindingAnchor!.rect.y).toBe(0.2);
		expect(adjustments.manualRetouch!.strokes[0].points).toHaveLength(2);
	});
});

describe("Beauty Lab candidate fingerprint (unit identity, not runtime evidence)", () => {
	it("is deterministic and uses SHA-256 over the actual input bytes", () => {
		const request = parseBeautyLabCandidateRequest({ request: makeRequest() });
		const identity = beautyLabCandidateIdentity({ request });
		expect(identity.inputSha256).toBe(
			createHash("sha256").update(request.rgba).digest("hex")
		);
		expect(identity.inputSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(identity.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
		expect(
			beautyLabCandidateIdentity({ request: structuredClone(request) })
		).toEqual(identity);
	});

	it("ignores recursive parameter key order and optional undefined keys", () => {
		const request = makeRequest({
			patch: { adjustments: detailedAdjustments() },
		});
		const reordered = reverseObjectKeys({
			value: request,
		}) as BeautyLabCandidateRequest;
		expect(beautyLabCandidateIdentity({ request: reordered })).toEqual(
			beautyLabCandidateIdentity({ request })
		);
		expect(
			beautyLabCandidateIdentity({
				request: {
					...request,
					adjustments: { ...request.adjustments, makeup: undefined },
				},
			})
		).toEqual(beautyLabCandidateIdentity({ request }));
	});

	it.each([
		{ label: "request ID", patch: { requestId: "unit-request:2" } },
		{ label: "backend version", patch: { backendVersion: "unit-stub-v2" } },
		{ label: "source", patch: { sourceKey: "unit-media:clip-2" } },
		{ label: "frame number", patch: { frameNumber: 4 } },
		{ label: "subframe timestamp", patch: { timestampSeconds: 0.125001 } },
		{
			label: "dimensions with equal byte count",
			patch: { width: 1, height: 2 },
		},
		{
			label: "parameter value",
			patch: {
				adjustments: {
					enabled: true,
					values: { face_adjust_eye: 41, face_adjust_nose: 20 },
				},
			},
		},
		{
			label: "enabled state",
			patch: {
				adjustments: {
					enabled: false,
					values: { face_adjust_eye: 40, face_adjust_nose: 20 },
				},
			},
		},
		{
			label: "face selector",
			patch: {
				adjustments: {
					enabled: true,
					values: { face_adjust_eye: 40, face_adjust_nose: 20 },
					faceTarget: { mode: "single", faceId: 1 },
				},
			},
		},
	] satisfies {
		label: string;
		patch: Partial<BeautyLabCandidateRequest>;
	}[])("binds $label without changing the input SHA", ({ patch }) => {
		const before = beautyLabCandidateIdentity({ request: makeRequest() });
		const after = beautyLabCandidateIdentity({
			request: parseBeautyLabCandidateRequest({
				request: makeRequest({ patch }),
			}),
		});
		expect(after.inputSha256).toBe(before.inputSha256);
		expect(after.requestFingerprint).not.toBe(before.requestFingerprint);
	});

	it.each([
		{ index: 0 },
		{ index: 3 },
		{ index: 7 },
	])("binds changed pixel channel $index", ({ index }) => {
		const request = makeRequest();
		const before = beautyLabCandidateIdentity({ request });
		request.rgba[index] ^= 1;
		const after = beautyLabCandidateIdentity({ request });
		expect(after.inputSha256).not.toBe(before.inputSha256);
		expect(after.requestFingerprint).not.toBe(before.requestFingerprint);
	});

	it.each([
		{ target: "strokes" },
		{ target: "points" },
	])("preserves semantically significant $target array order", ({ target }) => {
		const request = makeRequest({
			patch: { adjustments: detailedAdjustments() },
		});
		const strokes = request.adjustments.manualRetouch!.strokes;
		strokes.push({
			...structuredClone(strokes[0]),
			id: "stroke_2",
			intensity: 70,
		});
		const before = beautyLabCandidateIdentity({ request });
		if (target === "strokes") strokes.reverse();
		else strokes[0].points.reverse();
		expect(beautyLabCandidateIdentity({ request }).requestFingerprint).not.toBe(
			before.requestFingerprint
		);
	});
});
