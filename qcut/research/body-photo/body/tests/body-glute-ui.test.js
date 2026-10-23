import { describe, expect, test } from "bun:test";
import { photoCatalog } from "./fixtures/body-photo-catalog.js";

class UiElement {
	constructor() {
		this.dataset = {};
		this.style = { setProperty() {} };
		this.children = [];
		this.attributes = new Map();
		this.events = new Map();
		this.textContent = "";
		this.value = "0";
		this.disabled = false;
		this.bounds = { left: 20, top: 30, width: 600, height: 900 };
	}
	get childElementCount() { return this.children.length; }
	addEventListener(name, listener) {
		const listeners = this.events.get(name) || [];
		listeners.push(listener);
		this.events.set(name, listeners);
	}
	dispatch(name, event = {}) {
		for (const listener of this.events.get(name) || []) listener(event);
	}
	click() { if (!this.disabled) this.dispatch("click"); }
	append(...children) { this.children.push(...children); }
	replaceChildren(...children) { this.children = children; }
	setAttribute(name, value) { this.attributes.set(name, value); }
	getAttribute(name) { return this.attributes.get(name) ?? null; }
	removeAttribute(name) { this.attributes.delete(name); }
	set src(value) { this.setAttribute("src", value); }
	get src() { return this.getAttribute("src"); }
	set href(value) { this.setAttribute("href", value); }
	get href() { return this.getAttribute("href"); }
	closest() { return this; }
	getBoundingClientRect() { return this.bounds; }
}

