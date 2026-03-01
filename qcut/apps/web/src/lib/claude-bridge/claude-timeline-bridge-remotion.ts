/**
 * Claude Timeline Bridge — Remotion Element Helpers
 * Bundle, load, register Remotion components and add them to the timeline.
 * Extracted from claude-timeline-bridge-helpers.ts to keep files under 800 lines.
 */

import { debugLog, debugWarn, debugError } from "@/lib/debug/debug-config";
import type { ClaudeElement } from "../../../../../electron/types/claude-api";
import type { TimelineStoreState } from "./claude-timeline-bridge-helpers";

const DEFAULT_REMOTION_DURATION_SECONDS = 5;

/** Get element start time, defaulting to 0 if not set. */
function getElementStartTime({
	element,
}: {
	element: Partial<ClaudeElement>;
}): number {
	if (typeof element.startTime === "number" && element.startTime >= 0) {
		return element.startTime;
	}
	return 0;
}

/** Derive element duration from start/end times or use fallback. */
function getElementDuration({
	element,
	fallbackDuration,
}: {
	element: Partial<ClaudeElement>;
	fallbackDuration: number;
}): number {
	if (
		typeof element.startTime === "number" &&
		typeof element.endTime === "number"
	) {
		const rangeDuration = element.endTime - element.startTime;
		if (rangeDuration > 0) {
			return rangeDuration;
		}
	}

	if (typeof element.duration === "number" && element.duration > 0) {
		return element.duration;
	}

	if (fallbackDuration > 0) {
		return fallbackDuration;
	}

	return DEFAULT_REMOTION_DURATION_SECONDS;
}

/**
 * Bundle, load, and register a Remotion component from a .tsx file path.
 * Returns the registered componentId on success, or null on failure.
 */
async function bundleAndRegisterComponent({
	componentPath,
	componentId,
	componentName,
	durationInFrames = 150,
	fps = 30,
	width = 1920,
	height = 1080,
}: {
	componentPath: string;
	componentId: string;
	componentName: string;
	durationInFrames?: number;
	fps?: number;
	width?: number;
	height?: number;
}): Promise<string | null> {
	try {
		const api = window.electronAPI?.remotionFolder;
		if (!api?.bundleFile) {
			debugWarn(
				"[ClaudeTimelineBridge] remotionFolder.bundleFile not available"
			);
			return null;
		}

		debugLog("[ClaudeTimelineBridge] Bundling component:", componentPath);
		const bundleResult = await api.bundleFile(componentPath, componentId);

		if (!bundleResult.success || !bundleResult.code) {
			debugError("[ClaudeTimelineBridge] Bundle failed:", bundleResult.error);
			return null;
		}

		debugLog("[ClaudeTimelineBridge] Loading bundled component...");
		const { loadBundledComponent } = await import(
			"@/lib/remotion/dynamic-loader"
		);
		const loadResult = await loadBundledComponent(
			bundleResult.code,
			componentId
		);

		if (!loadResult.success || !loadResult.component) {
			debugError(
				"[ClaudeTimelineBridge] Dynamic load failed:",
				loadResult.error
			);
			return null;
		}

		debugLog("[ClaudeTimelineBridge] Registering component in store...");
		const { useRemotionStore } = await import("@/stores/ai/remotion-store");
		useRemotionStore.getState().registerComponent({
			id: componentId,
			name: componentName,
			description: `Generated component: ${componentName}`,
			category: "custom",
			durationInFrames,
			fps,
			width,
			height,
			// Dynamically generated components don't export a Zod schema;
			// accept any props since the component handles its own defaults.
			schema: { safeParse: () => ({ success: true, data: {} }) } as never,
			defaultProps: {},
			component: loadResult.component,
			source: "imported",
			tags: ["claude-generated"],
		});

		debugLog("[ClaudeTimelineBridge] Component registered:", componentId);
		return componentId;
	} catch (error) {
		debugError("[ClaudeTimelineBridge] Bundle/register failed:", error);
		return null;
	}
}

/**
 * Import a Remotion folder using the existing folder import pipeline.
 * Scans Root.tsx, bundles all compositions, loads components, registers in store.
 * Returns the list of registered component IDs.
 */
