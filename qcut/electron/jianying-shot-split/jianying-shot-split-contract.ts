/**
 * Shared types for offline shot-boundary detection with the Jianying
 * 智能镜头分割 model. The native
 * bridge runs the original ByteNN models from QCut's private runtime snapshot
 * (`~/Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit`);
 * torch engine uses the recovered PyTorch graph; the opt-in ONNX engine uses
 * a hash-pinned portable graph and a separately named preprocessing profile.
 * None launches the Jianying app or touches the network.
 */

export const JIANYING_SHOT_SPLIT_ROUTE = "qcut-jianying-shot-split-v1" as const;
export const JIANYING_SHOT_SPLIT_TORCH_ROUTE =
	"qcut-jianying-shot-split-torch-v1" as const;
export const JIANYING_SHOT_SPLIT_ONNX_ROUTE =
	"qcut-jianying-shot-split-onnx-v1" as const;

export type JianyingShotSplitRoute =
	| typeof JIANYING_SHOT_SPLIT_ROUTE
	| typeof JIANYING_SHOT_SPLIT_TORCH_ROUTE
	| typeof JIANYING_SHOT_SPLIT_ONNX_ROUTE;

/** `both` compares bridge and torch; `onnx` is an independent opt-in engine. */
export const JIANYING_SHOT_SPLIT_ENGINES = [
	"bridge",
	"torch",
	"both",
	"onnx",
] as const;
export type JianyingShotSplitEngine =
	(typeof JIANYING_SHOT_SPLIT_ENGINES)[number];
export type JianyingShotSplitSingleEngine = Exclude<
	JianyingShotSplitEngine,
	"both"
>;

export interface JianyingShotSplitTorchStatus {
	available: boolean;
	message: string;
	/** Interpreter the engine would spawn, when one was found. */
	python?: string;
	torchVersion?: string;
}

export interface JianyingShotSplitOnnxStatus {
	available: boolean;
	message: string;
	python?: string;
	onnxVersion?: string;
}

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
	torch?: JianyingShotSplitTorchStatus;
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
	engine: JianyingShotSplitSingleEngine;
	frameCount: number;
	route: JianyingShotSplitRoute;
	shots: JianyingShotSplitShot[];
	sourcePath: string;
	/** Reproduction engines: probability keyed by the window's centre frame. */
	scores?: Array<[frame: number, probability: number]>;
	modelSha256?: string;
	preprocessing?: string;
}

export interface JianyingShotSplitProgress {
	progress: number;
	stage: "collect" | "decode" | "prepare" | "probe" | "verify";
	status: string;
}

export interface JianyingShotSplitCutMatch {
	bridgeFrame: number;
	/** `torchFrame - bridgeFrame`, within the comparison tolerance. */
	frameDelta: number;
	torchFrame: number;
}

/** How the two engines' cut lists line up, frame by frame. */
export interface JianyingShotSplitComparison {
	/** Matched pairs divided by the union of both cut sets (1 when identical). */
	agreement: number;
	bridgeElapsedMs: number;
	bridgeOnlyFrames: number[];
	frameCountMatches: boolean;
	matches: JianyingShotSplitCutMatch[];
	maxFrameDelta: number;
	/** Cuts within this many sampled frames count as the same boundary. */
	toleranceFrames: number;
	torchElapsedMs: number;
	torchOnlyFrames: number[];
}
