import { describe, expect, test } from "bun:test";
import { createBodyController, getControlFeedback, getControlGroups, getSliderPresentation } from "../web/body-controller.js";
import { extraControls, photoCatalog, photoGroups } from "./fixtures/body-photo-catalog.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function fixture({ catalog = photoCatalog(), render } = {}) {
	const requests = [];
	const controller = createBodyController({ services: {
		catalog: async () => catalog,
		upload: async () => ({ photoId: "one", url: "/original.png", width: 600, height: 900 }),
		render: async (request) => {
			requests.push(request);
			return render ? render(request) : { ...request, status: "applied",
				result: { url: "/result.png", downloadUrl: "/export.png" },
				controls: Object.fromEntries(Object.entries(request.values).map(([name, requested]) =>
					[name, { requested, applied: requested !== 0, message: "实际计算完成" }])) };
		},
	} });
	await controller.initialize();
	await controller.selectPhoto({ file: { name: "sample.png" }, previewUrl: "blob:source" });
	return { controller, requests };
}

describe("dynamic photo control groups", () => {
	test("groups all 21 CPU controls once in declared order without inventing Metal controls", () => {
		const cpu = photoCatalog();
		const groups = getControlGroups({ catalog: cpu });
		expect(groups.map((group) => group.id)).toEqual(photoGroups.map((group) => group.id));
		expect(groups.map((group) => group.controls.length)).toEqual([2, 5, 2, 3, 5, 4]);
		const names = groups.flatMap((group) => group.controls.map((control) => control.name));
		expect(new Set(names).size).toBe(21);
		expect(names.toSorted()).toEqual(cpu.controls.map((control) => control.name).toSorted());
		const metal = getControlGroups({ catalog: photoCatalog({ extended: false }) });
		expect(metal.flatMap((group) => group.controls)).toHaveLength(12);
		expect(metal.some((group) => group.id === "skin")).toBe(false);
	});

	test("honors server group order and title, retains unknown controls, and omits empty groups", () => {
		const catalog = photoCatalog();
		catalog.groups = [{ id: "skin", title: "肤色" }, { id: "custom", title: "自定义部位" },
			{ id: "empty", title: "未启用" }];
		catalog.controls = [{ ...extraControls[0], group: "custom" }, extraControls[5],
			{ ...extraControls[1], name: "FutureControl", group: "future" }];
		const groups = getControlGroups({ catalog });
		expect(groups.map((group) => group.id)).toEqual(["skin", "custom", "future"]);
		expect(groups.map((group) => group.title)).toEqual(["肤色", "自定义部位", "其他调整"]);
		expect(groups[2].controls[0].name).toBe("FutureControl");
	});

	test("catalog snapshots and the service object cannot mutate validated groups", async () => {
		const catalog = photoCatalog();
		const { controller } = await fixture({ catalog });
		catalog.groups[0].title = "mutated";
		catalog.controls[12].group = "skin";
		const snapshot = controller.getState();
		snapshot.catalog.groups[1].title = "mutated";
		snapshot.catalog.controls[12].note = "mutated";
		expect(controller.getState().catalog.groups).toEqual(photoGroups);
		expect(controller.getState().catalog.controls[12].group).toBe("abdomen");
		expect(controller.getState().catalog.controls[12].note).toBe(extraControls[0].note);
	});

	test("invalid optional metadata fails closed before a render", async () => {
		const catalogs = [
			{ ...photoCatalog(), groups: {} },
			{ ...photoCatalog(), groups: [null] },
			{ ...photoCatalog(), groups: [photoGroups[0], photoGroups[0]] },
			{ ...photoCatalog(), groups: [{ id: "skin", title: " " }] },
			{ ...photoCatalog(), groups: [{ id: "../skin", title: "皮肤" }] },
			{ ...photoCatalog(), controls: [{ ...extraControls[0], group: {} }] },
			{ ...photoCatalog(), controls: [{ ...extraControls[0], note: {} }] },
		];
		await Promise.all(catalogs.map(async (catalog) => {
			const { controller, requests } = await fixture({ catalog });
			controller.apply();
			expect(controller.getState().catalog).toBeNull();
			expect(controller.getState().downloadReady).toBe(false);
			expect(requests).toHaveLength(0);
		}));
	});
});

