import { expect, test } from "bun:test";
import { validateGluteSelection } from "../web/glute-contract.js";
import { validateEdits, sameEdits, copyEdits, hasEdits } from "../web/edits-contract.js";
import { createBodyController } from "../web/body-controller.js";

const selection = () => ({ view: "side-left", anchors: [{ peak: [.4, .45], fold: [.44, .6] }] });
const edits = () => ({ backgroundProtection: true, strokes: [], buttocks: selection() });
const photo = { photoId: "source", width: 800, height: 1200, url: "/original.png" };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("contour contract canonicalizes rear order and preserves independent snapshots", () => {
	const rear = { view: "rear", anchors: [{ peak: [.7, .45], fold: [.7, .6] }, { peak: [.3, .45], fold: [.3, .6] }] };
	expect(validateGluteSelection({ selection: rear }).anchors[0].peak[0]).toBe(.3);
	expect(rear.anchors[0].peak[0]).toBe(.7);
	const original = edits();
	const copied = copyEdits({ edits: original });
	copied.buttocks.anchors[0].peak[0] = .2;
	expect(original.buttocks).toEqual(selection());
	expect(sameEdits({ left: original, right: copied, photo })).toBe(false);
	expect(hasEdits({ edits: { ...original, backgroundProtection: false } })).toBe(true);
});

test("invalid contour coordinates, overlap and unknown fields fail closed", () => {
	const bad = [null, {}, { ...selection(), extra: true }, { ...selection(), view: "front" },
		{ ...selection(), anchors: [] }, { view: "rear", anchors: [selection().anchors[0], selection().anchors[0]] }];
	for (const value of [true, NaN, Infinity, "0.4", -.01, 1.01])
		bad.push({ ...selection(), anchors: [{ peak: [value, .45], fold: [.44, .6] }] });
	bad.push({ ...selection(), anchors: [{ peak: [.4, .6], fold: [.4, .5] }] });
	for (const buttocks of bad) expect(() => validateEdits({ edits: { ...edits(), buttocks }, photo })).toThrow();
});

test("actual results require matching contour echo and edits invalidate old export", async () => {
	const runs = [];
	const controller = createBodyController({ services: {
		catalog: async () => ({ controls: [{ name: "ButtLift", title: "提臀", min: 0, max: 100, default: 0, step: 1 }], platform: { supported: true } }),
		upload: async () => photo,
		render: (request) => new Promise((resolve) => runs.push({ request, resolve })),
	} });
	await controller.initialize(); await controller.selectPhoto({ file: { name: "side.png" }, previewUrl: "blob:side" });
	controller.setValue({ name: "ButtLift", value: 70 }); controller.setEdits({ edits: edits() }); controller.apply();
	expect(runs[0].request.edits.buttocks).toEqual(selection());
	const response = { ...structuredClone(runs[0].request), status: "applied", result: { url: "/actual.png", downloadUrl: "/download.png" } };
	runs[0].resolve(response); await flush(); expect(controller.getState().downloadReady).toBe(true);
	const updated = edits(); updated.buttocks.anchors[0].fold[1] = .61;
	controller.setEdits({ edits: updated }); expect(controller.getState().downloadReady).toBe(false);
	controller.apply(); runs[1].resolve(response); await flush(); expect(controller.getState().downloadReady).toBe(false);
	expect(controller.getState().error).toContain("不匹配");
	controller.reset(); expect(controller.getState().edits.buttocks).toBeUndefined();
});
