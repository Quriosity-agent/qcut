import { imageContentRect, pointInImage } from "./edits-contract.js";
import { automaticGluteDetection, validateGluteSelection } from "./glute-contract.js";

export function createGluteEditor({ controller, root = document }) {
	const ids = ["editor", "view", "stage", "source", "overlay", "message", "detection", "point", "x", "y",
		"add", "move", "undo", "restart", "save", "clear"];
	const refs = Object.fromEntries(ids.map((id) => [id, root.getElementById(`glute-${id}`)]));
	let state = controller.getState();
	let points = [];
	let identity = "";
	let saved = "";
	let selectedIndex = -1;
	const labels = () => refs.view.value === "rear" ? ["左臀峰", "左臀下缘", "右臀峰", "右臀下缘"] : ["臀峰", "臀下缘"];
	function ready() { return Boolean(state.photo && !state.uploading && state.catalog?.platform.supported); }
	function message({ text }) { refs.message.textContent = text; }
	function currentSelection() {
		if (state.edits.buttocks) return state.edits.buttocks;
		const detection = automaticGluteDetection({ photo: state.photo });
		return state.edits.autoButtocks === true && detection?.available ? detection.selection : null;
	}
	function selectPoint({ index }) {
		selectedIndex = index;
		refs.point.value = String(index);
		if (!points[index]) return;
		refs.x.value = String(Number((points[index][0] * 100).toFixed(4)));
		refs.y.value = String(Number((points[index][1] * 100).toFixed(4)));
	}
	function draw() {
		refs.overlay.replaceChildren();
		refs.point.replaceChildren();
		for (const [index] of points.entries()) {
			const option = root.createElement("option");
			option.value = String(index);
			option.textContent = labels()[index];
			refs.point.append(option);
		}
		refs.point.value = String(selectedIndex);
		refs.point.disabled = !ready() || points.length === 0;
		refs.move.disabled = !ready() || !points[selectedIndex];
		if (!state.photo || points.length === 0) return;
		const bounds = refs.stage.getBoundingClientRect();
		const rect = imageContentRect({ bounds: refs.source.getBoundingClientRect(), ...state.photo });
		refs.overlay.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
		for (const [index, point] of points.entries()) {
			const x = rect.left - bounds.left + point[0] * rect.width;
			const y = rect.top - bounds.top + point[1] * rect.height;
			for (const [tag, attributes, text] of [["circle", { cx: x, cy: y, r: 5,
				fill: index % 2 ? "#f3c083" : "#a5e1ca", stroke: index === selectedIndex ? "white" : "none", "stroke-width": 2 }],
				["text", { x: x + 9, y: y - 8, fill: "white", stroke: "#091315", "stroke-width": 3, "paint-order": "stroke", "font-size": 13 }, labels()[index]]]) {
				const node = root.createElementNS("http://www.w3.org/2000/svg", tag);
				for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
				if (text) node.textContent = text;
				refs.overlay.append(node);
			}
		}
	}
	function sourcePoints() {
		const selection = currentSelection();
		points = selection?.anchors.flatMap((anchor) => [[...anchor.peak], [...anchor.fold]]) || [];
		if (selection) refs.view.value = selection.view;
		selectPoint({ index: points.length ? 0 : -1 });
		draw();
	}
	function draftMessage() {
		message({ text: points.length === labels().length
			? "点位已齐，点击「使用这组定位」保存校正，再调提臀并应用。上方结果仍对应上次已保存的设置。"
			: `下一点：${labels()[points.length]}。当前点位尚未保存，上方结果仍对应上次已保存的设置。` });
	}
	function validPoint({ point, index }) {
		if (!point || !point.every((value) => Number.isFinite(value) && value > 0 && value < 1)) {
			message({ text: "请在原图内部标记，坐标必须大于 0% 且小于 100%。" }); return false;
		}
		if (index % 2 && point[1] <= points[index - 1][1]) {
			message({ text: "臀下缘需要位于刚标记的臀峰下方。" }); return false;
		}
		if (index % 2 === 0 && points[index + 1] && point[1] >= points[index + 1][1]) {
			message({ text: "臀峰需要位于对应臀下缘上方。" }); return false;
		}
		return true;
	}
	function add({ point }) {
		if (!ready()) return;
		if (points.length >= labels().length) { message({ text: "定位点已齐，可选择已有点更新，或重新手动标记。" }); return; }
		if (!validPoint({ point, index: points.length })) return;
		points.push(point);
		selectPoint({ index: points.length - 1 });
		draftMessage();
		draw();
	}
	function manualSelection() {
		const anchors = [];
		for (let index = 0; index < points.length; index += 2) anchors.push({ peak: points[index], fold: points[index + 1] });
		return validateGluteSelection({ selection: { view: refs.view.value, anchors } });
	}
	refs.stage.addEventListener("pointerdown", (event) => {
		if (event.button !== 0 || !ready()) return;
		const rect = imageContentRect({ bounds: refs.source.getBoundingClientRect(), ...state.photo });
		const point = pointInImage({ point: { x: event.clientX, y: event.clientY }, rect });
		if (!point) return;
		const nearIndex = points.findIndex((existing) => Math.hypot((existing[0] - point[0]) * rect.width,
			(existing[1] - point[1]) * rect.height) <= 14);
		if (nearIndex >= 0) { selectPoint({ index: nearIndex }); draw(); return; }
		add({ point });
	});
	refs.stage.addEventListener("keydown", (event) => {
		if (event.key === "Enter") { event.preventDefault(); refs.add.click(); }
	});
	refs.point.addEventListener("change", () => { selectPoint({ index: Number(refs.point.value) }); draw(); });
	refs.add.addEventListener("click", () => add({ point: [Number(refs.x.value) / 100, Number(refs.y.value) / 100] }));
	refs.move.addEventListener("click", () => {
		if (!ready() || !points[selectedIndex]) return;
		const point = [Number(refs.x.value) / 100, Number(refs.y.value) / 100];
		if (!validPoint({ point, index: selectedIndex })) return;
		points[selectedIndex] = point;
		draftMessage(); draw();
	});
	refs.undo.addEventListener("click", () => {
		points.pop(); selectPoint({ index: points.length - 1 }); draw(); draftMessage();
	});
	function restart() {
		points = []; selectPoint({ index: -1 }); draw();
		message({ text: `请标记${labels()[0]}。新点位保存前，上方结果仍对应上次已保存的设置。` });
	}
	refs.view.addEventListener("change", restart);
	refs.restart.addEventListener("click", restart);
	refs.clear.addEventListener("click", () => {
		const { buttocks, ...edits } = state.edits;
		if (Object.hasOwn(state.photo || {}, "buttocksDetection")) edits.autoButtocks = true;
		if (buttocks || edits.autoButtocks !== state.edits.autoButtocks) controller.setEdits({ edits });
		sourcePoints();
		const detection = automaticGluteDetection({ photo: state.photo });
		message({ text: detection ? detection.available
			? "已恢复自动定位，调整提臀滑杆后重新应用。" : `自动定位不可用：${detection.reason}`
			: "已清除定位，提臀恢复原有关节模式。" });
	});
	refs.save.addEventListener("click", () => {
		try {
			controller.setEdits({ edits: { ...state.edits, buttocks: manualSelection() } });
			message({ text: "手动定位已保存并优先使用。调整「提臀」滑杆后点击应用；轮廓过小或贴边时会停止处理。" });
		} catch (error) { message({ text: error.message }); }
	});
	refs.source.addEventListener("load", draw);
	root.getElementById("glute-details").addEventListener("toggle", draw);
	const observer = new ResizeObserver(draw);
	observer.observe(refs.stage);
	function update({ nextState }) {
		state = nextState;
		refs.editor.hidden = !state.catalog?.controls.some((control) => control.name === "ButtLift");
		const detection = automaticGluteDetection({ photo: state.photo });
		refs.detection.textContent = !state.photo ? "导入照片后检查提臀定位。" : state.edits.buttocks
			? "正在使用手动校正定位；可恢复自动定位。" : detection?.available
				? `已获得自动轮廓估计${detection.confidence === undefined ? "" : `（置信度 ${Math.round(detection.confidence * 100)}%）`}，可直接调提臀滑杆并应用；定位不准可展开校正。`
				: detection ? `自动定位不可用：${detection.reason}` : "可展开标记侧面／背面臀部轮廓。";
		if (detection && !state.edits.buttocks && state.edits.autoButtocks !== true)
			refs.detection.textContent = "自动定位已关闭，可恢复自动定位或使用手动定位。";
		refs.clear.textContent = detection ? "恢复自动定位" : "清除定位，恢复关节模式";
		const nextIdentity = state.photo?.photoId || "";
		const nextSaved = JSON.stringify({ buttocks: state.edits.buttocks, automatic: state.edits.autoButtocks,
			detection, reset: state.editResetVersion });
		if (nextIdentity !== identity || nextSaved !== saved) {
			sourcePoints(); identity = nextIdentity; saved = nextSaved;
			message({ text: state.edits.buttocks ? "已保存手动定位，可继续调提臀滑杆并应用。" : points.length
				? "显示自动估计点。可直接调提臀；校正时选中点更新坐标，再保存这组定位。"
				: `请在原图标记${labels()[0]}，也可用坐标输入。` });
		}
		for (const id of ["view", "x", "y", "add", "undo", "restart", "save", "clear"]) refs[id].disabled = !ready();
		if (state.photo && refs.source.getAttribute("src") !== state.photo.url) refs.source.src = state.photo.url;
		if (!state.photo) refs.source.removeAttribute("src");
		draw();
	}
	return { update, dispose() { observer.disconnect(); } };
}
