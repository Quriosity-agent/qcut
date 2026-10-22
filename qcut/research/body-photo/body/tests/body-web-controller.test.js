import { describe, expect, test } from "bun:test";
import { createBodyController, getSliderPresentation } from "../web/body-controller.js";

const originalNames = ["StretchLeg", "SlimWaist", "SmallHead"];
const fiveNames = [...originalNames, "SlimBody", "SlimArm"];
const legNames = ["ThighWidth", "CalfWidth"];
const signedNames = ["ShoulderWidth", "HipWidth", "BustSize", ...legNames];
const tenNames = [...fiveNames, "ShoulderWidth", "OrthoShoulder", "SwanNeck", "HipWidth", "BustSize"];
const newNames = [...tenNames.slice(fiveNames.length), ...legNames];
const names = [...fiveNames, ...newNames];
const controls = ({ selected = names } = {}) => selected.map((name) => ({
	name, title: name, min: signedNames.includes(name) ? -50 : 0, max: signedNames.includes(name) ? 50 : 100, default: 0, step: 1,
}));
const zeros = () => Object.fromEntries(names.map((name) => [name, 0]));
const photo = ({ id }) => ({ photoId: id, url: `/api/photos/${id}.png`, width: 720, height: 1280 });
const deferred = () => {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function result({ request, status = "applied" }) {
	return {
		...request,
		status,
		message: status,
		result: { url: `/api/renders/${request.photoId}.png`, downloadUrl: `/api/download/${request.photoId}.png` },
		controls: {},
	};
}

async function fixture({ upload, supported = true, catalogControls = controls() } = {}) {
	const renders = [];
	const controller = createBodyController({
		services: {
			catalog: async () => ({ controls: catalogControls, platform: { supported, message: "平台不可用" } }),
			upload: upload || (async ({ file }) => photo({ id: file.name })),
			render: (request) => {
				const pending = deferred();
				renders.push({ request, ...pending });
				return pending.promise;
			},
		},
	});
	await controller.initialize();
	await controller.selectPhoto({ file: { name: "first" }, previewUrl: "blob:first" });
	return { controller, renders };
}

describe("body photo editor state", () => {
	test("uses explicit Apply and exports only matching actual results", async () => {
		const { controller, renders } = await fixture();
		controller.setValue({ name: "StretchLeg", value: 80 });
		expect(renders).toHaveLength(0);
		expect(controller.getState().downloadReady).toBe(false);
		controller.apply();
		expect(renders[0].request).toEqual({ photoId: "first", values: { ...zeros(), StretchLeg: 80 } });
		renders[0].resolve(result({ request: renders[0].request }));
		await flush();
		expect(controller.getState().downloadReady).toBe(true);
		controller.setValue({ name: "SlimWaist", value: 55 });
		expect(controller.getState().downloadReady).toBe(false);
		expect(controller.getState().result).toBeNull();
	});

	test("one render runs at a time and queued requests keep only latest changes", async () => {
		const { controller, renders } = await fixture();
		controller.setValue({ name: "StretchLeg", value: 10 });
		controller.apply();
		controller.setValue({ name: "StretchLeg", value: 40 });
		controller.apply();
		controller.setValue({ name: "StretchLeg", value: 90 });
		controller.setValue({ name: "SmallHead", value: 65 });
		controller.setValue({ name: "SlimBody", value: 75 });
		controller.setValue({ name: "SlimArm", value: 60 });
		controller.setValue({ name: "ShoulderWidth", value: -35 });
		controller.setValue({ name: "OrthoShoulder", value: 70 });
		controller.setValue({ name: "SwanNeck", value: 60 });
		controller.setValue({ name: "HipWidth", value: 30 });
		controller.setValue({ name: "BustSize", value: -20 });
		controller.setValue({ name: "ThighWidth", value: -40 });
		controller.setValue({ name: "CalfWidth", value: 35 });
		controller.apply();
		controller.setValue({ name: "SlimArm", value: 83 });
		controller.setValue({ name: "HipWidth", value: -28 });
		controller.setValue({ name: "ThighWidth", value: -32 });
		controller.setValue({ name: "CalfWidth", value: 48 });
		expect(renders).toHaveLength(1);
		expect(controller.getState().queued).toBe(true);
		renders[0].resolve(result({ request: renders[0].request }));
		await flush();
		expect(renders).toHaveLength(2);
		expect(renders[1].request.values).toEqual({
			...zeros(), StretchLeg: 90, SmallHead: 65, SlimBody: 75, SlimArm: 83,
			ShoulderWidth: -35, OrthoShoulder: 70, SwanNeck: 60, HipWidth: -28, BustSize: -20,
			ThighWidth: -32, CalfWidth: 48,
		});
		expect(controller.getState().downloadReady).toBe(false);
		renders[1].resolve(result({ request: renders[1].request }));
		await flush();
		expect(controller.getState().downloadReady).toBe(true);
	});

	test("new photos during render discard old results and old queued work", async () => {
		const { controller, renders } = await fixture();
		controller.setValue({ name: "SlimWaist", value: 50 });
		controller.apply();
		controller.setValue({ name: "SlimWaist", value: 75 });
		controller.setValue({ name: "SlimBody", value: 100 });
		controller.setValue({ name: "SlimArm", value: 90 });
		controller.setValue({ name: "ThighWidth", value: -50 });
		controller.setValue({ name: "CalfWidth", value: 50 });
		controller.apply();
		await controller.selectPhoto({ file: { name: "second" }, previewUrl: "blob:second" });
		expect(controller.getState().values).toEqual(zeros());
		controller.setValue({ name: "SmallHead", value: 30 });
		controller.setValue({ name: "SlimArm", value: 47 });
		controller.setValue({ name: "CalfWidth", value: -25 });
		controller.apply();
		renders[0].resolve(result({ request: renders[0].request }));
		await flush();
		expect(renders).toHaveLength(2);
		expect(renders[1].request.photoId).toBe("second");
		expect(renders[1].request.values).toEqual({ ...zeros(), SmallHead: 30, SlimArm: 47, CalfWidth: -25 });
		expect(controller.getState().result).toBeNull();
		renders[1].resolve(result({ request: renders[1].request }));
		await flush();
		expect(controller.getState().result.photoId).toBe("second");
	});

	test("late uploads cannot replace a newer photo", async () => {
		const first = deferred();
		const second = deferred();
		const controller = createBodyController({
			services: {
				catalog: async () => ({ controls: controls(), platform: { supported: true } }),
				upload: ({ file }) => file.name === "one" ? first.promise : second.promise,
				render: async () => { throw new Error("not used"); },
			},
		});
		await controller.initialize();
		const one = controller.selectPhoto({ file: { name: "one" }, previewUrl: "blob:one" });
		const two = controller.selectPhoto({ file: { name: "two" }, previewUrl: "blob:two" });
		expect(controller.getState().previewUrl).toBe("blob:two");
		second.resolve(photo({ id: "two" }));
		await two;
		first.resolve(photo({ id: "one" }));
		await one;
		expect(controller.getState().photo.photoId).toBe("two");
	});

	test("reset clears queued requests, stale export, and renders zero from original", async () => {
		const { controller, renders } = await fixture();
		controller.setValue({ name: "StretchLeg", value: 100 });
		controller.apply();
		controller.setValue({ name: "StretchLeg", value: 50 });
		controller.setValue({ name: "SlimBody", value: 100 });
		controller.setValue({ name: "SlimArm", value: 80 });
		controller.setValue({ name: "ShoulderWidth", value: -50 });
		controller.setValue({ name: "OrthoShoulder", value: 100 });
		controller.setValue({ name: "SwanNeck", value: 100 });
		controller.setValue({ name: "HipWidth", value: 50 });
		controller.setValue({ name: "BustSize", value: -50 });
		controller.setValue({ name: "ThighWidth", value: -50 });
		controller.setValue({ name: "CalfWidth", value: 50 });
		controller.apply();
		controller.reset();
		renders[0].resolve(result({ request: renders[0].request }));
		await flush();
		expect(renders).toHaveLength(1);
		expect(controller.getState().values).toEqual(zeros());
		expect(controller.getState().result).toBeNull();
		controller.apply();
		expect(renders[1].request).toEqual({ photoId: "first", values: zeros() });
		renders[1].resolve(result({ request: renders[1].request, status: "identity" }));
		await flush();
		expect(controller.getState().result.status).toBe("identity");
		expect(controller.getState().downloadReady).toBe(true);
	});

	test("failed runs remove export and allow a successful retry", async () => {
		const { controller, renders } = await fixture();
		controller.apply();
		renders[0].reject(new Error("模型缺失"));
		await flush();
		expect(controller.getState().error).toBe("模型缺失");
		expect(controller.getState().rendering).toBe(false);
		expect(controller.getState().downloadReady).toBe(false);
		controller.apply();
		renders[1].resolve(result({ request: renders[1].request }));
		await flush();
		expect(controller.getState().error).toBeNull();
		expect(controller.getState().downloadReady).toBe(true);
	});

	test("identity and partial are explicit, unavailable never becomes an export", async () => {
		const { controller, renders } = await fixture();
		controller.setValue({ name: "StretchLeg", value: 100 });
		controller.apply();
		renders[0].resolve(result({ request: renders[0].request, status: "partial" }));
		await flush();
		expect(controller.getState().result.status).toBe("partial");
		controller.apply();
		const unavailable = result({ request: renders[1].request, status: "unavailable" });
		unavailable.controls = { StretchLeg: { requested: 100, applied: false, message: "腿部未检测完整。" } };
		renders[1].resolve(unavailable);
		await flush();
		expect(controller.getState().result.status).toBe("unavailable");
		expect(controller.getState().result.controls.StretchLeg.applied).toBe(false);
		expect(controller.getState().error).toBeNull();
		expect(controller.getState().downloadReady).toBe(false);
	});

	test("rejects mismatched responses and blocks unsupported platforms", async () => {
		const supported = await fixture();
		supported.controller.apply();
		supported.renders[0].resolve(result({ request: { photoId: "other", values: zeros() } }));
		await flush();
		expect(supported.controller.getState().error).toContain("不匹配");
		expect(supported.controller.getState().downloadReady).toBe(false);
		const unavailable = await fixture({ supported: false });
		unavailable.controller.apply();
		expect(unavailable.renders).toHaveLength(0);
	});

	test("clamps finite slider values and ignores unknown controls and NaN", async () => {
		const { controller } = await fixture();
		controller.setValue({ name: "StretchLeg", value: 123 });
		controller.setValue({ name: "SlimWaist", value: -8 });
		controller.setValue({ name: "SmallHead", value: 12.6 });
		controller.setValue({ name: "Other", value: 100 });
		controller.setValue({ name: "StretchLeg", value: NaN });
		expect(controller.getState().values).toEqual({ ...zeros(), StretchLeg: 100, SmallHead: 13 });
	});

	test("applies overall and arm slimming explicitly and invalidates their old exports", async () => {
		const { controller, renders } = await fixture();
		controller.setValue({ name: "SlimBody", value: 100 });
		controller.setValue({ name: "SlimArm", value: 82.6 });
		expect(renders).toHaveLength(0);
		controller.apply();
		expect(renders[0].request.values).toEqual({ ...zeros(), SlimBody: 100, SlimArm: 83 });
		renders[0].resolve(result({ request: renders[0].request }));
		await flush();
		expect(controller.getState().downloadReady).toBe(true);
		controller.setValue({ name: "SlimArm", value: 84 });
		expect(controller.getState().downloadReady).toBe(false);
		expect(controller.getState().result).toBeNull();
		controller.apply();
		renders[1].resolve(result({ request: renders[1].request }));
		await flush();
		expect(controller.getState().downloadReady).toBe(true);
		controller.setValue({ name: "SlimBody", value: 99 });
		expect(controller.getState().downloadReady).toBe(false);
		expect(renders).toHaveLength(2);
	});

	test("signed controls use both declared bounds and ignore nonfinite input", async () => {
		const { controller } = await fixture();
		for (const name of signedNames) {
			controller.setValue({ name, value: -123 });
			expect(controller.getState().values[name]).toBe(-50);
			controller.setValue({ name, value: 123 });
			expect(controller.getState().values[name]).toBe(50);
			controller.setValue({ name, value: -12.6 });
			expect(controller.getState().values[name]).toBe(-13);
			for (const value of [NaN, Infinity, -Infinity, "50"]) controller.setValue({ name, value });
			expect(controller.getState().values[name]).toBe(-13);
			controller.setValue({ name, value: 0 });
			expect(controller.getState().values[name]).toBe(0);
		}
	});

	test("uses the catalog bounds rather than a global clamp", async () => {
		const control = { ...controls({ selected: ["ShoulderWidth"] })[0], min: -10, max: 25 };
		const { controller, renders } = await fixture({ catalogControls: [control] });
		controller.setValue({ name: "ShoulderWidth", value: -50 });
		expect(controller.getState().values).toEqual({ ShoulderWidth: -10 });
		controller.setValue({ name: "ShoulderWidth", value: 100 });
		controller.apply();
		expect(renders[0].request.values).toEqual({ ShoulderWidth: 25 });
	});

	test("each new control invalidates the previously exported result", async () => {
		await Promise.all(newNames.map(async (name) => {
			const { controller, renders } = await fixture();
			controller.setValue({ name, value: signedNames.includes(name) ? -50 : 100 });
			controller.apply();
			expect(Object.keys(renders[0].request.values)).toEqual(names);
			renders[0].resolve(result({ request: renders[0].request }));
			await flush();
			expect(controller.getState().downloadReady).toBe(true);
			controller.setValue({ name, value: 50 });
			expect(controller.getState().result).toBeNull();
			expect(controller.getState().downloadReady).toBe(false);
			expect(renders).toHaveLength(1);
		}));
	});

	test("signed zero is centered and accessible slider values include actual bounds", () => {
		for (const control of controls()) {
			const zero = getSliderPresentation({ control, value: 0 });
			expect(zero.fill).toBe(control.min < 0 ? "50%" : "0%");
			expect(zero.valueText).toContain(`范围 ${control.min} 至 ${control.max}`);
			expect(zero.valueText).toContain("0 表示保留原始比例");
			expect(getSliderPresentation({ control, value: control.min }).fill).toBe("0%");
			expect(getSliderPresentation({ control, value: control.max }).fill).toBe("100%");
			if (control.min < 0) {
				expect(getSliderPresentation({ control, value: -25 }).fill).toBe("25%");
				expect(getSliderPresentation({ control, value: 25 }).fill).toBe("75%");
				expect(zero.rangeText).toBe("-50…50");
			}
		}
	});

	test("rejects missing, extra, or mismatched new control response values", async () => {
		const malformedValues = [
			{ StretchLeg: 0, SlimWaist: 0, SmallHead: 0 },
			{ ...zeros(), SlimBody: 65, SlimArm: 89 },
			{ ...zeros(), SlimBody: 64, SlimArm: 90 },
			{ ...zeros(), SlimBody: 65, SlimArm: 90, Unknown: 0 },
			[0, 0, 0, 65, 90],
		];
		await Promise.all(malformedValues.map(async (values) => {
			const { controller, renders } = await fixture();
			controller.setValue({ name: "SlimBody", value: 65 });
			controller.setValue({ name: "SlimArm", value: 90 });
			controller.apply();
			const active = renders[0];
			active.resolve(result({ request: { ...active.request, values } }));
			await flush();
			expect(controller.getState().error).toContain("不匹配");
			expect(controller.getState().downloadReady).toBe(false);
		}));
	});

	test("requires all twelve exact response fields, including independent signed legs", async () => {
		const expectedValues = {
			...zeros(), ShoulderWidth: -35, OrthoShoulder: 100, SwanNeck: 70,
			HipWidth: 45, BustSize: -20, ThighWidth: -50, CalfWidth: 50,
		};
		const { ShoulderWidth: omitted, ...missingShoulder } = expectedValues;
		const { ThighWidth: omittedThigh, ...missingThigh } = expectedValues;
		const { CalfWidth: omittedCalf, ...missingCalf } = expectedValues;
		expect(omitted).toBe(-35);
		expect(omittedThigh).toBe(-50);
		expect(omittedCalf).toBe(50);
		const malformedValues = [
			Object.fromEntries(fiveNames.map((name) => [name, 0])), missingShoulder, missingThigh, missingCalf,
			{ ...expectedValues, ShoulderWidth: 35 }, { ...expectedValues, OrthoShoulder: 0 },
			{ ...expectedValues, SwanNeck: 0 }, { ...expectedValues, HipWidth: -45 },
			{ ...expectedValues, BustSize: 20 }, { ...expectedValues, Unknown: 0 },
			{ ...expectedValues, ThighWidth: 50 }, { ...expectedValues, CalfWidth: -50 },
		];
		await Promise.all(malformedValues.map(async (values) => {
			const { controller, renders } = await fixture();
			for (const [name, value] of Object.entries(expectedValues)) controller.setValue({ name, value });
			controller.apply();
			renders[0].resolve(result({ request: { ...renders[0].request, values } }));
			await flush();
			expect(controller.getState().error).toContain("不匹配");
			expect(controller.getState().downloadReady).toBe(false);
		}));
	});

	test("derives permitted names from the catalog and remains compatible with earlier catalogs", async () => {
		const legacy = await fixture({ catalogControls: controls({ selected: originalNames }) });
		legacy.controller.setValue({ name: "SlimBody", value: 100 });
		legacy.controller.setValue({ name: "SlimArm", value: 100 });
		legacy.controller.setValue({ name: "SmallHead", value: 50 });
		legacy.controller.apply();
		expect(legacy.renders[0].request.values).toEqual({ StretchLeg: 0, SlimWaist: 0, SmallHead: 50 });
		legacy.renders[0].resolve(result({ request: legacy.renders[0].request }));
		await flush();
		expect(legacy.controller.getState().downloadReady).toBe(true);
		const five = await fixture({ catalogControls: controls({ selected: fiveNames }) });
		five.controller.setValue({ name: "ShoulderWidth", value: -50 });
		five.controller.setValue({ name: "SlimArm", value: 75 });
		five.controller.apply();
		expect(five.renders[0].request.values).toEqual({ StretchLeg: 0, SlimWaist: 0, SmallHead: 0, SlimBody: 0, SlimArm: 75 });
		five.renders[0].resolve(result({ request: five.renders[0].request }));
		await flush();
		expect(five.controller.getState().downloadReady).toBe(true);
		const ten = await fixture({ catalogControls: controls({ selected: tenNames }) });
		for (const name of legNames) ten.controller.setValue({ name, value: -50 });
		ten.controller.setValue({ name: "ShoulderWidth", value: -20 });
		ten.controller.apply();
		expect(ten.renders[0].request.values).toEqual({
			...Object.fromEntries(tenNames.map((name) => [name, 0])), ShoulderWidth: -20,
		});
		ten.renders[0].resolve(result({ request: ten.renders[0].request }));
		await flush();
		expect(ten.controller.getState().downloadReady).toBe(true);
		const catalogOnly = await fixture({ catalogControls: controls({ selected: ["SlimArm"] }) });
		catalogOnly.controller.setValue({ name: "StretchLeg", value: 70 });
		catalogOnly.controller.setValue({ name: "SlimArm", value: 55 });
		catalogOnly.controller.apply();
		expect(catalogOnly.renders[0].request.values).toEqual({ SlimArm: 55 });
	});

	test("rejects invalid catalogs before controls can render or export", async () => {
		const arm = controls({ selected: ["SlimArm"] })[0];
		const invalidCatalogs = [
			[], null, [null], [arm, { ...arm }],
			[{ ...arm, name: "__proto__" }], [{ ...arm, name: "Slim Arm" }],
			[{ ...arm, title: " " }], [{ ...arm, min: -51 }], [{ ...arm, max: 101 }],
			[{ ...arm, max: "100" }], [{ ...arm, default: 1 }], [{ ...arm, step: 0 }],
			[{ ...arm, min: 1 }], [{ ...arm, max: -1 }], [{ ...arm, min: 0, max: 0 }],
			[{ ...arm, min: -10.5 }], [{ ...arm, max: 49.5 }], [{ ...arm, step: 2 }],
			[{ ...arm, min: -Infinity }], [{ ...arm, max: Infinity }], [{ ...arm, min: NaN }],
			[{ ...arm, max: NaN }], [{ ...arm, step: NaN }], [{ ...arm, default: NaN }],
		];
		await Promise.all(invalidCatalogs.map(async (catalogControls) => {
			const { controller, renders } = await fixture({ catalogControls });
			controller.setValue({ name: "SlimArm", value: 100 });
			controller.apply();
			expect(controller.getState().catalog).toBeNull();
			expect(controller.getState().values).toEqual({});
			expect(controller.getState().downloadReady).toBe(false);
			expect(renders).toHaveLength(0);
		}));
	});

	test("changing a snapshot cannot change validated control definitions", async () => {
		const { controller, renders } = await fixture();
		const state = controller.getState();
		state.catalog.controls[0].name = "Other";
		state.catalog.platform.supported = false;
		controller.setValue({ name: "SlimBody", value: 100 });
		controller.setValue({ name: "SlimArm", value: 100 });
		controller.apply();
		expect(renders[0].request.values).toEqual({ ...zeros(), SlimBody: 100, SlimArm: 100 });
		expect(controller.getState().catalog.controls[0].name).toBe("StretchLeg");
	});
});