describe("expanded photo controls and real result receipts", () => {
	for (const control of extraControls) {
		test(`${control.name} respects bounds, sends all 21 fields and invalidates its previous PNG`, async () => {
			const { controller, requests } = await fixture();
			controller.setValue({ name: control.name, value: -999 });
			expect(controller.getState().values[control.name]).toBe(control.min);
			controller.setValue({ name: control.name, value: 999 });
			expect(controller.getState().values[control.name]).toBe(control.max);
			const value = control.min < 0 ? -40 : 100;
			controller.setValue({ name: control.name, value });
			controller.apply();
			await flush();
			expect(Object.keys(requests[0].values)).toHaveLength(21);
			expect(requests[0].values[control.name]).toBe(value);
			expect(controller.getState().downloadReady).toBe(true);
			expect(getControlFeedback({ state: controller.getState(), control }).status).toBe("applied");
			controller.setValue({ name: control.name, value: value + (value < 0 ? 1 : -1) });
			expect(controller.getState().downloadReady).toBe(false);
			expect(controller.getState().result).toBeNull();
			expect(getControlFeedback({ state: controller.getState(), control }).text).toBe("待应用");
			controller.reset();
			expect(Object.values(controller.getState().values).every((item) => item === 0)).toBe(true);
		});
	}

	test("new signed skin values expose real bounds, neutral center and skin-specific zero meaning", () => {
		for (const control of extraControls.filter((item) => item.group === "skin")) {
			const zero = getSliderPresentation({ control, value: 0 });
			expect(zero.valueText).toContain("0 表示保留原始肤色和纹理");
			expect(zero.valueText).toContain(`范围 ${control.min} 至 ${control.max}`);
			expect(zero.fill).toBe(control.min < 0 ? "50%" : "0%");
			if (control.min < 0) expect(getSliderPresentation({ control, value: -25 }).fill).toBe("25%");
		}
	});

	test("partial receipt keeps skipped controls explicit and missing feedback never implies success", async () => {
		const abdomen = extraControls[0];
		const skin = extraControls[5];
		const { controller } = await fixture({ render: (request) => ({ ...request, status: "partial",
			result: { url: "/partial.png", downloadUrl: "/partial.png" },
			controls: { Abdomen: { requested: 100, applied: true, message: "局部形变已执行" },
				BodySkinTone: { requested: -40, applied: false, message: "未找到可信的身体皮肤" } } }) });
		controller.setValue({ name: "Abdomen", value: 100 });
		controller.setValue({ name: "BodySkinTone", value: -40 });
		controller.setValue({ name: "ButtLift", value: 50 });
		controller.apply();
		await flush();
		const state = controller.getState();
		expect(state.downloadReady).toBe(true);
		expect(getControlFeedback({ state, control: abdomen }).text).toBe("已执行处理");
		expect(getControlFeedback({ state, control: skin })).toEqual({ status: "unavailable", text: "未应用", message: "未找到可信的身体皮肤" });
		expect(getControlFeedback({ state, control: extraControls[1] }).status).toBe("unknown");
	});

	test("a response missing a CPU-only field cannot enable export", async () => {
		const { controller } = await fixture({ render: (request) => {
			const { BodyBlemish: omitted, ...values } = request.values;
			expect(omitted).toBe(80);
			return { ...request, values, status: "applied", result: { downloadUrl: "/bad.png" } };
		} });
		controller.setValue({ name: "BodyBlemish", value: 80 });
		controller.apply();
		await flush();
		expect(controller.getState().error).toContain("不匹配");
		expect(controller.getState().downloadReady).toBe(false);
	});

	test("late CPU results cannot overwrite another skin setting or enable a stale download", async () => {
		let finish;
		const { controller, requests } = await fixture({ render: (request) =>
			new Promise((resolve) => { finish = () => resolve({ ...request, status: "applied",
				result: { downloadUrl: "/stale.png" } }); }) });
		controller.setValue({ name: "BodySkinWarmth", value: -50 });
		controller.apply();
		controller.setValue({ name: "BodySkinWarmth", value: 50 });
		finish();
		await flush();
		expect(requests).toHaveLength(1);
		expect(controller.getState().result).toBeNull();
		expect(controller.getState().downloadReady).toBe(false);
	});
});
