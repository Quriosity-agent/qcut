import { createBodyController, getControlFeedback, getControlGroups, getSliderPresentation } from "./body-controller.js";
import { createLocalEditor } from "./local-editor.js";
import { createGluteEditor } from "./glute-editor.js";

async function requestJson({ url, options }) {
	const response = await fetch(url, options);
	let data;
	try {
		data = await response.json();
	} catch {
		throw new Error("本机服务没有返回有效数据，请检查服务是否仍在运行。");
	}
	if (!response.ok)
		throw new Error(data.error?.message || data.message || `请求失败（${response.status}）`);
	return data;
}

const controller = createBodyController({
	services: {
		catalog: () => requestJson({ url: "/api/catalog" }),
		upload: ({ file }) =>
			requestJson({
				url: "/api/photos",
				options: {
					method: "POST",
					headers: { "Content-Type": file.type || "application/octet-stream" },
					body: file,
				},
			}),
		render: (request) =>
			requestJson({
				url: "/api/render",
				options: {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(request),
				},
			}),
	},
});

const localEditor = createLocalEditor({ controller });
const gluteEditor = createGluteEditor({ controller });

const element = ({ id }) => document.getElementById(id);
const refs = Object.fromEntries(
	[
		"engine-badge", "photo-file", "photo-size", "photo-filename", "upload-label",
		"slider-controls", "reset", "body-form", "apply", "apply-label", "download",
		"view-compare", "view-original", "view-result", "view-blink", "result-meta", "image-stage",
		"empty-state", "empty-upload", "source-image", "result-layer", "result-image",
		"left-label", "right-label", "wipe-line", "processing-overlay", "wipe-position",
		"wipe-output", "status-title", "status-message", "control-feedback",
		"catalog-summary", "skin-scope", "scope-description",
	].map((id) => [id, element({ id })]),
);
const controlElements = new Map();
const groupElements = new Map();
let catalogSignature = "";
const photoHint = refs["photo-filename"].textContent;
const controlDescriptions = {
	StretchLeg: { left: "保留腿部比例", right: "增强拉长" },
	SlimWaist: { left: "保留腰部轮廓", right: "增强收腰" },
	SmallHead: { left: "保留头部比例", right: "增强缩小" },
	SlimBody: { left: "保留整体身形", right: "增强整体瘦身" },
	SlimArm: { left: "保留手臂轮廓", right: "增强瘦手臂" },
	ShoulderWidth: { left: "收窄肩部", right: "加宽肩部" },
	OrthoShoulder: { left: "保留肩线", right: "增强平肩" },
	SwanNeck: { left: "保留颈肩比例", right: "修饰颈肩线" },
	HipWidth: { left: "收窄胯部", right: "加宽胯部" },
	BustSize: { left: "缩小胸围", right: "增大胸围" },
	ThighWidth: { left: "收窄大腿", right: "加宽大腿" },
	CalfWidth: { left: "收窄小腿", right: "加宽小腿" },
	Abdomen: { left: "保留腹部轮廓", right: "增强收腹" },
	ButtLift: { left: "保留臀部位置", right: "增强上提" },
	ButtShape: { left: "收窄臀部", right: "加宽臀部" },
	LegStraighten: { left: "保留腿型", right: "增强拉直" },
	AnkleWidth: { left: "收细脚踝", right: "加宽脚踝" },
	BodySkinTone: { left: "加深", right: "提亮" },
	BodySkinWarmth: { left: "偏冷", right: "偏暖" },
	BodySkinSmooth: { left: "保留纹理", right: "柔化纹理" },
	BodyBlemish: { left: "保留细节", right: "淡化小斑点" },
};
let view = "compare";
let wipe = 50;
let lastPhotoId = null;
let localPreviewUrl = null;
let blinkTimer = null;
let blinkResult = false;

