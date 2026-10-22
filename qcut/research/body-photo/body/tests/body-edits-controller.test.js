import { describe, expect, test } from "bun:test";
import { createLocalEditor } from "../web/local-editor.js";
import { createBodyController } from "../web/body-controller.js";
import { emptyEdits, validateEdits, clampStroke, imageContentRect, pointInImage } from "../web/edits-contract.js";

const photo = { photoId: "source", url: "/photo.png", width: 800, height: 1600 };
const stroke = () => ({ start: [0.5, 0.6], end: [0.47, 0.6], radius: 0.12 });
const edits = ({ protect = true, strokes = [stroke()] } = {}) => ({ backgroundProtection: protect, strokes });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const response = ({ request }) => ({ ...structuredClone(request), status: "applied",
	result: { url: "/result.png", downloadUrl: "/download.png" } });
async function setup() {
	const runs = [];
	const controller = createBodyController({ services: {
		catalog: async () => ({ controls: [{ name: "SlimWaist", title: "瘦腰", min: 0, max: 100,
			default: 0, step: 1 }], platform: { supported: true } }),
		upload: async ({ file }) => ({ ...photo, photoId: file.name }),
		render: (request) => new Promise((resolve, reject) => runs.push({ request, resolve, reject })),
	} });
	await controller.initialize();
	await controller.selectPhoto({ file: { name: "source" }, previewUrl: "blob:source" });
	return { controller, runs };
}

describe("local edits render state", () => {
	test("empty edits preserve the previous wire contract and identity compatibility", async () => {
		const { controller, runs } = await setup();
		expect(controller.getState().edits).toEqual(emptyEdits());
		controller.apply();
		expect(runs[0].request).toEqual({ photoId: "source", values: { SlimWaist: 0 } });
		runs[0].resolve(response({ request: runs[0].request }));
		await flush();
		expect(controller.getState().downloadReady).toBe(true);
	});
	test("protection-only and stroke edits are sent exactly and invalidate an existing download", async () => {
		const { controller, runs } = await setup();
		controller.setEdits({ edits: edits({ strokes: [] }) });
		controller.apply();
		expect(runs[0].request.edits).toEqual(edits({ strokes: [] }));
		runs[0].resolve(response({ request: runs[0].request }));
		await flush();
		expect(controller.getState().downloadReady).toBe(true);
		controller.setEdits({ edits: edits() });
		expect(controller.getState().downloadReady).toBe(false);
		expect(controller.getState().result).toBeNull();
		controller.apply();
		expect(runs[1].request.edits).toEqual(edits());
		runs[1].resolve(response({ request: runs[1].request }));
		await flush();
		expect(controller.getState().downloadReady).toBe(true);
	});
	test("caller values, snapshots, submitted requests and received results cannot mutate stored edits", async () => {
		const { controller, runs } = await setup();
		const input = edits();
		controller.setEdits({ edits: input });
		input.strokes[0].start[0] = 0;
		const snapshot = controller.getState();
		snapshot.edits.strokes[0].end[0] = 1;
		snapshot.photo.width = 1;
		expect(controller.getState().photo.width).toBe(800);
		expect(controller.getState().edits).toEqual(edits());
		controller.apply();
		const answer = response({ request: runs[0].request });
		runs[0].request.edits.strokes[0].radius = 0.3;
		runs[0].resolve(answer);
		await flush();
		answer.edits.strokes[0].start[0] = 0;
		controller.getState().result.edits.strokes[0].end[0] = 0;
		expect(controller.getState().result.edits).toEqual(edits());
		expect(controller.getState().downloadReady).toBe(true);
	});
	test("missing, malformed, reordered or mismatched active edit echoes reject the result", async () => {
		const changed = stroke(); changed.start[0] = 0.51;
		const expected = edits({ strokes: [stroke(), changed] });
		const invalid = [undefined, null, {}, emptyEdits(), { ...expected, backgroundProtection: false },
			{ ...expected, strokes: [changed, stroke()] }, { ...expected, extra: true }];
		await Promise.all(invalid.map(async (returnedEdits) => {
			const { controller, runs } = await setup();
			controller.setEdits({ edits: expected }); controller.apply();
			runs[0].resolve({ ...response({ request: runs[0].request }), edits: returnedEdits });
			await flush();
			expect(controller.getState().downloadReady).toBe(false);
			expect(controller.getState().error).toContain("不匹配");
		}));
	});
	test("queued application combines the newest sliders and edits and discards old renders", async () => {
		const { controller, runs } = await setup();
		controller.setEdits({ edits: edits() }); controller.apply();
		controller.setEdits({ edits: edits({ protect: false }) }); controller.apply();
		controller.setValue({ name: "SlimWaist", value: 80 });
		controller.setEdits({ edits: edits({ strokes: [stroke(), stroke()] }) });
		runs[0].resolve(response({ request: runs[0].request }));
		await flush();
		expect(runs).toHaveLength(2);
		expect(runs[1].request.edits.strokes).toHaveLength(2);
		expect(runs[1].request.values.SlimWaist).toBe(80);
		expect(controller.getState().result).toBeNull();
		runs[1].resolve(response({ request: runs[1].request }));
		await flush();
		expect(controller.getState().downloadReady).toBe(true);
	});
	test("undoing to the same edit values still rejects an earlier revision", async () => {
		const { controller, runs } = await setup();
		controller.setEdits({ edits: edits() }); controller.apply();
		controller.setEdits({ edits: emptyEdits() });
		controller.setEdits({ edits: edits() });
		runs[0].resolve(response({ request: runs[0].request }));
		await flush();
		expect(controller.getState().result).toBeNull();
		expect(controller.getState().downloadReady).toBe(false);
	});
	test("reset and uploading another photo clear strokes, protection, queues and downloads", async () => {
		await Promise.all(["reset", "upload"].map(async (action) => {
			const { controller, runs } = await setup();
			controller.setEdits({ edits: edits() }); controller.apply(); controller.apply();
			if (action === "reset") controller.reset();
			if (action === "upload") await controller.selectPhoto({ file: { name: "new" }, previewUrl: "blob:new" });
			expect(controller.getState().edits).toEqual(emptyEdits());
			runs[0].resolve(response({ request: runs[0].request }));
			await flush();
			expect(runs).toHaveLength(1);
			expect(controller.getState().downloadReady).toBe(false);
			expect(controller.getState().queued).toBe(false);
		}));
	});
	test("failed protection requests stay non-exportable until an explicit corrected apply", async () => {
		const { controller, runs } = await setup();
		controller.setEdits({ edits: edits() }); controller.apply();
		runs[0].reject(new Error("人物分割不可用"));
		await flush();
		expect(controller.getState().error).toContain("人物分割不可用");
		expect(controller.getState().downloadReady).toBe(false);
		expect(controller.getState().edits.backgroundProtection).toBe(true);
		expect(runs).toHaveLength(1);
		controller.setEdits({ edits: edits({ protect: false }) }); controller.apply();
		runs[1].resolve(response({ request: runs[1].request }));
		await flush();
		expect(controller.getState().downloadReady).toBe(true);
		controller.setEdits({ edits: edits({ protect: false }) });
		expect(controller.getState().downloadReady).toBe(true);
	});
	test("invalid edit inputs leave the previous recipe intact", async () => {
		const { controller } = await setup();
		controller.setEdits({ edits: edits() });
		expect(() => controller.setEdits({ edits: { ...edits(), strokes: Array(33).fill(stroke()) } })).toThrow();
		expect(controller.getState().edits).toEqual(edits());
	});
});

