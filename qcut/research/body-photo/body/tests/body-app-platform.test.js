import { describe, expect, test } from "bun:test";
import { photoCatalog } from "./fixtures/body-photo-catalog.js";

class Element {
	constructor() {
		this.dataset = {};
		this.style = { setProperty() {} };
		this.children = [];
		this.attributes = new Map();
		this.events = new Map();
		this.textContent = "";
		this.value = "0";
	}
	get childElementCount() { return this.children.length; }
	addEventListener(name, listener) { this.events.set(name, listener); }
	dispatch(name, event = {}) { this.events.get(name)?.(event); }
	append(...children) { this.children.push(...children); }
	replaceChildren(...children) { this.children = children; }
	setAttribute(name, value) { this.attributes.set(name, value); }
	getAttribute(name) { return this.attributes.get(name) ?? null; }
	removeAttribute(name) { this.attributes.delete(name); }
	set href(value) { this.setAttribute("href", value); }
	get href() { return this.getAttribute("href"); }
	closest() { return this; }
	getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 900 }; }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function descendants({ node }) {
	return [node, ...node.children.flatMap((child) => descendants({ node: child }))];
}

async function renderBadge({ platform, rejectCatalog = false, catalog, inspect, render }) {
	const previous = {
		document: globalThis.document,
		ResizeObserver: globalThis.ResizeObserver,
		fetch: globalThis.fetch,
	};
	const nodes = new Map();
	const document = {
		getElementById(id) {
			if (!nodes.has(id)) nodes.set(id, new Element());
			return nodes.get(id);
		},
		createElement: () => new Element(),
		createElementNS: () => new Element(),
	};
	let respond;
	globalThis.document = document;
	globalThis.ResizeObserver = class { observe() {} disconnect() {} };
	globalThis.fetch = (url, options) => {
		if (url === "/api/photos") return Promise.resolve({ ok: true, json: async () => ({
			photoId: "photo", url: "/original.png", width: 600, height: 900,
		}) });
		if (url === "/api/render") return Promise.resolve({ ok: true, json: async () => render(JSON.parse(options.body)) });
		return new Promise((resolve) => { respond = resolve; });
	};
	try {
		await import(`../web/app.js?platform-test=${crypto.randomUUID()}`);
		const badge = nodes.get("engine-badge");
		const loading = badge.textContent;
		respond({
			ok: !rejectCatalog,
			json: async () => rejectCatalog ? { error: { message: "模型缺失" } } : catalog || {
				controls: [{ name: "SlimWaist", title: "瘦腰", min: 0, max: 100, step: 1, default: 0 }],
				platform,
			},
		});
		await flush();
		if (inspect) await inspect({ nodes, document });
		return { loading, text: badge.textContent, ready: badge.dataset.ready, title: badge.title };
	} finally {
		Object.assign(globalThis, previous);
	}
}

describe("body app platform status", () => {
	test("uses the selected CPU backend rather than assuming the host is Metal", async () => {
		expect(await renderBadge({
			platform: { supported: true, backend: "portable-CPU", message: "CPU ready" },
		})).toEqual({
			loading: "检查引擎中", text: "CPU 引擎就绪", ready: "true", title: "CPU ready",
		});
	});

	test("retains the existing Metal label for the Mac backend", async () => {
		const badge = await renderBadge({
			platform: { supported: true, backend: "macOS-Metal", message: "Metal ready" },
		});
		expect(badge.text).toBe("Metal 引擎就绪");
		expect(badge.ready).toBe("true");
	});

	test("never reports a ready backend when unsupported or catalog lookup fails", async () => {
		for (const options of [
			{ platform: { supported: false, backend: "portable-CPU", message: "不可用" } },
			{ rejectCatalog: true },
		]) {
			const badge = await renderBadge(options);
			expect(badge.text).toBe("引擎暂不可用");
			expect(badge.ready).toBe("false");
		}
	});

	test("an older catalog without a backend does not invent one", async () => {
		const badge = await renderBadge({ platform: { supported: true } });
		expect(badge.text).toBe("引擎就绪");
	});
});

