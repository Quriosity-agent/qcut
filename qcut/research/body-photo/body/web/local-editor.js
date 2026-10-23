import { clampStroke, imageContentRect, pointInImage } from "./edits-contract.js";

export function createLocalEditor({ controller, root = document }) {
	const refs = Object.fromEntries([
		"background-protection", "manual-toggle", "manual-panel", "manual-stage", "manual-source",
		"manual-overlay", "manual-radius", "manual-radius-output", "manual-x", "manual-y",
		"manual-dx", "manual-dy", "manual-add", "manual-undo", "manual-clear", "manual-count",
		"manual-message", "edit-feedback",
	].map((id) => [id, root.getElementById(id)]));
	let state = controller.getState();
	let photoId = null;
	let drag = null;
	let enabled = false;
	let draft = null;
	const svgNamespace = "http://www.w3.org/2000/svg";

	function radius() {
		return Number(refs["manual-radius"].value) / 100;
	}
	function canEdit() {
		return Boolean(state.photo && !state.uploading && state.catalog?.platform.supported);
	}
	function strokeFromInputs() {
		if (!state.photo || ["manual-x", "manual-y", "manual-dx", "manual-dy"].some((id) => refs[id].value.trim() === "")) return null;
		const x = Number(refs["manual-x"].value) / 100;
		const y = Number(refs["manual-y"].value) / 100;
		const dx = Number(refs["manual-dx"].value) / 100;
		const dy = Number(refs["manual-dy"].value) / 100;
		if (![x, y, dx, dy].every(Number.isFinite)) return null;
		return clampStroke({ start: [x, y], end: [x + dx, y + dy], radius: radius(), ...state.photo });
	}
	function writeInputs({ stroke }) {
		for (const [id, value] of [["manual-x", stroke.start[0]], ["manual-y", stroke.start[1]],
			["manual-dx", stroke.end[0] - stroke.start[0]], ["manual-dy", stroke.end[1] - stroke.start[1]]])
			refs[id].value = (value * 100).toFixed(3);
	}
	function contentRect() {
		if (!state.photo) return null;
		return imageContentRect({ bounds: refs["manual-source"].getBoundingClientRect(), ...state.photo });
	}
	function svgElement({ tag, attributes }) {
		const node = root.createElementNS(svgNamespace, tag);
		for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
		return node;
	}
	function draw() {
		const overlay = refs["manual-overlay"];
		overlay.replaceChildren();
		if (!enabled || !state.photo) return;
		const rect = contentRect();
		const bounds = refs["manual-stage"].getBoundingClientRect();
		overlay.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
		const strokes = [...state.edits.strokes, ...(draft ? [draft] : [])];
		for (const [index, stroke] of strokes.entries()) {
			const x1 = rect.left - bounds.left + stroke.start[0] * rect.width;
			const y1 = rect.top - bounds.top + stroke.start[1] * rect.height;
			const x2 = rect.left - bounds.left + stroke.end[0] * rect.width;
			const y2 = rect.top - bounds.top + stroke.end[1] * rect.height;
			const color = index === state.edits.strokes.length ? "#a5e1ca" : "#f3c083";
			const group = svgElement({ tag: "g", attributes: { stroke: color, fill: "none", "stroke-width": 1.6 } });
			group.append(svgElement({ tag: "circle", attributes: { cx: x1, cy: y1,
				r: stroke.radius * Math.min(rect.width, rect.height), "stroke-dasharray": "4 4" } }));
			group.append(svgElement({ tag: "line", attributes: { x1, y1, x2, y2 } }));
			const angle = Math.atan2(y2 - y1, x2 - x1);
			const arrow = 7;
			group.append(svgElement({ tag: "path", attributes: { d:
				`M ${x2 - arrow * Math.cos(angle - 0.5)} ${y2 - arrow * Math.sin(angle - 0.5)} L ${x2} ${y2} L ${x2 - arrow * Math.cos(angle + 0.5)} ${y2 - arrow * Math.sin(angle + 0.5)}` } }));
			group.append(svgElement({ tag: "circle", attributes: { cx: x1, cy: y1, r: 2.5, fill: color } }));
			overlay.append(group);
		}
	}
	function setMessage({ message }) {
		refs["manual-message"].textContent = message;
	}
	function appendStroke({ stroke }) {
		if (!canEdit()) return;
		if (!stroke) {
			setMessage({ message: "请输入有效的起点坐标和位移。" });
			return;
		}
		if (state.edits.strokes.length >= 32) {
			setMessage({ message: "已达到 32 笔，请撤销或清空后再添加。" });
			return;
		}
		if (Math.hypot(stroke.end[0] - stroke.start[0], stroke.end[1] - stroke.start[1]) < 1e-8) {
			setMessage({ message: "起点和终点相同，请拖动或输入移动量。" });
			return;
		}
		controller.setEdits({ edits: { ...state.edits, strokes: [...state.edits.strokes, stroke] } });
		setMessage({ message: "已记录这笔位移。点击「应用调整」查看实际结果；绿色为下一笔预览。" });
	}
	function cancelDrag() {
		const pointerId = drag?.pointerId;
		drag = null;
		if (pointerId !== undefined && refs["manual-stage"].hasPointerCapture(pointerId))
			refs["manual-stage"].releasePointerCapture(pointerId);
		draft = strokeFromInputs();
		draw();
	}
	function toggle({ checked }) {
		enabled = checked && canEdit();
		refs["manual-toggle"].checked = enabled;
		refs["manual-panel"].hidden = !enabled;
		cancelDrag();
		if (enabled) draw();
	}
	function update({ nextState }) {
		state = nextState;
		if (state.photo?.photoId !== photoId) {
			photoId = state.photo?.photoId || null;
			toggle({ checked: false });
			refs["manual-x"].value = "50";
			refs["manual-y"].value = "50";
			refs["manual-dx"].value = "-2";
			refs["manual-dy"].value = "0";
			setMessage({ message: "在原图上拖动一笔，或输入起点和位移后添加。" });
		}
		const ready = canEdit();
		refs["background-protection"].checked = state.edits.backgroundProtection;
		refs["background-protection"].disabled = !ready;
		refs["manual-toggle"].disabled = !ready;
		for (const id of ["manual-radius", "manual-x", "manual-y", "manual-dx", "manual-dy"])
			refs[id].disabled = !ready;
		refs["manual-add"].disabled = !ready || state.edits.strokes.length >= 32;
		refs["manual-undo"].disabled = !ready || state.edits.strokes.length === 0;
		refs["manual-clear"].disabled = refs["manual-undo"].disabled;
		refs["manual-count"].textContent = `${state.edits.strokes.length} / 32 笔`;
		if (state.photo && refs["manual-source"].getAttribute("src") !== state.photo.url)
			refs["manual-source"].src = state.photo.url;
		if (!state.photo) refs["manual-source"].removeAttribute("src");
		refs["edit-feedback"].replaceChildren();
		for (const feedback of Object.values(state.result?.editFeedback || {})) {
			if (!feedback?.message) continue;
			const item = root.createElement("li");
			item.textContent = feedback.message;
			refs["edit-feedback"].append(item);
		}
		refs["edit-feedback"].hidden = refs["edit-feedback"].childElementCount === 0;
		draft = strokeFromInputs();
		draw();
	}

	refs["background-protection"].addEventListener("change", () =>
		controller.setEdits({ edits: { ...state.edits, backgroundProtection: refs["background-protection"].checked } }));
	refs["manual-toggle"].addEventListener("change", () => toggle({ checked: refs["manual-toggle"].checked }));
	refs["manual-radius"].addEventListener("input", () => {
		refs["manual-radius-output"].value = `${refs["manual-radius"].value}%`;
		draft = strokeFromInputs();
		draw();
	});
	for (const id of ["manual-x", "manual-y", "manual-dx", "manual-dy"])
		refs[id].addEventListener("input", () => { draft = strokeFromInputs(); draw(); });
	refs["manual-add"].addEventListener("click", () => {
		const stroke = strokeFromInputs();
		if (stroke) writeInputs({ stroke });
		appendStroke({ stroke });
	});
	refs["manual-undo"].addEventListener("click", () => {
		controller.setEdits({ edits: { ...state.edits, strokes: state.edits.strokes.slice(0, -1) } });
		setMessage({ message: "已撤销最后一笔；点击应用更新实际结果。" });
	});
	refs["manual-clear"].addEventListener("click", () => {
		controller.setEdits({ edits: { ...state.edits, strokes: [] } });
		setMessage({ message: "已清空局部修形；自动比例滑杆和背景保护设置保留。" });
	});
	refs["manual-stage"].addEventListener("pointerdown", (event) => {
		if (!enabled || !canEdit() || event.button !== 0 || drag) return;
		const start = pointInImage({ point: { x: event.clientX, y: event.clientY }, rect: contentRect() });
		if (!start) return;
		event.preventDefault();
		drag = { start, pointerId: event.pointerId };
		refs["manual-stage"].setPointerCapture(event.pointerId);
		draft = clampStroke({ start, end: start, radius: radius(), ...state.photo });
		draw();
	});
	function updateDrag({ event }) {
		if (!drag || drag.pointerId !== event.pointerId) return;
		const end = pointInImage({ point: { x: event.clientX, y: event.clientY }, rect: contentRect(), clamp: true });
		draft = clampStroke({ start: drag.start, end, radius: radius(), ...state.photo });
		draw();
	}
	refs["manual-stage"].addEventListener("pointermove", (event) => updateDrag({ event }));
	refs["manual-stage"].addEventListener("pointerup", (event) => {
		if (!drag || drag.pointerId !== event.pointerId) return;
		updateDrag({ event });
		const stroke = draft;
		drag = null;
		refs["manual-stage"].releasePointerCapture(event.pointerId);
		writeInputs({ stroke });
		appendStroke({ stroke });
	});
	refs["manual-stage"].addEventListener("pointercancel", cancelDrag);
	refs["manual-stage"].addEventListener("lostpointercapture", () => { if (drag) cancelDrag(); });
	refs["manual-stage"].addEventListener("keydown", (event) => {
		if (!enabled || !canEdit()) return;
		if (event.key === "Escape") { event.preventDefault(); cancelDrag(); return; }
		if (event.key === "Enter") { event.preventDefault(); appendStroke({ stroke: strokeFromInputs() }); return; }
		const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
		if (!directions[event.key]) return;
		event.preventDefault();
		const step = event.shiftKey ? 1 : 0.25;
		const [dx, dy] = directions[event.key];
		refs["manual-dx"].value = String(Number(refs["manual-dx"].value) + dx * step);
		refs["manual-dy"].value = String(Number(refs["manual-dy"].value) + dy * step);
		draft = strokeFromInputs();
		if (draft) writeInputs({ stroke: draft });
		draw();
	});
	refs["manual-source"].addEventListener("load", draw);
	const observer = new ResizeObserver(draw);
	observer.observe(refs["manual-stage"]);
	return { update, dispose() { observer.disconnect(); } };
}
