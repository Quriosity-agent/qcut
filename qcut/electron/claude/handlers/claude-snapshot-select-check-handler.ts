import type { BrowserWindow } from "electron";
import type {
	EditorSnapshotActionResult,
	EditorSnapshotCheckRequest,
	EditorSnapshotSelectRequest,
} from "../../types/claude-api.js";
import {
	buildSnapshotActionPrelude,
	executeSnapshotAction,
	normalizeSnapshotRef,
} from "./claude-snapshot-handler.js";

/**
 * How long to wait for a toggle to settle before calling it a failure.
 *
 * Every toggle QCut ships is React-controlled, so the control renders its
 * state from props and cannot change it inside `click()`: React commits in a
 * microtask. Reading the state back on the next line therefore always returns
 * the pre-click value, which is why this command used to answer `check_failed`
 * for toggles that had in fact worked.
 */
const CHECK_SETTLE_TIMEOUT_MS = 1000;

/**
 * Polled on a timer rather than `requestAnimationFrame`: a hidden, minimised
 * or occluded window stops painting, and these commands exist to drive the
 * editor without bringing it to the front, so rAF may never fire at all.
 * Timers are throttled in that state but they still run, so the deadline is
 * always reached.
 */
const CHECK_POLL_INTERVAL_MS = 16;

function buildSnapshotSelectScript({
	request,
}: {
	request: EditorSnapshotSelectRequest;
}): string {
	const ref = normalizeSnapshotRef({ ref: request.ref });
	return `(() => {
		${buildSnapshotActionPrelude()}
		const targetRef = ${JSON.stringify(ref)};
		const selectValue = ${JSON.stringify(request.value)};
		const element = findElementByRef(targetRef);
		if (!(element instanceof HTMLElement)) {
			return buildFailure("not_found", "No element found for snapshot ref " + targetRef + ". Capture a fresh snapshot first.");
		}

		const disabled =
			element.hasAttribute("disabled") ||
			element.getAttribute("aria-disabled") === "true";
		if (disabled) {
			return buildFailure("disabled", "Cannot select on a disabled element.");
		}

		if (element instanceof HTMLSelectElement) {
			const option = Array.from(element.options).find(
				(opt) => opt.value === selectValue || opt.textContent?.trim() === selectValue
			);
			if (!option) {
				return buildFailure("invalid_option", "Option " + JSON.stringify(selectValue) + " not found in select element " + targetRef + ".");
			}
			element.value = option.value;
			element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
			element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
			return buildSuccess(element, "select", targetRef);
		}

		if (element.getAttribute("role") === "combobox" || element.getAttribute("role") === "listbox") {
			element.focus();
			element.click();
			// Look for a matching option within the listbox/combobox after opening
			const listboxId = element.getAttribute("aria-controls") || element.getAttribute("aria-owns");
			const listbox = listboxId ? document.getElementById(listboxId) : element;
			if (listbox && selectValue) {
				const options = listbox.querySelectorAll('[role="option"]');
				let matched = false;
				for (const opt of options) {
					const optText = opt.textContent?.trim();
					const optVal = opt.getAttribute("data-value") || opt.getAttribute("value");
					if (optText === selectValue || optVal === selectValue) {
						opt.click();
						matched = true;
						break;
					}
				}
				if (!matched) {
					return buildFailure("invalid_option", "Option " + JSON.stringify(selectValue) + " not found in combobox/listbox " + targetRef + ".");
				}
			}
			return buildSuccess(element, "select", targetRef);
		}

		return buildFailure("invalid_select_target", "Snapshot ref " + targetRef + " is not a select element or combobox.");
	})()`;
}

function buildSnapshotCheckScript({
	request,
}: {
	request: EditorSnapshotCheckRequest;
}): string {
	const ref = normalizeSnapshotRef({ ref: request.ref });
	return `(async () => {
		${buildSnapshotActionPrelude()}
		const targetRef = ${JSON.stringify(ref)};
		const desiredChecked = ${JSON.stringify(request.checked)};
		const settleTimeoutMs = ${CHECK_SETTLE_TIMEOUT_MS};
		const pollIntervalMs = ${CHECK_POLL_INTERVAL_MS};

		// A native checkbox keeps its state in the DOM property, which the
		// attribute never tracks; an ARIA switch keeps it in aria-checked, and
		// Radix primitives also mirror it into data-state.
		const readChecked = (node) => {
			if (node instanceof HTMLInputElement && (node.type === "checkbox" || node.type === "radio")) {
				return node.indeterminate ? "mixed" : node.checked;
			}
			const aria = node.getAttribute("aria-checked");
			if (aria === "true") return true;
			if (aria === "false") return false;
			if (aria === "mixed") return "mixed";
			const dataState = node.getAttribute("data-state");
			if (dataState === "checked") return true;
			if (dataState === "unchecked") return false;
			if (dataState === "indeterminate") return "mixed";
			return null;
		};

		const element = findElementByRef(targetRef);
		if (!(element instanceof HTMLElement)) {
			return buildFailure("not_found", "No element found for snapshot ref " + targetRef + ". Capture a fresh snapshot first.");
		}

		const disabled =
			element.hasAttribute("disabled") ||
			element.getAttribute("aria-disabled") === "true";
		if (disabled) {
			return buildFailure("disabled", "Cannot toggle a disabled element.");
		}

		const role = element.getAttribute("role");
		const nativeToggle =
			element instanceof HTMLInputElement &&
			(element.type === "checkbox" || element.type === "radio");
		if (!nativeToggle && role !== "checkbox" && role !== "switch" && role !== "radio") {
			return buildFailure("invalid_check_target", "Snapshot ref " + targetRef + " is not a checkbox, radio, or switch element.");
		}

		// Already in the requested state: that is the outcome asked for, and
		// clicking would move it away from it.
		if (readChecked(element) === desiredChecked) {
			return Object.assign(buildSuccess(element, "check", targetRef), {
				checked: desiredChecked,
				changed: false,
			});
		}

		element.click();

		let current = element;
		let observed = readChecked(current);
		const deadlineAt = Date.now() + settleTimeoutMs;
		while (observed !== desiredChecked) {
			if (Date.now() >= deadlineAt) {
				return buildFailure("check_failed", "Element " + targetRef + " still reads " + String(observed) + " after " + settleTimeoutMs + "ms, so it could not be toggled to " + (desiredChecked ? "checked" : "unchecked") + " state.");
			}
			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
			// Re-resolve every pass: a re-render can replace the node the ref
			// pointed at, and the prelude recovers it by stable key.
			const live = findElementByRef(targetRef);
			if (live instanceof HTMLElement) {
				current = live;
			}
			observed = readChecked(current);
		}

		return Object.assign(buildSuccess(current, "check", targetRef), {
			checked: desiredChecked,
			changed: true,
		});
	})()`;
}

export async function selectEditorSnapshotRef(
	win: BrowserWindow,
	request: EditorSnapshotSelectRequest
): Promise<EditorSnapshotActionResult> {
	return await executeSnapshotAction({
		win,
		script: buildSnapshotSelectScript({ request }),
	});
}

export async function checkEditorSnapshotRef(
	win: BrowserWindow,
	request: EditorSnapshotCheckRequest
): Promise<EditorSnapshotActionResult> {
	return await executeSnapshotAction({
		win,
		script: buildSnapshotCheckScript({ request }),
	});
}
