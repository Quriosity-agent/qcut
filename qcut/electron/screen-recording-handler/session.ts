import { desktopCapturer, session } from "electron";
import {
	SCREEN_RECORDING_STATE,
	type ActiveScreenRecordingSession,
	type ScreenRecordingStatus,
} from "./types.js";
import { log } from "./logger.js";

let activeSession: ActiveScreenRecordingSession | null = null;
let isDisplayMediaHandlerConfigured = false;

export function getActiveSession(): ActiveScreenRecordingSession | null {
	return activeSession;
}

export function setActiveSession(
	value: ActiveScreenRecordingSession | null
): void {
	activeSession = value;
}

export function setDisplayMediaHandlerConfigured(value: boolean): void {
	isDisplayMediaHandlerConfigured = value;
}

export function buildStatus(): ScreenRecordingStatus {
	if (!activeSession) {
		return {
			state: SCREEN_RECORDING_STATE.IDLE,
			recording: false,
			sessionId: null,
			sourceId: null,
			sourceName: null,
			filePath: null,
			bytesWritten: 0,
			startedAt: null,
			durationMs: 0,
			mimeType: null,
		};
	}

	const durationMs = Math.max(0, Date.now() - activeSession.startedAt);
	return {
		state: SCREEN_RECORDING_STATE.RECORDING,
		recording: true,
		sessionId: activeSession.sessionId,
		sourceId: activeSession.sourceId,
		sourceName: activeSession.sourceName,
		filePath: activeSession.filePath,
		bytesWritten: activeSession.bytesWritten,
		startedAt: activeSession.startedAt,
		durationMs,
		mimeType: activeSession.mimeType,
	};
}

async function resolveSourceForDisplayRequest({
	sourceId,
}: {
	sourceId: string;
}): Promise<{ id: string; name: string } | null> {
	try {
		const sources = await desktopCapturer.getSources({
			types: ["window", "screen"],
			thumbnailSize: { width: 1, height: 1 },
			fetchWindowIcons: false,
		});
		const selectedSource = sources.find((source) => source.id === sourceId);
		if (!selectedSource) {
			return null;
		}
		return { id: selectedSource.id, name: selectedSource.name };
	} catch (error) {
		log.error("[ScreenRecordingIPC] Failed to resolve display source:", error);
		return null;
	}
}

export function ensureDisplayMediaHandlerConfigured(): void {
	if (isDisplayMediaHandlerConfigured) {
		return;
	}

	try {
		session.defaultSession.setDisplayMediaRequestHandler(
			(_request, callback) => {
				const handleDisplayMediaRequest = async (): Promise<void> => {
					try {
						if (!activeSession) {
							callback({});
							return;
						}

						const source = await resolveSourceForDisplayRequest({
							sourceId: activeSession.sourceId,
						});
						if (!source) {
							callback({});
							return;
						}

						callback({ video: source });
					} catch (error) {
						log.error(
							"[ScreenRecordingIPC] Display media request handler failed:",
							error
						);
						callback({});
					}
				};

				handleDisplayMediaRequest().catch((error) => {
					log.error(
						"[ScreenRecordingIPC] Unexpected display media request error:",
						error
					);
					callback({});
				});
			},
			{ useSystemPicker: false }
		);

		isDisplayMediaHandlerConfigured = true;
	} catch (error) {
		log.error(
			"[ScreenRecordingIPC] Failed to configure display media handler:",
			error
		);
	}
}
