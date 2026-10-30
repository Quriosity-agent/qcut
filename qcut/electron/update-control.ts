/**
 * QCut's own updates for the editor API (`editor:updates:status`, `pause`,
 * `resume`): N26, 2026-10-30 trailer report, where an update installed
 * itself while a project was under way. The main process owns the updater,
 * so the utility process's server asks here through a main request.
 *
 * @module electron/update-control
 */

import type { ClaudeUpdateStatus } from "./types/claude-api.js";
import type { AutoUpdateController } from "./auto-update-controller.js";
import { toReleaseVersion } from "./update-version.js";

export const UPDATE_STATUS_CHANNEL = "updates:status";
export const UPDATE_SET_PAUSED_CHANNEL = "updates:set-paused";

let controller: AutoUpdateController | undefined;
let appVersion = "";

/** Called once the packaged app has its updater (never in a dev build). */
export function registerUpdateControl({
	updateController,
	packageVersion,
}: {
	updateController?: AutoUpdateController;
	packageVersion: string;
}): void {
	controller = updateController;
	appVersion = packageVersion;
}

export function getUpdateStatus(): ClaudeUpdateStatus {
	if (!controller) {
		return {
			available: false,
			paused: false,
			automaticUpdates: false,
			phase: "unavailable",
			currentVersion: appVersion
				? toReleaseVersion({ packageVersion: appVersion })
				: "",
			message: "This QCut does not update itself (a development build)",
		};
	}
	const state = controller.getState();
	const preferences = controller.getPreferences();
	return {
		available: true,
		paused: preferences.paused,
		automaticUpdates: preferences.automaticUpdates,
		phase: state.phase,
		currentVersion: state.currentVersion,
		...(state.version && state.version !== state.staged?.version
			? { version: state.version }
			: {}),
		...(state.staged ? { staged: state.staged.version } : {}),
		...(state.message ? { message: state.message } : {}),
	};
}

export function setUpdatesPaused({
	paused,
}: {
	paused: boolean;
}): ClaudeUpdateStatus {
	if (!controller) {
		throw new Error("This QCut does not update itself (a development build)");
	}
	controller.setPreferences({ preferences: { paused } });
	return getUpdateStatus();
}

/** The main-request channels above, for the utility process's server. */
export function handleUpdateControlRequest({
	channel,
	data,
}: {
	channel: string;
	data: unknown;
}): ClaudeUpdateStatus | undefined {
	if (channel === UPDATE_STATUS_CHANNEL) return getUpdateStatus();
	if (channel === UPDATE_SET_PAUSED_CHANNEL) {
		return setUpdatesPaused({
			paused: (data as { paused?: unknown })?.paused === true,
		});
	}
	return undefined;
}