function descendants({ node }) {
	return [node, ...node.children.flatMap((child) => descendants({ node: child }))];
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function withApp({ inspect, photo = { width: 600, height: 900 }, catalog = photoCatalog(), render }) {
	const previous = Object.fromEntries(["document", "ResizeObserver", "fetch", "setInterval", "clearInterval"]
		.map((name) => [name, globalThis[name]]));
	const nodes = new Map();
	const document = {
		getElementById(id) {
			if (!nodes.has(id)) nodes.set(id, new UiElement());
			return nodes.get(id);
		},
		createElement: () => new UiElement(),
		createElementNS: () => new UiElement(),
	};
	for (const [id, value] of [["glute-view", "side-left"], ["glute-x", "50"], ["glute-y", "60"],
		["manual-radius", "10"], ["manual-x", "50"], ["manual-y", "50"]]) document.getElementById(id).value = value;
	const requests = [];
	const intervals = new Map();
	let uploadCount = 0;
	let timerId = 0;
	globalThis.document = document;
	globalThis.ResizeObserver = class { observe() {} disconnect() {} };
	globalThis.setInterval = (callback) => { intervals.set(++timerId, callback); return timerId; };
	globalThis.clearInterval = (id) => intervals.delete(id);
	globalThis.fetch = async (url, options) => {
		if (url === "/api/catalog") return { ok: true, json: async () => catalog };
		if (url === "/api/photos") return { ok: true, json: async () => ({
			photoId: `photo-${++uploadCount}`, url: `/source-${uploadCount}.png`, ...photo,
		}) };
		if (url !== "/api/render") throw new Error(`Unexpected URL: ${url}`);
		const request = JSON.parse(options.body);
		requests.push(request);
		const response = render ? await render({ request }) : {
			...request, status: request.values.ButtLift ? "applied" : "identity", milliseconds: 50,
			result: { url: `/result-${requests.length}.png`, downloadUrl: `/download-${requests.length}.png`, ...photo },
		};
		return { ok: true, json: async () => response };
	};
	function node({ id }) {
		return nodes.get(id) || descendants({ node: nodes.get("slider-controls") }).find((item) => item.id === id);
	}
	function input({ id, value }) {
		const target = node({ id });
		target.value = String(value);
		target.dispatch("input");
	}
	function add({ x, y }) {
		input({ id: "glute-x", value: x });
		input({ id: "glute-y", value: y });
		node({ id: "glute-add" }).click();
	}
	async function upload() {
		node({ id: "photo-file" }).files = [new File(["fixture"], "body.png", { type: "image/png" })];
		node({ id: "photo-file" }).dispatch("change");
		await flush();
	}
	async function apply() {
		node({ id: "body-form" }).dispatch("submit", { preventDefault() {} });
		await flush();
	}
	try {
		await import(`../web/app.js?glute-ui-test=${crypto.randomUUID()}`);
		await flush();
		await inspect({ node, input, add, upload, apply, requests, intervals });
	} finally {
		intervals.clear();
		Object.assign(globalThis, previous);
	}
}

async function saveSide({ add, node, view = "side-left", foldY = 66 }) {
	node({ id: "glute-view" }).value = view;
	node({ id: "glute-view" }).dispatch("change");
	add({ x: 65, y: 56 });
	add({ x: 67, y: foldY });
	node({ id: "glute-save" }).click();
}

function expectStaleHidden({ node, intervals }) {
	expect(node({ id: "download" }).hidden).toBe(true);
	expect(node({ id: "download" }).href).toBeNull();
	expect(node({ id: "result-layer" }).hidden).toBe(true);
	expect(node({ id: "view-blink" }).disabled).toBe(true);
	expect(intervals.size).toBe(0);
}

describe("manual glute selection in the body application", () => {
	test("both side directions save the displayed points into the actual render request", async () => {
		for (const view of ["side-left", "side-right"]) {
			await withApp({ inspect: async ({ node, input, add, upload, apply, requests }) => {
				expect(node({ id: "glute-save" }).disabled).toBe(true);
				await upload();
				await saveSide({ add, node, view });
				node({ id: "background-protection" }).checked = true;
				node({ id: "background-protection" }).dispatch("change");
				input({ id: "range-ButtLift", value: 80 });
				await apply();
				expect(requests[0].edits).toEqual({ backgroundProtection: true, strokes: [],
					buttocks: { view, anchors: [{ peak: [0.65, 0.56], fold: [0.67, 0.66] }] } });
				expect(requests[0].values.ButtLift).toBe(80);
				expect(node({ id: "result-image" }).src).toBe("/result-1.png");
				expect(node({ id: "download" }).href).toBe("/download-1.png");
			} });
		}
	});

	test("rear clicks ignore letterbox margins and preserve original-image coordinates in both SVG and request", async () => {
		await withApp({ photo: { width: 400, height: 800 }, inspect: async ({ node, input, upload, apply, requests }) => {
			await upload();
			node({ id: "glute-view" }).value = "rear";
			node({ id: "glute-view" }).dispatch("change");
			const bounds = { left: 20, top: 30, width: 800, height: 600 };
			for (const id of ["glute-stage", "glute-source"]) node({ id }).bounds = bounds;
			node({ id: "glute-stage" }).dispatch("pointerdown", { button: 0, clientX: 100, clientY: 300 });
			expect(node({ id: "glute-overlay" }).children).toHaveLength(0);
			for (const [x, y] of [[0.4, 0.55], [0.4, 0.65], [0.6, 0.55], [0.6, 0.65]]) {
				node({ id: "glute-stage" }).dispatch("pointerdown", {
					button: 0, clientX: 270 + x * 300, clientY: 30 + y * 600,
				});
			}
			const circles = node({ id: "glute-overlay" }).children.filter((child) => child.getAttribute("r") === "5");
			expect(circles.map((circle) => [circle.getAttribute("cx"), circle.getAttribute("cy")]))
				.toEqual([["370", "330"], ["370", "390"], ["430", "330"], ["430", "390"]]);
			node({ id: "glute-save" }).click();
			input({ id: "range-ButtLift", value: 100 });
			await apply();
			expect(requests[0].edits.buttocks).toEqual({ view: "rear", anchors: [
				{ peak: [0.4, 0.55], fold: [0.4, 0.65] }, { peak: [0.6, 0.55], fold: [0.6, 0.65] },
			] });
		} });
	});

	test("incomplete or inverted point entry is rejected in the UI without silently saving a selection", async () => {
		await withApp({ inspect: async ({ node, input, add, upload, apply, requests }) => {
			await upload();
			add({ x: 65, y: 56 });
			add({ x: 67, y: 50 });
			expect(node({ id: "glute-message" }).textContent).toContain("臀下缘需要位于");
			expect(node({ id: "glute-overlay" }).children).toHaveLength(2);
			node({ id: "glute-save" }).click();
			expect(node({ id: "glute-message" }).textContent).toContain("定位点");
			input({ id: "range-ButtLift", value: 100 });
			await apply();
			expect(requests[0].edits).toBeUndefined();
		} });
	});

	test("a saved anchor revision stops blink, discards the old result and sends the new points", async () => {
		await withApp({ inspect: async ({ node, input, add, upload, apply, requests, intervals }) => {
			await upload();
			await saveSide({ add, node });
			input({ id: "range-ButtLift", value: 100 });
			await apply();
			node({ id: "view-blink" }).click();
			expect(intervals.size).toBe(1);
			expect(node({ id: "image-stage" }).dataset.view).toBe("original");
			for (const tick of intervals.values()) tick();
			expect(node({ id: "image-stage" }).dataset.view).toBe("result");
			expect(node({ id: "result-layer" }).style.clipPath).toBe("none");
			node({ id: "glute-undo" }).click();
			add({ x: 68, y: 69 });
			node({ id: "glute-save" }).click();
			expectStaleHidden({ node, intervals });
			await apply();
			expect(requests[1].edits.buttocks.anchors[0].fold).toEqual([0.68, 0.69]);
			expect(node({ id: "result-image" }).src).toBe("/result-2.png");
			expect(node({ id: "image-stage" }).dataset.view).toBe("compare");
			expect(node({ id: "result-layer" }).style.clipPath).toBe("inset(0 0 0 50%)");
		} });
	});

	test("an older render cannot re-enable comparison after the saved anchors change", async () => {
		let finishFirst;
		let count = 0;
		await withApp({ render: ({ request }) => {
			const response = { ...request, status: "applied", result: {
				url: `/delayed-${++count}.png`, downloadUrl: `/delayed-download-${count}.png`, width: 600, height: 900,
			} };
			return count === 1 ? new Promise((resolve) => { finishFirst = () => resolve(response); }) : response;
		}, inspect: async ({ node, input, add, upload, apply, requests, intervals }) => {
			await upload();
			await saveSide({ add, node });
			input({ id: "range-ButtLift", value: 100 });
			await apply();
			expect(node({ id: "view-blink" }).disabled).toBe(true);
			node({ id: "glute-undo" }).click();
			add({ x: 68, y: 69 });
			node({ id: "glute-save" }).click();
			finishFirst();
			await flush();
			expectStaleHidden({ node, intervals });
			await apply();
			expect(requests[1].edits.buttocks.anchors[0].fold).toEqual([0.68, 0.69]);
			expect(node({ id: "result-image" }).src).toBe("/delayed-2.png");
			expect(node({ id: "view-blink" }).disabled).toBe(false);
		} });
	});

	test("zero, reset and a new photo each clear stale blink and download state", async () => {
		await withApp({ inspect: async ({ node, input, add, upload, apply, requests, intervals }) => {
			await upload();
			await saveSide({ add, node });
			input({ id: "range-ButtLift", value: 100 });
			await apply();
			node({ id: "view-blink" }).click();
			input({ id: "range-ButtLift", value: 0 });
			expectStaleHidden({ node, intervals });
			await apply();
			expect(requests[1].values.ButtLift).toBe(0);
			expect(node({ id: "status-title" }).textContent).toContain("输出保留原图");
			node({ id: "view-blink" }).click();
			node({ id: "reset" }).click();
			expectStaleHidden({ node, intervals });
			expect(node({ id: "glute-overlay" }).children).toHaveLength(0);
			await apply();
			expect(requests[2].edits).toBeUndefined();
			await saveSide({ add, node });
			input({ id: "range-ButtLift", value: 80 });
			await apply();
			node({ id: "view-blink" }).click();
			await upload();
			expectStaleHidden({ node, intervals });
			expect(node({ id: "glute-overlay" }).children).toHaveLength(0);
			await apply();
			expect(requests.at(-1).photoId).toBe("photo-2");
			expect(requests.at(-1).edits).toBeUndefined();
			expect(requests.at(-1).values.ButtLift).toBe(0);
		} });
	});

	test("leaving blink cancels the interval and native catalogs keep the new editor hidden", async () => {
		await withApp({ inspect: async ({ node, input, upload, apply, intervals }) => {
			await upload();
			input({ id: "range-ButtLift", value: 80 });
			await apply();
			node({ id: "view-blink" }).click();
			expect(intervals.size).toBe(1);
			node({ id: "view-original" }).click();
			expect(intervals.size).toBe(0);
			expect(node({ id: "image-stage" }).dataset.view).toBe("original");
		} });
		await withApp({ catalog: photoCatalog({ extended: false }), inspect: async ({ node }) => {
			expect(node({ id: "glute-editor" }).hidden).toBe(true);
		} });
	});
});
