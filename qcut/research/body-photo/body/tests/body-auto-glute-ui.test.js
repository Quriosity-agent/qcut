import { describe, expect, test } from "bun:test";
import { createBodyController } from "../web/body-controller.js";
import { automaticGluteDetection } from "../web/glute-contract.js";
import { createGluteEditor } from "../web/glute-editor.js";
import { copyEdits, emptyEdits, hasEdits, sameEdits, validateEdits } from "../web/edits-contract.js";
import { photoCatalog } from "./fixtures/body-photo-catalog.js";

const side = () => ({ view: "side-right", anchors: [{ peak: [0.65, 0.55], fold: [0.62, 0.66] }] });
const rear = () => ({ view: "rear", anchors: [
	{ peak: [0.4, 0.55], fold: [0.4, 0.66] }, { peak: [0.6, 0.55], fold: [0.6, 0.66] },
] });
const detectedPhoto = ({ selection = side(), available = true, reason = "" } = {}) => ({ width: 400, height: 800,
	buttocksDetection: { available, selection, confidence: 0.83, reason, method: "contour-estimate" } });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

class Element {
	constructor() {
		this.events = new Map(); this.attributes = new Map(); this.children = [];
		this.value = ""; this.textContent = ""; this.disabled = false;
		this.bounds = { left: 20, top: 30, width: 800, height: 600 };
	}
	addEventListener(name, listener) { this.events.set(name, [...(this.events.get(name) || []), listener]); }
	dispatch(name, event = {}) { for (const listener of this.events.get(name) || []) listener(event); }
	click() { if (!this.disabled) this.dispatch("click"); }
	append(child) { this.children.push(child); }
	replaceChildren(...children) { this.children = children; }
	setAttribute(name, value) { this.attributes.set(name, value); }
	getAttribute(name) { return this.attributes.get(name) ?? null; }
	removeAttribute(name) { this.attributes.delete(name); }
	set src(value) { this.setAttribute("src", value); }
	getBoundingClientRect() { return this.bounds; }
}

async function withEditor({ inspect, photos = [detectedPhoto()], catalog = photoCatalog(), render }) {
	const previousObserver = globalThis.ResizeObserver;
	globalThis.ResizeObserver = class { observe() {} disconnect() {} };
	const nodes = new Map();
	const root = { getElementById(id) {
		if (!nodes.has(id)) nodes.set(id, new Element());
		return nodes.get(id);
	}, createElement: () => new Element(), createElementNS: () => new Element() };
	const node = ({ id }) => root.getElementById(`glute-${id}`);
	node({ id: "view" }).value = "side-left";
	const requests = [];
	let uploadIndex = 0;
	const controller = createBodyController({ services: {
		catalog: async () => catalog,
		upload: async () => ({ photoId: `photo-${uploadIndex + 1}`, url: `/source-${uploadIndex + 1}.png`,
			...structuredClone(photos[Math.min(uploadIndex++, photos.length - 1)]) }),
		render: async (request) => {
			requests.push(structuredClone(request));
			const response = { ...request, status: request.values.ButtLift ? "applied" : "identity",
				result: { url: `/result-${requests.length}.png`, downloadUrl: `/download-${requests.length}.png` } };
			return render ? render({ request, response, index: requests.length }) : response;
		},
	} });
	const editor = createGluteEditor({ controller, root });
	const unsubscribe = controller.subscribe({ listener: (nextState) => editor.update({ nextState }) });
	const upload = () => controller.selectPhoto({ file: { name: "body.png" }, previewUrl: "blob:preview" });
	const apply = async () => { controller.apply(); await flush(); };
	const choose = ({ index }) => { node({ id: "point" }).value = String(index); node({ id: "point" }).dispatch("change"); };
	const coordinates = ({ x, y }) => { node({ id: "x" }).value = String(x); node({ id: "y" }).value = String(y); };
	const circles = () => node({ id: "overlay" }).children.filter((item) => item.getAttribute("r") === "5");
	try {
		await controller.initialize();
		await inspect({ controller, node, upload, apply, requests, choose, coordinates, circles });
	} finally { unsubscribe(); editor.dispose(); globalThis.ResizeObserver = previousObserver; }
}

