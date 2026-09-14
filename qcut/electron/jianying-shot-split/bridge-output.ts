/**
 * Pure parsing of the shot-split bridge's stdout transcript and mapping of the
 * model's `predict_result` (last sampled frame index of each shot) to cut
 * points and shot ranges.
 */

import type { JianyingShotSplitShot } from "../jianying-shot-split-contract.js";

export interface ShotSplitBridgeOutput {
	eofStatus: number;
	executeFailures: number;
	frameCount: number;
	frameReceived: number[];
	predictResult: number[];
}

const PROGRESS_LINE = /^\[progress\] fed (\d+) frames$/;
const FED_LINE = /^M5a fed (\d+) frames \(.*failures=(\d+)$/;
const EOF_LINE = /^M5b EOF frame -> (-?\d+)$/;
const MILESTONE_FAILURE_LINE = /^M[1-5]\w* FAIL/;

export function parseShotSplitProgressLine({ line }: { line: string }) {
	const match = line.trim().match(PROGRESS_LINE);
	return match ? Number(match[1]) : null;
}

function lastMatch({ lines, pattern }: { lines: string[]; pattern: RegExp }) {
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const match = lines[index].match(pattern);
		if (match) return match;
	}
	return null;
}

function lastLineWithPrefix({
	lines,
	prefix,
}: {
	lines: string[];
	prefix: string;
}) {
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		if (lines[index].startsWith(prefix))
			return lines[index].slice(prefix.length);
	}
	return null;
}

function parseIntegerList({ label, text }: { label: string; text: string }) {
	const values = text.trim().split(/\s+/).filter(Boolean).map(Number);
	if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
		throw new Error(`本机镜头分割桥返回了无效的 ${label}`);
	}
	return values;
}

/** Throws when the transcript reports a failed milestone or an incomplete run. */
export function parseShotSplitBridgeOutput({
	stdout,
}: {
	stdout: string;
}): ShotSplitBridgeOutput {
	const lines = stdout.split("\n").map((line) => line.trimEnd());
	const failure = lines.find((line) => MILESTONE_FAILURE_LINE.test(line));
	if (failure) throw new Error(`本机镜头分割桥初始化失败: ${failure}`);
	const fed = lastMatch({ lines, pattern: FED_LINE });
	if (!fed) throw new Error("本机镜头分割桥没有报告已处理的帧数");
	const frameCount = Number(fed[1]);
	const executeFailures = Number(fed[2]);
	if (executeFailures > 0) {
		throw new Error(`本机镜头分割桥有 ${executeFailures} 帧推理失败`);
	}
	const eof = lastMatch({ lines, pattern: EOF_LINE });
	if (!eof) throw new Error("本机镜头分割桥没有完成收尾帧");
	const eofStatus = Number(eof[1]);
	if (eofStatus !== 0) {
		throw new Error(`本机镜头分割桥收尾帧返回 ${eofStatus}`);
	}
	const predictText = lastLineWithPrefix({ lines, prefix: "predict_result:" });
	if (predictText === null) {
		throw new Error("本机镜头分割桥没有返回 predict_result");
	}
	const receivedText =
		lastLineWithPrefix({ lines, prefix: "frame_received:" }) ?? "";
	return {
		eofStatus,
		executeFailures,
		frameCount,
		frameReceived: parseIntegerList({
			label: "frame_received",
			text: receivedText,
		}),
		predictResult: parseIntegerList({
			label: "predict_result",
			text: predictText,
		}),
	};
}

function roundSeconds(value: number) {
	return Math.round(value * 1e6) / 1e6;
}

/**
 * Maps `predict_result` to cut points. Each value is the last frame index of a
 * shot, so the next shot starts at `value + 1`; a value at the final frame is
 * the end of the video, not a cut.
 */
export function shotBoundariesFromPredictResult({
	fps,
	frameCount,
	predictResult,
}: {
	fps: number;
	frameCount: number;
	predictResult: number[];
}): {
	cutFrames: number[];
	cutPoints: number[];
	shots: JianyingShotSplitShot[];
} {
	if (!Number.isFinite(fps) || fps <= 0) {
		throw new Error("镜头分割采样帧率无效");
	}
	if (!Number.isSafeInteger(frameCount) || frameCount < 0) {
		throw new Error("镜头分割帧数无效");
	}
	if (
		predictResult.some((frame) => !Number.isSafeInteger(frame) || frame < 0)
	) {
		throw new Error("镜头分割结果包含无效帧索引");
	}
	const cutFrames = [...new Set(predictResult)]
		.filter((frame) => frame < frameCount - 1)
		.sort((first, second) => first - second);
	const cutPoints = cutFrames.map((frame) => roundSeconds((frame + 1) / fps));
	if (frameCount === 0) return { cutFrames, cutPoints, shots: [] };
	const starts = [0, ...cutFrames.map((frame) => frame + 1)];
	const shots = starts.map((startFrame, index) => {
		const endFrame =
			index + 1 < starts.length ? starts[index + 1] - 1 : frameCount - 1;
		return {
			endFrame,
			endTime: roundSeconds((endFrame + 1) / fps),
			index,
			startFrame,
			startTime: roundSeconds(startFrame / fps),
		};
	});
	return { cutFrames, cutPoints, shots };
}
