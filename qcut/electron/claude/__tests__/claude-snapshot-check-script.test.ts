/**
 * Runs the real `editor:snapshot:check` script against a real DOM.
 *
 * The rest of the snapshot suite stubs `executeJavaScript` with a canned
 * result, so nothing ever evaluated the injected script — which is how N33
 * (a toggle that worked being reported as `check_failed`) shipped on two
 * builds. These tests evaluate it in JSDOM instead, so the asynchrony of a
 * React-controlled toggle is actually exercised.
 */
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { EDITOR_SNAPSHOT_REF_ATTRIBUTE } from "../../types/claude-snapshot-api.js";
import { checkEditorSnapshotRef } from "../handlers/claude-snapshot-select-check-handler.js";

const REF = "@e1";

function createWindow({ body }: { body: string }): {
	win: Electron.BrowserWindow;
	dom: JSDOM;
} {
	const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
		url: "http://localhost:3000",
		runScripts: "dangerously",
	});
	const win = {
		webContents: {
			executeJavaScript: (script: string) => dom.window.eval(script),
		},
	} as unknown as Electron.BrowserWindow;
	return { win, dom };
}

/**
 * A control that renders its state from a variable the click handler only
 * schedules, the way a React-controlled Radix switch behaves: the attribute
 * cannot have moved by the time `click()` returns.
 */
function switchMarkup({
	commitIn,
	checked = "false",
	stateAttribute = "aria-checked",
}: {
	/** "never" leaves the control stuck; a number commits after that many ms. */
	commitIn: number | "never" | "microtask";
	checked?: string;
	stateAttribute?: string;
}): string {
	const commit =
		commitIn === "never"
			? ""
			: commitIn === "microtask"
				? "Promise.resolve().then(apply);"
				: `setTimeout(apply, ${commitIn});`;
	// data-state spells the states "checked"/"unchecked"; aria-checked uses
	// "true"/"false". A toggle written against the wrong vocabulary reads as
	// no state at all.
	const [onValue, offValue] =
		stateAttribute === "data-state"
			? ["checked", "unchecked"]
			: ["true", "false"];
	return `
		<button id="toggle" role="switch" ${stateAttribute}="${checked}"
			${EDITOR_SNAPSHOT_REF_ATTRIBUTE}="${REF}"></button>
		<script>
			var node = document.getElementById("toggle");
			window.__clicks = 0;
			function apply() {
				node.setAttribute("${stateAttribute}",
					node.getAttribute("${stateAttribute}") === "${onValue}"
						? "${offValue}"
						: "${onValue}");
			}
			node.addEventListener("click", function () {
				window.__clicks += 1;
				${commit}
			});
		</script>
	`;
}

describe("editor:snapshot:check script", () => {
	it("waits for a controlled switch that commits in a microtask", async () => {
		const { win, dom } = createWindow({
			body: switchMarkup({ commitIn: "microtask" }),
		});

		const result = await checkEditorSnapshotRef(win, {
			ref: REF,
			checked: true,
		});

		expect(result.action).toBe("check");
		expect(result.checked).toBe(true);
		expect(result.changed).toBe(true);
		expect(dom.window.eval("window.__clicks")).toBe(1);
	});

	it("waits for a toggle whose state lands after an IPC round trip", async () => {
		const { win } = createWindow({ body: switchMarkup({ commitIn: 40 }) });

		const result = await checkEditorSnapshotRef(win, {
			ref: REF,
			checked: true,
		});

		expect(result.checked).toBe(true);
		expect(result.changed).toBe(true);
	});

	it("reports success without clicking when already in the requested state", async () => {
		const { win, dom } = createWindow({
			body: switchMarkup({ commitIn: "microtask", checked: "true" }),
		});

		const result = await checkEditorSnapshotRef(win, {
			ref: REF,
			checked: true,
		});

		expect(result.checked).toBe(true);
		expect(result.changed).toBe(false);
		expect(dom.window.eval("window.__clicks")).toBe(0);
	});

	it("reads a Radix primitive that only carries data-state", async () => {
		const { win } = createWindow({
			body: switchMarkup({
				commitIn: "microtask",
				checked: "unchecked",
				stateAttribute: "data-state",
			}),
		});

		const result = await checkEditorSnapshotRef(win, {
			ref: REF,
			checked: true,
		});

		expect(result.checked).toBe(true);
		expect(result.changed).toBe(true);
	});

	it("still fails when the control never moves", async () => {
		const { win } = createWindow({ body: switchMarkup({ commitIn: "never" }) });

		await expect(
			checkEditorSnapshotRef(win, { ref: REF, checked: true })
		).rejects.toThrow(/could not be toggled/);
	});

	it("flips a plain checkbox and reports the state it settled on", async () => {
		const { win } = createWindow({
			body: `<input type="checkbox" ${EDITOR_SNAPSHOT_REF_ATTRIBUTE}="${REF}" />`,
		});

		const result = await checkEditorSnapshotRef(win, {
			ref: REF,
			checked: true,
		});

		expect(result.checked).toBe(true);
		expect(result.changed).toBe(true);
	});

	it("refuses a disabled control before clicking it", async () => {
		const { win, dom } = createWindow({
			body: switchMarkup({ commitIn: "microtask" }).replace(
				'role="switch"',
				'role="switch" aria-disabled="true"'
			),
		});

		await expect(
			checkEditorSnapshotRef(win, { ref: REF, checked: true })
		).rejects.toThrow(/disabled/);
		expect(dom.window.eval("window.__clicks")).toBe(0);
	});
});
