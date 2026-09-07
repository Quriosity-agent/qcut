import type { BrowserWindow } from "electron";
import type {
	AgentPointerHitTestRequest,
	AgentPointerHitTestResult,
} from "../../types/claude-api.js";
import { buildSnapshotActionPrelude } from "./claude-snapshot-handler.js";

/**
 * In-page script that reports what `document.elementFromPoint` finds at an
 * editor viewport point, using the snapshot prelude's role/name/value helpers
 * so the answer matches what snapshots and pointer targets report.
 */
function buildHitTestScript({ x, y }: AgentPointerHitTestRequest): string {
	return `(() => {
		${buildSnapshotActionPrelude()}
		const x = ${JSON.stringify(x)};
		const y = ${JSON.stringify(y)};
		const describeBounds = (element) => {
			const rect = element.getBoundingClientRect();
			return {
				x: Math.round(rect.x),
				y: Math.round(rect.y),
				width: Math.round(rect.width),
				height: Math.round(rect.height),
			};
		};
		const element = document.elementFromPoint(x, y);
		if (!(element instanceof Element)) {
			return { action: "hit-test", x, y, hit: false, element: null, ancestors: [] };
		}
		const ancestors = [];
		let cursor = element.parentElement;
		while (cursor && ancestors.length < 8) {
			const testId = cursor.getAttribute("data-testid");
			if (testId) {
				ancestors.push({ tagName: cursor.tagName.toLowerCase(), testId });
			}
			cursor = cursor.parentElement;
		}
		const htmlElement = element instanceof HTMLElement ? element : null;
		return {
			action: "hit-test",
			x,
			y,
			hit: true,
			element: {
				tagName: element.tagName.toLowerCase(),
				role: htmlElement ? getRole(htmlElement) : element.getAttribute("role"),
				name: htmlElement ? getName(htmlElement) : null,
				value: htmlElement ? getValue(htmlElement) : null,
				testId: element.getAttribute("data-testid"),
				ref: element.getAttribute(REF_ATTR),
				disabled:
					element.hasAttribute("disabled") ||
					element.getAttribute("aria-disabled") === "true",
				bounds: describeBounds(element),
			},
			ancestors,
		};
	})()`;
}

/** Report the element under an editor viewport point without dispatching input. */
export async function hitTestEditorPoint(
	win: BrowserWindow,
	request: AgentPointerHitTestRequest
): Promise<AgentPointerHitTestResult> {
	const result = await win.webContents.executeJavaScript(
		buildHitTestScript(request)
	);
	if (
		typeof result !== "object" ||
		result === null ||
		(result as { action?: unknown }).action !== "hit-test"
	) {
		throw new Error("Renderer returned an invalid pointer hit-test result");
	}
	return result as AgentPointerHitTestResult;
}