function createControlCard({ control, index }) {
	const card = document.createElement("div");
	card.className = "control-card";
	const heading = document.createElement("div");
	heading.className = "control-heading";
	const title = document.createElement("label");
	title.className = "control-title";
	title.htmlFor = `range-${control.name}`;
	const number = document.createElement("span");
	number.className = "control-index";
	number.textContent = String(index + 1).padStart(2, "0");
	const titleText = document.createElement("span");
	titleText.textContent = control.name === "ButtShape" ? `${control.title} · 2D轮廓` : control.title;
	title.append(number, titleText);
	const valueWrapper = document.createElement("div");
	valueWrapper.className = "control-value";
	const numeric = document.createElement("input");
	numeric.type = "number";
	numeric.inputMode = control.min < 0 ? "text" : "numeric";
	numeric.id = `number-${control.name}`;
	numeric.setAttribute("aria-label", `${control.title}数值`);
	const max = document.createElement("span");
	max.textContent = getSliderPresentation({ control, value: control.default }).rangeText;
	valueWrapper.append(numeric, max);
	heading.append(title, valueWrapper);
	const slider = document.createElement("input");
	slider.type = "range";
	slider.id = `range-${control.name}`;
	for (const input of [slider, numeric]) {
		input.min = String(control.min);
		input.max = String(control.max);
		input.step = String(control.step || 1);
		input.value = String(control.default || 0);
		input.addEventListener("input", () => {
			if (input.value.trim() === "") return;
			controller.setValue({ name: control.name, value: Number(input.value) });
		});
		input.addEventListener("change", () => {
			input.value = String(controller.getState().values[control.name]);
		});
	}
	const scale = document.createElement("div");
	scale.className = "control-scale";
	const description = controlDescriptions[control.name] || { left: control.min < 0 ? "减小" : "保留原图", right: "增强" };
	const scaleLabels = [description.left, ...(control.min < 0 ? ["原始 0"] : []), description.right];
	for (const text of scaleLabels.filter(Boolean)) {
		const item = document.createElement("span");
		item.textContent = text;
		scale.append(item);
	}
	const note = document.createElement("p");
	note.className = "control-note";
	note.id = `note-${control.name}`;
	note.textContent = control.note || "";
	note.hidden = !control.note;
	const feedback = document.createElement("p");
	feedback.className = "control-receipt";
	feedback.id = `feedback-${control.name}`;
	for (const input of [slider, numeric])
		input.setAttribute("aria-describedby", [control.note ? note.id : "", feedback.id].filter(Boolean).join(" "));
	card.append(heading, slider, scale, note, feedback);
	controlElements.set(control.name, { slider, numeric, feedback, title: control.title, control });
	return card;
}

function createControls({ catalog }) {
	const signature = JSON.stringify({ controls: catalog.controls, groups: catalog.groups });
	if (signature === catalogSignature) return;
	catalogSignature = signature;
	controlElements.clear();
	groupElements.clear();
	refs["slider-controls"].replaceChildren();
	const groups = getControlGroups({ catalog });
	for (const [index, group] of groups.entries()) {
		const section = document.createElement("details");
		section.className = "control-group";
		section.open = index === 0;
		section.dataset.group = group.id;
		const summary = document.createElement("summary");
		const title = document.createElement("span");
		title.className = "group-title";
		title.textContent = group.title;
		const count = document.createElement("span");
		count.className = "group-count";
		summary.append(title, count);
		const cards = document.createElement("div");
		cards.className = "group-controls";
		for (const [cardIndex, control] of group.controls.entries())
			cards.append(createControlCard({ control, index: cardIndex }));
		section.append(summary, cards);
		refs["slider-controls"].append(section);
		groupElements.set(group.id, { count, controls: group.controls });
	}
	const hasSkin = groups.some((group) => group.id === "skin");
	refs["catalog-summary"].textContent = `当前引擎提供 ${catalog.controls.length} 项调整。展开部位选择参数，可单独或组合应用。0 保留原图；数值是算法强度，不是尺寸百分比。`;
	refs["skin-scope"].hidden = !hasSkin;
	refs["scope-description"].textContent = hasSkin
		? "轮廓调整按可见关节分别判断，屈膝、交叉腿、半身或遮挡可能不可用。皮肤调整还需识别可信的裸露区域；未应用的项目会说明原因。高强度请检查轮廓、衣物和背景。"
		: "比例调整依赖人体关键点。近景、半身或遮挡可能导致部分项目不可用；大腿需要髋部和膝部，小腿需要膝部和踝部清晰。高强度请检查轮廓和画面边缘。";
}

function setImage({ image, url }) {
	if (!url) {
		image.hidden = true;
		image.removeAttribute("src");
		return;
	}
	if (image.getAttribute("src") !== url) image.src = url;
	image.hidden = false;
}

