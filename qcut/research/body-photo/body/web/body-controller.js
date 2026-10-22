import { copyEdits, emptyEdits, hasEdits, sameEdits, validateEdits } from "./edits-contract.js";

const defaultGroups = [
	{ id: "proportion", title: "整体比例", names: ["SmallHead", "SlimBody"] },
	{ id: "upper", title: "肩颈与上身", names: ["SlimArm", "ShoulderWidth", "OrthoShoulder", "SwanNeck", "BustSize"] },
	{ id: "abdomen", title: "腰腹", names: ["SlimWaist", "Abdomen"] },
	{ id: "buttocks", title: "胯部与臀型", names: ["HipWidth", "ButtLift", "ButtShape"] },
	{ id: "legs", title: "腿部与脚踝", names: ["StretchLeg", "ThighWidth", "CalfWidth", "LegStraighten", "AnkleWidth"] },
	{ id: "skin", title: "身体肤色与皮肤", names: ["BodySkinTone", "BodySkinWarmth", "BodySkinSmooth", "BodyBlemish"] },
];
const groupIdPattern = /^[a-z][a-z0-9-]*$/;

export function getControlGroups({ catalog }) {
	const declared = catalog.groups || [];
	const definitions = new Map([...declared, ...defaultGroups.filter((group) =>
		!declared.some((item) => item.id === group.id))].map((group) => [group.id, group]));
	const grouped = new Map();
	for (const control of catalog.controls) {
		const id = control.group || defaultGroups.find((group) => group.names.includes(control.name))?.id || "other";
		if (!grouped.has(id)) grouped.set(id, { id, title: definitions.get(id)?.title || "其他调整", controls: [] });
		grouped.get(id).controls.push(control);
	}
	return [...definitions.keys(), ...[...grouped.keys()].filter((id) => !definitions.has(id))]
		.filter((id) => grouped.has(id)).map((id) => grouped.get(id));
}

function validateCatalog({ catalog }) {
	if (
		!Array.isArray(catalog?.controls) || catalog.controls.length === 0 ||
		typeof catalog.platform?.supported !== "boolean"
	)
		throw new Error("效果目录不可用，请重新启动独立美体服务。");
	const names = new Set();
	for (const control of catalog.controls) {
		if (
			!control || typeof control.name !== "string" ||
			!/^[A-Z][A-Za-z0-9]*$/.test(control.name) || names.has(control.name) ||
			typeof control.title !== "string" || control.title.trim() === "" ||
			!Number.isInteger(control.min) || !Number.isInteger(control.max) ||
			control.min < -50 || control.min > 0 || control.max < 0 || control.max > 100 ||
			control.min >= control.max || control.default !== 0 || control.step !== 1 ||
			(control.group !== undefined && (typeof control.group !== "string" || !groupIdPattern.test(control.group))) ||
			(control.note !== undefined && typeof control.note !== "string")
		)
			throw new Error("效果目录中的滑杆定义无效，请重新启动独立美体服务。");
		names.add(control.name);
	}
	if (catalog.groups !== undefined) {
		const ids = new Set();
		if (!Array.isArray(catalog.groups)) throw new Error("效果目录中的分组定义无效。");
		for (const group of catalog.groups) {
			if (!group || typeof group.id !== "string" || !groupIdPattern.test(group.id) || ids.has(group.id) ||
				typeof group.title !== "string" || !group.title.trim()) throw new Error("效果目录中的分组定义无效。");
			ids.add(group.id);
		}
	}
	return {
		...catalog,
		controls: catalog.controls.map((control) => ({ ...control })),
		...(catalog.groups ? { groups: catalog.groups.map((group) => ({ ...group })) } : {}),
		platform: { ...catalog.platform },
	};
}

export function getSliderPresentation({ control, value }) {
	const original = control.group === "skin" || control.name.startsWith("BodySkin") || control.name === "BodyBlemish"
		? "原始肤色和纹理" : "原始比例";
	return {
		fill: `${((value - control.min) / (control.max - control.min)) * 100}%`,
		valueText: `${value}，范围 ${control.min} 至 ${control.max}，0 表示保留${original}`,
		rangeText: control.min < 0 ? `${control.min}…${control.max}` : `/ ${control.max}`,
	};
}

