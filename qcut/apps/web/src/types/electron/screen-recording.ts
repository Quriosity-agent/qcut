/**
 * Screen recording types.
 */

export type ScreenCaptureSourceType = "window" | "screen";

export interface ScreenCaptureSource {
	id: string;
	name: string;
	type: ScreenCaptureSourceType;
	displayId: string;
	isCurrentWindow: boolean;
}

export interface StartScreenRecordingOptions {
	sourceId?: string;
	filePath?: string;
	fileName?: string;
	mimeType?: string;
}

export interface StartScreenRecordingResult {
	sessionId: string;
	sourceId: string;
	sourceName: string;
	filePath: string;
	startedAt: number;
	mimeType: string | null;
}

export interface StopScreenRecordingOptions {
	sessionId?: string;
	discard?: boolean;
}

export interface StopScreenRecordingResult {
	success: boolean;
	filePath: string | null;
	bytesWritten: number;
	durationMs: number;
	discarded: boolean;
}

export interface ScreenRecordingStatus {
	state: "idle" | "recording";
	recording: boolean;
	sessionId: string | null;
	sourceId: string | null;
	sourceName: string | null;
	filePath: string | null;
	bytesWritten: number;
	startedAt: number | null;
	durationMs: number;
	mimeType: string | null;
}