function updateComparison({ state }) {
	const hasPhoto = Boolean(state.previewUrl);
	const hasResult = Boolean(state.result?.result?.url) && state.downloadReady;
	if ((!hasResult || view !== "blink") && blinkTimer !== null) {
		clearInterval(blinkTimer);
		blinkTimer = null;
	}
	const activeView = hasResult ? (view === "blink" ? (blinkResult ? "result" : "original") : view) : "original";
	refs["image-stage"].dataset.view = activeView;
	refs["image-stage"].setAttribute("aria-busy", String(state.rendering && Boolean(state.photo)));
	refs["empty-state"].hidden = hasPhoto;
	setImage({ image: refs["source-image"], url: state.previewUrl });
	setImage({ image: refs["result-image"], url: hasResult ? state.result.result.url : null });
	refs["result-layer"].hidden = !hasResult || activeView === "original";
	refs["result-layer"].style.clipPath = activeView === "compare" ? `inset(0 0 0 ${wipe}%)` : "none";
	refs["left-label"].hidden = !hasPhoto || activeView === "result";
	refs["right-label"].hidden = !hasResult || activeView === "original";
	refs["wipe-line"].hidden = !hasResult || activeView !== "compare";
	refs["wipe-line"].style.left = `${wipe}%`;
	refs["wipe-position"].disabled = !hasResult || activeView !== "compare";
	refs["wipe-position"].style.setProperty("--fill", `${wipe}%`);
	refs["wipe-output"].textContent = `${wipe}%`;
	refs["processing-overlay"].hidden = !state.rendering || state.renderPhotoId !== state.photo?.photoId;
	for (const name of ["compare", "original", "result", "blink"]) {
		refs[`view-${name}`].setAttribute("aria-pressed", String((hasResult ? view : "original") === name));
		refs[`view-${name}`].disabled = name !== "original" && !hasResult;
	}
}

function statusTitle({ state }) {
	if (state.error) return "处理未完成";
	if (state.loading) return "正在检查引擎";
	if (state.uploading) return "正在载入原图";
	if (state.rendering) {
		if (state.queued) return "处理中 · 已排队最新设置";
		return state.renderPhotoId === state.photo?.photoId ? "正在处理" : "正在完成上一项任务";
	}
	if (state.result?.status === "identity") return "已生成 · 输出保留原图";
	if (state.result?.status === "unavailable") return "未应用 · 正在显示原图";
	if (state.result?.status === "partial") return "已生成 · 部分调整生效";
	if (state.result?.status === "applied") return "已生成 · 调整已应用";
	if (state.catalog && !state.catalog.platform.supported) return "当前引擎不可用";
	return state.photo ? "原图已就绪 · 等待应用" : "准备就绪";
}

function updateFeedback({ state }) {
	refs["status-title"].textContent = statusTitle({ state });
	refs["status-message"].textContent = state.error || state.message || "请打开照片。";
	refs["status-title"].closest(".feedback").dataset.state = state.error
		? "error"
		: state.result?.status || "idle";
	refs["control-feedback"].replaceChildren();
	for (const [name, feedback] of Object.entries(state.result?.controls || {})) {
		if (!feedback.requested || !feedback.message) continue;
		const item = document.createElement("li");
		const title = controlElements.get(name)?.title || name;
		item.textContent = `${title} ${feedback.requested}：${feedback.message}`;
		refs["control-feedback"].append(item);
	}
	refs["control-feedback"].hidden = refs["control-feedback"].childElementCount === 0;
}

