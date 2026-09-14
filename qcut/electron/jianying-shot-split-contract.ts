/**
 * Shared types for offline shot-boundary detection with the Jianying
 * 智能镜头分割 model, executed from QCut's private runtime snapshot
 * (`~/Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit`)
 * without launching the Jianying app.
 */

export const JIANYING_SHOT_SPLIT_ROUTE = "qcut-jianying-shot-split-v1" as const;

export interface JianyingShotSplitStatus {
	appVersion?: string;
	available: boolean;
	coreSha256?: string;
	coreUuid?: string;
	localOnly: true;
	message: string;
	offlineReady: boolean;
	platformSupported: boolean;
	route: typeof JIANYING_SHOT_SPLIT_ROUTE;
	runtimeRoot?: string;
}

export interface JianyingShotSplitSampling {
	/** Frames per second fed to the model; its 7-frame window is tuned for 12–24 fps. */
	fps: number;
	height: number;
	width: number;
}

export interface JianyingShotSplitRequest
	extends Partial<JianyingShotSplitSampling> {
	sourcePath: string;
}

export interface JianyingShotSplitShot {
	/** Inclusive index of the last sampled frame in this shot. */
	endFrame: number;
	endTime: number;
	index: number;
	startFrame: number;
	startTime: number;
}

export interface JianyingShotSplitResult extends JianyingShotSplitSampling {
	appVersion: string;
	coreUuid: string;
	/** The model's `predict_result`: last sampled frame index of every shot but the final one. */
	cutFrames: number[];
	/** Seconds at which each new shot starts. */
	cutPoints: number[];
	durationSeconds: number;
	elapsedMs: number;
	frameCount: number;
	route: typeof JIANYING_SHOT_SPLIT_ROUTE;
	shots: JianyingShotSplitShot[];
	sourcePath: string;
}

export interface JianyingShotSplitProgress {
	progress: number;
	stage: "collect" | "decode" | "prepare" | "probe" | "verify";
	status: string;
}