describe("automatic glute import and manual correction", () => {
	test("import displays automatic anchors and directly renders the slider without sending client-selected anchors", async () => {
		await withEditor({ inspect: async ({ controller, node, upload, apply, requests, circles }) => {
			await upload();
			expect(controller.getState().edits).toEqual({ ...emptyEdits(), autoButtocks: true });
			expect(node({ id: "detection" }).textContent).toContain("83%");
			expect(node({ id: "view" }).value).toBe("side-right");
			expect(circles().map((item) => [item.getAttribute("cx"), item.getAttribute("cy")]))
				.toEqual([["445", "330"], ["436", "396"]]);
			controller.setValue({ name: "ButtLift", value: 85 });
			await apply();
			expect(requests[0].edits).toEqual({ ...emptyEdits(), autoButtocks: true });
			expect(requests[0].values.ButtLift).toBe(85);
			expect(requests[0].edits.buttocks).toBeUndefined();
			expect(controller.getState().downloadReady).toBe(true);
			const snapshot = controller.getState();
			snapshot.photo.buttocksDetection.selection.anchors[0].peak[0] = 0;
			snapshot.edits.autoButtocks = false;
			expect(controller.getState().photo.buttocksDetection.selection).toEqual(side());
			expect(controller.getState().edits.autoButtocks).toBe(true);
		} });
	});

	test("rear automatic points use the image content rectangle and can be individually corrected before saving", async () => {
		await withEditor({ photos: [detectedPhoto({ selection: rear() })], inspect: async ({ controller, node, upload,
			apply, requests, choose, coordinates, circles }) => {
			await upload();
			expect(circles()).toHaveLength(4);
			const before = circles().map((item) => item.getAttribute("cx"));
			node({ id: "stage" }).dispatch("pointerdown", { button: 0, clientX: 100, clientY: 300 });
			expect(circles().map((item) => item.getAttribute("cx"))).toEqual(before);
			controller.setValue({ name: "ButtLift", value: 100 }); await apply();
			choose({ index: 3 }); coordinates({ x: 61, y: 68 }); node({ id: "move" }).click();
			expect(circles()[3].getAttribute("cx")).toBe("433");
			expect(Number(circles()[3].getAttribute("cy"))).toBeCloseTo(408, 8);
			expect(controller.getState().downloadReady).toBe(true);
			expect(controller.getState().edits.buttocks).toBeUndefined();
			expect(node({ id: "message" }).textContent).toContain("保存校正");
			node({ id: "save" }).click();
			expect(controller.getState().downloadReady).toBe(false);
			expect(node({ id: "detection" }).textContent).toContain("手动校正");
			await apply();
			expect(requests[1].edits.autoButtocks).toBe(true);
			expect(requests[1].edits.buttocks.anchors[1].fold).toEqual([0.61, 0.68]);
			expect(controller.getState().photo.buttocksDetection.selection).toEqual(rear());
		} });
	});

	test("restoring automatic anchors removes manual override and invalidates its exported result", async () => {
		await withEditor({ inspect: async ({ controller, node, upload, apply, requests, choose, coordinates }) => {
			await upload(); choose({ index: 1 }); coordinates({ x: 63, y: 69 }); node({ id: "move" }).click();
			node({ id: "save" }).click(); controller.setValue({ name: "ButtLift", value: 75 }); await apply();
			expect(controller.getState().downloadReady).toBe(true);
			node({ id: "clear" }).click();
			expect(controller.getState().downloadReady).toBe(false);
			expect(controller.getState().edits).toEqual({ ...emptyEdits(), autoButtocks: true });
			choose({ index: 1 }); expect(node({ id: "y" }).value).toBe("66");
			await apply(); expect(requests[1].edits.buttocks).toBeUndefined();
			expect(controller.getState().downloadReady).toBe(true);
		} });
	});

	test("unavailable automatic analysis explains the reason and accepts a manual selection", async () => {
		await withEditor({ photos: [detectedPhoto({ available: false, reason: "臀下缘被遮挡" })],
			inspect: async ({ controller, node, upload, apply, requests, coordinates, circles }) => {
				await upload(); expect(circles()).toHaveLength(0);
				expect(node({ id: "detection" }).textContent).toContain("臀下缘被遮挡");
				node({ id: "view" }).value = "side-left"; node({ id: "view" }).dispatch("change");
				for (const [x, y] of [[35, 55], [38, 66]]) {
					coordinates({ x, y }); node({ id: "add" }).click();
				}
				node({ id: "save" }).click(); controller.setValue({ name: "ButtLift", value: 80 }); await apply();
				expect(requests[0].edits.buttocks).toEqual({ view: "side-left", anchors: [{ peak: [.35, .55], fold: [.38, .66] }] });
				expect(requests[0].edits.autoButtocks).toBe(true);
			} });
	});

	test("reset removes manual anchors and unsaved drafts while retaining automatic mode and zeroing the sliders", async () => {
		await withEditor({ inspect: async ({ controller, node, upload, choose, coordinates, circles }) => {
			await upload(); choose({ index: 1 }); coordinates({ x: 62, y: 70 }); node({ id: "move" }).click();
			controller.reset(); choose({ index: 1 }); expect(node({ id: "y" }).value).toBe("66");
			coordinates({ x: 63, y: 69 }); node({ id: "move" }).click(); node({ id: "save" }).click();
			controller.setValue({ name: "ButtLift", value: 100 }); controller.reset();
			expect(controller.getState().values.ButtLift).toBe(0);
			expect(controller.getState().edits).toEqual({ ...emptyEdits(), autoButtocks: true });
			expect(circles()).toHaveLength(2);
			choose({ index: 1 }); expect(node({ id: "y" }).value).toBe("66");
		} });
	});

	test("a saved correction defeats an older automatic render and its late response cannot re-enable export", async () => {
		let finish;
		await withEditor({ render: ({ response, index }) => index === 1 ? new Promise((resolve) => { finish = () => resolve(response); }) : response,
			inspect: async ({ controller, node, upload, apply, choose, coordinates, requests }) => {
				await upload(); controller.setValue({ name: "ButtLift", value: 100 }); await apply();
				choose({ index: 1 }); coordinates({ x: 63, y: 69 }); node({ id: "move" }).click(); node({ id: "save" }).click();
				finish(); await flush(); expect(controller.getState().downloadReady).toBe(false);
				await apply(); expect(requests[1].edits.buttocks.anchors[0].fold).toEqual([.63, .69]);
				expect(controller.getState().downloadReady).toBe(true);
			} });
	});

	test("new photos replace earlier automatic and manual points without carrying stale metadata or exports", async () => {
		await withEditor({ photos: [detectedPhoto(), detectedPhoto({ available: false, reason: "正面不适用" })],
			inspect: async ({ controller, node, upload, apply, circles }) => {
				await upload(); node({ id: "save" }).click(); controller.setValue({ name: "ButtLift", value: 100 }); await apply();
				await upload(); expect(circles()).toHaveLength(0); expect(controller.getState().downloadReady).toBe(false);
				expect(controller.getState().edits).toEqual({ ...emptyEdits(), autoButtocks: true });
				expect(node({ id: "detection" }).textContent).toContain("正面不适用");
			} });
	});

	test("invalid correction does not overwrite the automatic selection or its live result", async () => {
		await withEditor({ inspect: async ({ controller, node, upload, apply, choose, coordinates }) => {
			await upload(); controller.setValue({ name: "ButtLift", value: 80 }); await apply();
			choose({ index: 1 }); coordinates({ x: 62, y: 50 }); node({ id: "move" }).click();
			expect(node({ id: "message" }).textContent).toContain("臀下缘需要位于");
			expect(controller.getState().downloadReady).toBe(true);
			node({ id: "restart" }).click(); node({ id: "save" }).click();
			expect(controller.getState().edits.buttocks).toBeUndefined();
			expect(controller.getState().downloadReady).toBe(true);
			node({ id: "clear" }).click(); choose({ index: 1 }); expect(node({ id: "y" }).value).toBe("66");
		} });
	});

	test("legacy uploads preserve the old empty wire contract and native catalogs hide the automatic editor", async () => {
		for (const options of [{ photos: [{ width: 600, height: 900 }] }, { catalog: photoCatalog({ extended: false }) }]) {
			await withEditor({ ...options, inspect: async ({ controller, node, upload, apply, requests }) => {
				await upload(); expect(controller.getState().edits).toEqual(emptyEdits()); await apply();
				expect(requests[0].edits).toBeUndefined();
				if (options.catalog) expect(node({ id: "editor" }).hidden).toBe(true);
			} });
		}
	});
});