async function importRemotionFolder({
	folderPath,
}: {
	folderPath: string;
}): Promise<string[]> {
	try {
		const api = window.electronAPI?.remotionFolder;
		if (!api?.import) {
			debugWarn("[ClaudeTimelineBridge] remotionFolder.import not available");
			return [];
		}

		debugLog("[ClaudeTimelineBridge] Importing folder:", folderPath);
		const importResult = await api.import(folderPath);

		if (
			!importResult.success ||
			!importResult.bundle ||
			!importResult.scan?.compositions
		) {
			debugError(
				"[ClaudeTimelineBridge] Folder import failed:",
				importResult.error
			);
			return [];
		}

		const { loadComponentsFromFolder } = await import(
			"@/lib/remotion/component-loader"
		);
		const loadResult = await loadComponentsFromFolder(
			folderPath,
			importResult.scan.compositions,
			importResult.bundle.results
		);

		if (!loadResult.success || loadResult.components.length === 0) {
			debugError(
				"[ClaudeTimelineBridge] Component loading failed:",
				loadResult.errors
			);
			return [];
		}

		const { useRemotionStore } = await import("@/stores/ai/remotion-store");
		const store = useRemotionStore.getState();
		const registeredIds: string[] = [];

		for (const component of loadResult.components) {
			store.registerComponent(component);
			registeredIds.push(component.id);
			debugLog("[ClaudeTimelineBridge] Registered component:", component.id);
		}

		return registeredIds;
	} catch (error) {
		debugError("[ClaudeTimelineBridge] Folder import/register failed:", error);
		return [];
	}
}

/** Add a Claude remotion element to the timeline store. */
export async function addClaudeRemotionElement({
	element,
	timelineStore,
}: {
	element: Partial<ClaudeElement>;
	timelineStore: TimelineStoreState;
}): Promise<void> {
	const componentName = element.sourceName || "Remotion";

	// Folder-based import: use the existing remotion-folder pipeline
	if (element.folderPath) {
		const registeredIds = await importRemotionFolder({
			folderPath: element.folderPath,
		});

		if (registeredIds.length === 0) {
			debugWarn("[ClaudeTimelineBridge] No components imported from folder");
			return;
		}

		const trackId = timelineStore.findOrCreateTrack("remotion");
		const startTime = getElementStartTime({ element });
		const duration = getElementDuration({
			element,
			fallbackDuration: DEFAULT_REMOTION_DURATION_SECONDS,
		});

		// Add a timeline element for each imported composition
		let offset = startTime;
		for (const compId of registeredIds) {
			timelineStore.addElementToTrack(trackId, {
				type: "remotion",
				name: compId,
				componentId: compId,
				props: element.props || {},
				renderMode: "live",
				startTime: offset,
				duration,
				trimStart: 0,
				trimEnd: 0,
				opacity: 1,
			});
			offset += duration;
		}

		debugLog(
			"[ClaudeTimelineBridge] Added",
			registeredIds.length,
			"remotion elements from folder"
		);
		return;
	}

	// Single-file fallback: bundle one .tsx file
	const componentId = element.sourceId || `remotion-${Date.now()}`;

	if (element.componentPath) {
		const fps = 30;
		const durationSec = element.duration || DEFAULT_REMOTION_DURATION_SECONDS;
		const registeredId = await bundleAndRegisterComponent({
			componentPath: element.componentPath,
			componentId,
			componentName,
			durationInFrames: Math.round(durationSec * fps),
			fps,
		});

		if (!registeredId) {
			debugWarn(
				"[ClaudeTimelineBridge] Component registration failed, adding element without preview"
			);
		}
	}

	const trackId = timelineStore.findOrCreateTrack("remotion");
	const startTime = getElementStartTime({ element });
	const duration = getElementDuration({
		element,
		fallbackDuration: DEFAULT_REMOTION_DURATION_SECONDS,
	});

	timelineStore.addElementToTrack(trackId, {
		type: "remotion",
		name: componentName,
		componentId,
		componentPath: element.componentPath,
		props: element.props || {},
		renderMode: "live",
		startTime,
		duration,
		trimStart: 0,
		trimEnd: 0,
		opacity: 1,
	});

	debugLog("[ClaudeTimelineBridge] Added remotion element:", componentName);
}