describe("local edits coordinates", () => {
	test("the DOM editor module loads without side effects", () => {
		expect(typeof createLocalEditor).toBe("function");
	});
	test("strict finite normalized contracts reject extra fields and invalid radius or displacement", () => {
		const badStrokes = [null, { ...stroke(), radius: 0.019 }, { ...stroke(), radius: 0.301 },
			{ ...stroke(), radius: true }, { ...stroke(), start: [NaN, 0.5] },
			{ ...stroke(), end: [0.5, Infinity] }, { ...stroke(), end: [0.5, 0.5, 0] },
			{ ...stroke(), start: [-0.1, 0.5] }, { ...stroke(), end: [1.1, 0.5] },
			{ ...stroke(), end: [0.5, 0.7] }, { ...stroke(), extra: 1 }];
		for (const item of badStrokes)
			expect(() => validateEdits({ edits: edits({ strokes: [item] }), photo })).toThrow();
		expect(() => validateEdits({ edits: { ...edits(), backgroundProtection: 1 }, photo })).toThrow();
		expect(() => validateEdits({ edits: edits(), photo: null })).toThrow();
		expect(validateEdits({ edits: edits(), photo })).toEqual(edits());
	});
	test("letterboxed pointer coordinates use original content, and reject clicks in padding", () => {
		const rect = imageContentRect({ bounds: { left: 10, top: 20, width: 900, height: 600 },
			width: 800, height: 1600 });
		expect(rect).toEqual({ left: 310, top: 20, width: 300, height: 600 });
		expect(pointInImage({ point: { x: 460, y: 320 }, rect })).toEqual([0.5, 0.5]);
		expect(pointInImage({ point: { x: 50, y: 320 }, rect })).toBeNull();
		expect(pointInImage({ point: { x: 900, y: 900 }, rect, clamp: true })).toEqual([1, 1]);
		const wide = imageContentRect({ bounds: { left: 10, top: 20, width: 600, height: 900 },
			width: 1600, height: 800 });
		expect(wide).toEqual({ left: 10, top: 320, width: 600, height: 300 });
		expect(pointInImage({ point: { x: 310, y: 470 }, rect: wide })).toEqual([0.5, 0.5]);
	});
	test("drag displacement clamps in source pixels for portrait, landscape and square photos", () => {
		for (const [width, height] of [[800, 1600], [1600, 800], [800, 800]]) {
			const result = clampStroke({ start: [0.5, 0.5], end: [0.9, 0.95], radius: 0.12, width, height });
			const distance = Math.hypot((result.end[0] - result.start[0]) * width,
				(result.end[1] - result.start[1]) * height);
			expect(distance).toBeLessThanOrEqual(Math.min(width, height) * 0.12 * 0.5);
			expect(distance).toBeGreaterThan(Math.min(width, height) * 0.12 * 0.499);
			expect(() => validateEdits({ edits: edits({ strokes: [result] }), photo: { width, height } })).not.toThrow();
			const zero = clampStroke({ start: [0, 1], end: [0, 1], radius: 0.02, width, height });
			expect(zero.end).toEqual(zero.start);
		}
	});
});