describe("automatic glute transport validation", () => {
	test("auto mode is optional and strictly boolean, including an explicit false", () => {
		const photo = detectedPhoto();
		for (const autoButtocks of [true, false]) {
			const edits = { ...emptyEdits(), autoButtocks };
			expect(validateEdits({ edits, photo })).toEqual(edits);
			expect(copyEdits({ edits })).toEqual(edits);
			expect(hasEdits({ edits })).toBe(true);
			expect(sameEdits({ left: edits, right: emptyEdits(), photo })).toBe(false);
		}
		for (const autoButtocks of [undefined, null, 1, "true", {}, []])
			expect(() => validateEdits({ edits: { ...emptyEdits(), autoButtocks }, photo })).toThrow();
		expect(copyEdits({ edits: emptyEdits() })).toEqual(emptyEdits());
	});

	test("missing or mismatched auto echo rejects a result even if values and manual anchors match", async () => {
		for (const mode of ["missing", "false"]) {
			await withEditor({ render: ({ response }) => {
				const { autoButtocks, ...edits } = response.edits;
				return { ...response, edits: mode === "missing" ? edits : { ...edits, autoButtocks: false } };
			}, inspect: async ({ controller, upload, apply }) => {
				await upload(); controller.setValue({ name: "ButtLift", value: 80 }); await apply();
				expect(controller.getState().downloadReady).toBe(false);
				expect(controller.getState().error).toContain("不匹配");
			} });
		}
	});

	test("malformed detection cannot create displayed or manual points and confidence is finite and bounded", () => {
		expect(automaticGluteDetection({ photo: {} })).toBeNull();
		for (const buttocksDetection of [null, [], { available: true }, { available: true, selection: { ...side(), anchors: [] } }]) {
			const detection = automaticGluteDetection({ photo: { buttocksDetection } });
			expect(detection.available).toBe(false); expect(detection.selection).toBeUndefined();
		}
		for (const confidence of [NaN, Infinity, -1, 1.1, "0.9"])
			expect(automaticGluteDetection({ photo: { buttocksDetection: { available: true, selection: side(), confidence } } }).confidence).toBeUndefined();
		const input = detectedPhoto(); const output = automaticGluteDetection({ photo: input });
		output.selection.anchors[0].peak[0] = 0;
		expect(input.buttocksDetection.selection).toEqual(side());
	});
});