function update({ state }) {
	if (state.catalog) createControls({ catalog: state.catalog });
	if (state.photo && state.photo.photoId !== lastPhotoId) {
		lastPhotoId = state.photo.photoId;
		view = "compare";
		wipe = 50;
		refs["wipe-position"].value = "50";
	}
	if (localPreviewUrl && state.previewUrl !== localPreviewUrl) {
		URL.revokeObjectURL(localPreviewUrl);
		localPreviewUrl = null;
	}
	const supported = state.catalog?.platform.supported === true;
	const engineName = { "macOS-Metal": "Metal", "portable-CPU": "CPU" }[state.catalog?.platform.backend];
	const readyLabel = engineName ? `${engineName} 引擎就绪` : "引擎就绪";
	refs["engine-badge"].dataset.ready = String(supported);
	refs["engine-badge"].textContent = state.loading
		? "检查引擎中"
		: supported ? readyLabel : "引擎暂不可用";
	refs["engine-badge"].title = state.catalog?.platform.message || state.error || "";
	refs["photo-size"].textContent = state.photo ? `${state.photo.width} × ${state.photo.height}` : "";
	refs["photo-filename"].textContent = state.filename || photoHint;
	refs["upload-label"].textContent = state.uploading ? "正在载入，可另选照片" : state.previewUrl ? "更换照片" : "选择一张照片";
	refs["reset"].disabled = !state.previewUrl;
	refs.apply.disabled = !state.photo || state.uploading || !supported;
	refs["apply-label"].textContent = state.rendering ? (state.queued ? "更新排队设置" : "排队应用新设置") : "应用调整";
	for (const [name, inputs] of controlElements) {
		const presentation = getSliderPresentation({ control: inputs.control, value: state.values[name] });
		for (const input of [inputs.slider, inputs.numeric]) {
			input.disabled = !state.photo || state.uploading || !supported;
			if (document.activeElement !== input || input.type === "range")
				input.value = String(state.values[name]);
			input.setAttribute("aria-valuetext", presentation.valueText);
		}
		inputs.slider.style.setProperty("--fill", presentation.fill);
		const receipt = getControlFeedback({ state, control: inputs.control });
		inputs.feedback.dataset.state = receipt.status;
		inputs.feedback.textContent = `${receipt.text}${receipt.message ? ` · ${receipt.message}` : ""}`;
	}
	for (const { count, controls } of groupElements.values()) {
		const selected = controls.filter((control) => state.values[control.name] !== 0).length;
		count.textContent = selected ? `${selected} 项已设值 / ${controls.length}` : `${controls.length} 项`;
		count.dataset.active = String(selected > 0);
	}
	refs.download.hidden = !state.downloadReady;
	if (state.downloadReady) refs.download.href = state.result.result.downloadUrl;
	else refs.download.removeAttribute("href");
	refs["result-meta"].textContent = state.result?.status === "unavailable"
		? "当前原图 · 本次调整未生效"
		: state.result
		? `${state.result.result.width} × ${state.result.result.height} · ${((state.result.milliseconds || 0) / 1000).toFixed(1)} 秒`
		: state.photo ? "原图 · 参数需应用后生效" : "等待打开照片";
	updateComparison({ state });
	updateFeedback({ state });
	localEditor.update({ nextState: state });
	gluteEditor.update({ nextState: state });
}

refs["photo-file"].addEventListener("change", () => {
	const file = refs["photo-file"].files?.[0];
	if (!file) return;
	if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
	localPreviewUrl = URL.createObjectURL(file);
	view = "compare";
	void controller.selectPhoto({ file, previewUrl: localPreviewUrl });
	refs["photo-file"].value = "";
});
refs["empty-upload"].addEventListener("click", () => refs["photo-file"].click());
refs["body-form"].addEventListener("submit", (event) => {
	event.preventDefault();
	view = "compare";
	controller.apply();
});
refs.reset.addEventListener("click", () => controller.reset());
for (const name of ["compare", "original", "result", "blink"]) {
	refs[`view-${name}`].addEventListener("click", () => {
		view = name;
		if (name === "blink" && blinkTimer === null) {
			blinkResult = false;
			blinkTimer = setInterval(() => {
				blinkResult = !blinkResult;
				updateComparison({ state: controller.getState() });
			}, 850);
		}
		updateComparison({ state: controller.getState() });
	});
}
refs["wipe-position"].addEventListener("input", () => {
	wipe = Number(refs["wipe-position"].value);
	updateComparison({ state: controller.getState() });
});
function dragWipe({ event }) {
	if (!controller.getState().downloadReady || view !== "compare") return;
	const bounds = refs["image-stage"].getBoundingClientRect();
	wipe = Math.min(100, Math.max(0, Math.round(((event.clientX - bounds.left) / bounds.width) * 100)));
	refs["wipe-position"].value = String(wipe);
	updateComparison({ state: controller.getState() });
}
refs["image-stage"].addEventListener("pointerdown", (event) => {
	if (!controller.getState().downloadReady || view !== "compare") return;
	refs["image-stage"].setPointerCapture(event.pointerId);
	dragWipe({ event });
});
refs["image-stage"].addEventListener("pointermove", (event) => {
	if (refs["image-stage"].hasPointerCapture(event.pointerId)) dragWipe({ event });
});
refs["image-stage"].addEventListener("pointerup", (event) => {
	if (refs["image-stage"].hasPointerCapture(event.pointerId))
		refs["image-stage"].releasePointerCapture(event.pointerId);
});
controller.subscribe({ listener: (state) => update({ state }) });
void controller.initialize();