export function getControlFeedback({ state, control }) {
	const value = state.values[control.name];
	if (!value) return { status: "idle", text: "未调整" };
	if (state.rendering) return { status: "pending", text: state.queued ? "已排队" : "处理中" };
	if (!state.result) return { status: "pending", text: "待应用" };
	const feedback = state.result.controls?.[control.name];
	if (!feedback || feedback.requested !== value || typeof feedback.applied !== "boolean")
		return { status: "unknown", text: "项目状态未确认" };
	return {
		status: feedback.applied ? "applied" : "unavailable",
		text: feedback.applied ? "已执行处理" : "未应用",
		message: typeof feedback.message === "string" ? feedback.message : "",
	};
}

function sameValues({ left, right, names }) {
	return (
		left !== null && typeof left === "object" && !Array.isArray(left) &&
		right !== null && typeof right === "object" && !Array.isArray(right) &&
		Object.keys(left).length === names.length && Object.keys(right).length === names.length &&
		names.every((name) => Object.hasOwn(left, name) && Object.hasOwn(right, name) && left[name] === right[name])
	);
}

function errorMessage({ error }) {
	return error instanceof Error ? error.message : String(error);
}

export function createBodyController({ services }) {
	let controlNames = [];
	let controlsByName = new Map();
	function zeroValues() {
		return Object.fromEntries(controlNames.map((name) => [name, 0]));
	}
	function initialEdits({ photo }) {
		return { ...emptyEdits(), ...(photo && controlsByName.has("ButtLift") &&
			Object.hasOwn(photo, "buttocksDetection") ? { autoButtocks: true } : {}) };
	}
	function valuesMatch({ left, right }) {
		return sameValues({ left, right, names: controlNames });
	}
	let state = {
		catalog: null,
		loading: true,
		uploading: false,
		rendering: false,
		renderPhotoId: null,
		queued: false,
		photo: null,
		previewUrl: null,
		filename: "",
		values: zeroValues(),
		edits: emptyEdits(),
		editResetVersion: 0,
		result: null,
		error: null,
		message: "正在检查本机美体引擎…",
	};
	let photoEpoch = 0;
	let revision = 0;
	let pending = null;
	const listeners = new Set();

	function snapshot() {
		return {
			...state,
			catalog: state.catalog ? {
				...state.catalog,
				controls: state.catalog.controls.map((control) => ({ ...control })),
				...(state.catalog.groups ? { groups: state.catalog.groups.map((group) => ({ ...group })) } : {}),
				platform: { ...state.catalog.platform },
			} : null,
			photo: state.photo ? structuredClone(state.photo) : null,
			values: { ...state.values },
			edits: copyEdits({ edits: state.edits }),
			result: state.result ? structuredClone(state.result) : null,
			downloadReady:
				Boolean(state.result?.result?.downloadUrl) &&
				["applied", "partial", "identity"].includes(state.result.status) &&
				state.result.photoId === state.photo?.photoId &&
				valuesMatch({ left: state.result.values, right: state.values }) &&
				sameEdits({ left: state.result.edits, right: state.edits, photo: state.photo }),
		};
	}

	function publish({ patch }) {
		state = { ...state, ...patch };
		for (const listener of listeners) listener(snapshot());
	}

	function currentRequest() {
		return state.photo
			? {
					photoId: state.photo.photoId,
					values: { ...state.values },
					edits: copyEdits({ edits: state.edits }),
					photo: { ...state.photo },
					epoch: photoEpoch,
					revision,
				}
			: null;
	}

	function requestIsCurrent({ request }) {
		return (
			request.epoch === photoEpoch &&
			request.revision === revision &&
			request.photoId === state.photo?.photoId &&
			valuesMatch({ left: request.values, right: state.values }) &&
			sameEdits({ left: request.edits, right: state.edits, photo: state.photo })
		);
	}

	async function run({ request }) {
		publish({
			patch: {
				rendering: true,
				renderPhotoId: request.photoId,
				queued: false,
				result: null,
				error: null,
				message: "正在从原图计算身体关键点与实际形变…",
			},
		});
		try {
			const response = await services.render({
				photoId: request.photoId,
				values: { ...request.values },
				...(hasEdits({ edits: request.edits }) ? { edits: copyEdits({ edits: request.edits }) } : {}),
			});
			if (
				response.photoId !== request.photoId ||
				!response.values ||
				!["applied", "partial", "identity", "unavailable"].includes(response.status) ||
				!valuesMatch({ left: response.values, right: request.values }) ||
				!sameEdits({ left: response.edits, right: request.edits, photo: request.photo })
			)
				throw new Error("引擎返回的照片或参数不匹配，请重新应用。");
			if (requestIsCurrent({ request })) {
				publish({
					patch: {
						result: structuredClone(response),
						error: null,
						message: response.message || "实际结果已生成。",
					},
				});
			}
		} catch (error) {
			if (requestIsCurrent({ request }))
				publish({
					patch: {
						result: null,
						error: errorMessage({ error }),
						message: "本次处理未完成，可以调整参数后重试。",
					},
				});
		} finally {
			const next = pending;
			pending = null;
			publish({ patch: { rendering: false, renderPhotoId: null, queued: false } });
			if (next && requestIsCurrent({ request: next })) void run({ request: next });
		}
	}

	return {
		getState: snapshot,
		subscribe({ listener }) {
			listeners.add(listener);
			listener(snapshot());
			return () => listeners.delete(listener);
		},
		async initialize() {
			try {
				const catalog = validateCatalog({ catalog: await services.catalog() });
				controlNames = catalog.controls.map((control) => control.name);
				controlsByName = new Map(catalog.controls.map((control) => [control.name, control]));
				revision += 1;
				pending = null;
				publish({
					patch: {
						catalog,
						values: zeroValues(),
						edits: emptyEdits(),
						result: null,
						queued: false,
						loading: false,
						error: null,
						message: catalog.platform.supported
							? "引擎就绪。打开一张单人正立照片开始。"
							: catalog.platform.message,
					},
				});
			} catch (error) {
				publish({ patch: { loading: false, error: errorMessage({ error }) } });
			}
		},
		async selectPhoto({ file, previewUrl }) {
			const epoch = ++photoEpoch;
			revision += 1;
			pending = null;
			publish({
				patch: {
					photo: null,
					previewUrl,
					filename: file.name || "照片",
					values: zeroValues(),
					edits: emptyEdits(),
					result: null,
					queued: false,
					uploading: true,
					error: null,
					message: "正在准备原图，保留画幅和比例…",
				},
			});
			try {
				const photo = await services.upload({ file });
				if (epoch !== photoEpoch) return;
				if (!photo.photoId || !photo.url)
					throw new Error("照片未正确保存，请重新打开。");
				publish({
					patch: {
						photo,
						edits: initialEdits({ photo }),
						previewUrl: photo.url,
						uploading: false,
						message: photo.message || "原图已就绪。调整滑杆后点击「应用调整」。",
					},
				});
			} catch (error) {
				if (epoch === photoEpoch)
					publish({
						patch: {
							uploading: false,
							photo: null,
							error: errorMessage({ error }),
							message: "这张照片还没有载入引擎。",
						},
					});
			}
		},
		setValue({ name, value }) {
			const control = controlsByName.get(name);
			if (!control || !Number.isFinite(value)) return;
			const checked = Math.min(control.max, Math.max(control.min, Math.round(value)));
			if (state.values[name] === checked) return;
			revision += 1;
			state = { ...state, values: { ...state.values, [name]: checked } };
			if (pending) pending = currentRequest();
			publish({
				patch: {
					result: null,
					error: null,
					message: pending
						? "已更新排队参数，当前计算结束后应用最新设置。"
						: "参数已更改。点击「应用调整」生成实际结果。",
				},
			});
		},
		setEdits({ edits }) {
			const checked = validateEdits({ edits, photo: state.photo });
			if (sameEdits({ left: checked, right: state.edits, photo: state.photo })) return;
			revision += 1;
			state = { ...state, edits: checked };
			if (pending) pending = currentRequest();
			publish({ patch: { result: null, error: null,
				message: pending ? "已更新排队调整，当前计算结束后应用最新设置。"
					: "局部调整已更改。点击「应用调整」生成实际结果。" } });
		},
		reset() {
			revision += 1;
			pending = null;
			publish({
				patch: {
					values: zeroValues(),
					edits: initialEdits({ photo: state.photo }),
					editResetVersion: state.editResetVersion + 1,
					result: null,
					queued: false,
					error: null,
					message: "所有调整已归零，正在显示原图。点击应用可生成归零 PNG。",
				},
			});
		},
		apply() {
			if (!state.photo || state.uploading || !state.catalog?.platform.supported) return;
			const request = currentRequest();
			if (state.rendering) {
				pending = request;
				publish({
					patch: { queued: true, message: "已排队，当前计算结束后应用最新设置。" },
				});
				return;
			}
			void run({ request });
		},
	};
}