describe("body app grouped controls", () => {
	test("CPU groups expose only declared controls, native summaries, notes and accessible signed bounds", async () => {
		await renderBadge({ catalog: photoCatalog(), inspect: async ({ nodes }) => {
			const groups = nodes.get("slider-controls").children;
			expect(groups.map((group) => group.dataset.group)).toEqual(["proportion", "upper", "abdomen", "buttocks", "legs", "skin"]);
			expect(groups.filter((group) => group.open)).toHaveLength(1);
			expect(nodes.get("catalog-summary").textContent).toContain("21 项");
			expect(nodes.get("skin-scope").hidden).toBe(false);
			const all = descendants({ node: nodes.get("slider-controls") });
			expect(all.filter((node) => node.type === "range")).toHaveLength(21);
			expect(all.some((node) => node.textContent === "臀型宽度 · 2D轮廓")).toBe(true);
			const range = all.find((node) => node.id === "range-BodySkinTone");
			expect([range.min, range.max, range.value]).toEqual(["-50", "50", "0"]);
			expect(range.getAttribute("aria-valuetext")).toContain("原始肤色和纹理");
			expect(range.getAttribute("aria-describedby")).toBe("note-BodySkinTone feedback-BodySkinTone");
			const number = all.find((node) => node.id === "number-BodySkinTone");
			expect(number.inputMode).toBe("text");
			expect(number.disabled).toBe(true);
		} });
	});

	test("Metal catalog keeps 12 controls without CPU-only cards or skin claims", async () => {
		await renderBadge({ catalog: photoCatalog({ extended: false }), inspect: async ({ nodes }) => {
			const all = descendants({ node: nodes.get("slider-controls") });
			expect(all.filter((node) => node.type === "range")).toHaveLength(12);
			expect(all.some((node) => node.id === "range-ButtShape")).toBe(false);
			expect(nodes.get("skin-scope").hidden).toBe(true);
			expect(nodes.get("catalog-summary").textContent).toContain("12 项");
		} });
	});

	test("negative input, partial receipts, real half-image and stale download invalidation stay synchronized", async () => {
		const requests = [];
		await renderBadge({ catalog: photoCatalog(), render: (request) => {
			requests.push(request);
			return { ...request, status: "partial", milliseconds: 200,
				result: { url: "/actual.png", downloadUrl: "/actual-download.png", width: 600, height: 900 },
				controls: { BodySkinTone: { requested: -40, applied: true, message: "已执行皮肤调色" },
					ButtLift: { requested: 100, applied: false, message: "臀部不可用" },
					SlimWaist: { requested: 0, applied: false, message: "未启用。" } } };
		}, inspect: async ({ nodes, document }) => {
			const all = descendants({ node: nodes.get("slider-controls") });
			const number = all.find((node) => node.id === "number-BodySkinTone");
			const lift = all.find((node) => node.id === "range-ButtLift");
			const file = new File(["fixture"], "body.png", { type: "image/png" });
			nodes.get("photo-file").files = [file];
			nodes.get("photo-file").dispatch("change");
			await flush();
			expect(number.disabled).toBe(false);
			document.activeElement = number;
			number.value = "-40";
			number.dispatch("input");
			lift.value = "100";
			lift.dispatch("input");
			expect(requests).toHaveLength(0);
			expect(all.find((node) => node.id === "feedback-BodySkinTone").textContent).toBe("待应用");
			const skinGroup = nodes.get("slider-controls").children.find((group) => group.dataset.group === "skin");
			expect(skinGroup.children[0].children[1].textContent).toBe("1 项已设值 / 4");
			skinGroup.open = true;
			nodes.get("body-form").dispatch("submit", { preventDefault() {} });
			await flush();
			expect(requests[0].values.BodySkinTone).toBe(-40);
			expect(Object.keys(requests[0].values)).toHaveLength(21);
			expect(nodes.get("download").hidden).toBe(false);
			expect(nodes.get("download").href).toBe("/actual-download.png");
			expect(nodes.get("result-image").src).toBe("/actual.png");
			expect(nodes.get("image-stage").dataset.view).toBe("compare");
			expect(nodes.get("result-layer").style.clipPath).toBe("inset(0 0 0 50%)");
			expect(all.find((node) => node.id === "feedback-BodySkinTone").textContent).toContain("已执行处理");
			expect(all.find((node) => node.id === "feedback-ButtLift").textContent).toBe("未应用 · 臀部不可用");
			expect(nodes.get("control-feedback").children).toHaveLength(2);
			nodes.get("wipe-position").value = "32";
			nodes.get("wipe-position").dispatch("input");
			expect(nodes.get("result-layer").style.clipPath).toBe("inset(0 0 0 32%)");
			number.value = "-30";
			number.dispatch("input");
			expect(nodes.get("download").hidden).toBe(true);
			expect(nodes.get("download").href).toBeNull();
			expect(nodes.get("result-layer").hidden).toBe(true);
			expect(nodes.get("slider-controls").children.find((group) => group.dataset.group === "skin")).toBe(skinGroup);
			expect(skinGroup.open).toBe(true);
			expect(requests).toHaveLength(1);
		} });
	});
});
