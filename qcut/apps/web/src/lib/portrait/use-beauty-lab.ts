import { useEffect, useRef, useState } from "react";
import { readComparisonImage } from "@/components/editor/media-panel/views/adjustments/filter-comparison-input";
import type {
	BeautyLabCandidateRequest,
	BeautyLabCandidateResult,
	BeautyLabCandidateStatus,
	BeautyLabResearchCase,
	JianyingPortraitAdjustmentStatus,
	JianyingPortraitDetectedFace,
} from "@/types/electron";
import {
	BEAUTY_LAB_CANDIDATE_BACKEND,
	BEAUTY_LAB_CANDIDATE_PROTOCOL,
} from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { captureJianyingPortraitDetectionFrame } from "./jianying-portrait-face-detection";
import {
	validateBeautyLabFrame,
	type BeautyLabFrame,
} from "./beauty-lab-difference";

function checkedFrame(frame: BeautyLabFrame): BeautyLabFrame {
	validateBeautyLabFrame({ frame });
	return frame;
}

function draftFromTimeline({
	adjustments,
}: {
	adjustments: MediaPortraitAdjustments;
}): MediaPortraitAdjustments {
	// Tracking identities and brush coordinates belong to the editor's source frame.
	return structuredClone({
		enabled: true,
		values: adjustments.values,
		makeup: adjustments.makeup,
		...(adjustments.skinToneResourceId !== undefined
			? { skinToneResourceId: adjustments.skinToneResourceId }
			: {}),
	});
}

export function useBeautyLab({
	elementId,
	currentFrame,
	initialAdjustments,
}: {
	elementId: string;
	currentFrame: number;
	initialAdjustments: MediaPortraitAdjustments;
}) {
	const [status, setStatus] = useState<JianyingPortraitAdjustmentStatus | null>(
		null
	);
	const [cases, setCases] = useState<BeautyLabResearchCase[]>([]);
	const [candidateStatus, setCandidateStatus] =
		useState<BeautyLabCandidateStatus | null>(null);
	const [candidateReport, setCandidateReport] =
		useState<BeautyLabCandidateResult | null>(null);
	const [adjustments, setAdjustments] = useState<MediaPortraitAdjustments>(() =>
		draftFromTimeline({ adjustments: initialAdjustments })
	);
	const [input, setInput] = useState<BeautyLabFrame | null>(null);
	const [native, setNative] = useState<BeautyLabFrame | null>(null);
	const [candidate, setCandidate] = useState<BeautyLabFrame | null>(null);
	const [faces, setFaces] = useState<JianyingPortraitDetectedFace[]>([]);
	const [record, setRecord] = useState<{
		caseId: string;
		frameIndex: number;
	} | null>(null);
	const [busy, setBusy] = useState<
		"load" | "render" | "candidate" | "detect" | null
	>(null);
	const [error, setError] = useState<string | null>(null);
	const revision = useRef(0);
	const sourceKey = useRef(`beauty-lab:${crypto.randomUUID()}`);
	const captured = useRef(false);
	const inputTiming = useRef<{
		frameNumber: number;
		timestampSeconds: number;
	} | null>({ frameNumber: 0, timestampSeconds: 0 });

	useEffect(() => {
		let active = true;
		void window.electronAPI?.jianyingPortraitAdjustment
			?.inspect({})
			.then((value) => {
				if (active) setStatus(value);
			})
			.catch((reason: unknown) => {
				if (active) setError(String(reason));
			});
		void window.electronAPI?.beautyLab
			?.listResearchCases()
			.then((value) => {
				if (active) setCases(value);
			})
			.catch((reason: unknown) => {
				if (active) setError(String(reason));
			});
		void window.electronAPI?.beautyLab
			?.inspectCandidate?.()
			.then((value) => {
				if (active) setCandidateStatus(value);
			})
			.catch((reason: unknown) => {
				if (active) setError(String(reason));
			});
		return () => {
			active = false;
			revision.current++;
		};
	}, []);

	function invalidate() {
		revision.current++;
		setNative(null);
		setCandidate(null);
		setCandidateReport(null);
		setBusy(null);
		setError(null);
	}

	function replaceInput({
		frame,
		isCaptured = false,
		timing = { frameNumber: 0, timestampSeconds: 0 },
	}: {
		frame: BeautyLabFrame | null;
		isCaptured?: boolean;
		timing?: { frameNumber: number; timestampSeconds: number } | null;
	}) {
		invalidate();
		captured.current = isCaptured;
		inputTiming.current = timing;
		sourceKey.current = `beauty-lab:${crypto.randomUUID()}`;
		setInput(frame);
		setRecord(null);
		setFaces([]);
		setAdjustments((value) => ({
			...(record
				? draftFromTimeline({ adjustments: initialAdjustments })
				: value),
			faceTarget: { mode: "all" },
			faces: undefined,
		}));
	}

	// A captured frame belongs to the source at that seek, not the next preview.
	// biome-ignore lint/correctness/useExhaustiveDependencies: source and seek invalidate captured pixels
	useEffect(() => {
		if (captured.current) replaceInput({ frame: null });
	}, [elementId, currentFrame]);

	function changeAdjustments(value: MediaPortraitAdjustments) {
		if (record) return;
		invalidate();
		setAdjustments(structuredClone(value));
	}

	async function importImage({ file }: { file: File }) {
		invalidate();
		const token = revision.current;
		setBusy("load");
		try {
			const frame = await readComparisonImage({ file });
			if (token === revision.current) replaceInput({ frame });
		} catch (reason) {
			if (token === revision.current) setError(String(reason));
		} finally {
			if (token === revision.current) setBusy(null);
		}
	}

	function captureFrame() {
		try {
			const frame = captureJianyingPortraitDetectionFrame({ elementId });
			if (!frame) throw new Error("No decoded source frame");
			replaceInput({
				frame: checkedFrame({
					name: `Frame ${currentFrame}`,
					width: frame.source.width,
					height: frame.source.height,
					rgba: new Uint8Array(frame.source.data),
				}),
				isCaptured: true,
				timing:
					frame.timestampSeconds !== undefined &&
					Number.isFinite(frame.timestampSeconds) &&
					frame.timestampSeconds >= 0
						? {
								frameNumber: currentFrame,
								timestampSeconds: frame.timestampSeconds,
							}
						: null,
			});
		} catch (reason) {
			setError(String(reason));
		}
	}

	async function loadRecord({
		caseId,
		frameIndex,
	}: {
		caseId: string;
		frameIndex: number;
	}) {
		invalidate();
		const token = revision.current;
		setBusy("load");
		try {
			const api = window.electronAPI?.beautyLab;
			if (!api) throw new Error("Research records require QCut Desktop");
			const result = await api.loadResearchFrame({ caseId, frameIndex });
			if (token !== revision.current) return;
			if (
				result.source !== "verified-offline-replay" ||
				result.sourceHashesVerified !== true ||
				result.nativeDependencies !== true ||
				result.caseId !== caseId ||
				result.frameIndex !== frameIndex
			)
				throw new Error("Unverified research frame");
			const dimensions = { width: result.width, height: result.height };
			const original = checkedFrame({
				...dimensions,
				name: `${caseId}:${frameIndex}`,
				rgba: result.input,
			});
			const baseline = checkedFrame({
				...dimensions,
				name: "Native baseline",
				rgba: result.native,
			});
			const replay = checkedFrame({
				...dimensions,
				name: "Verified offline replay",
				rgba: result.candidate,
			});
			captured.current = false;
			inputTiming.current = null;
			setFaces([]);
			setRecord({ caseId, frameIndex });
			setInput(original);
			setNative(baseline);
			setCandidate(replay);
			setAdjustments(structuredClone(result.adjustments));
		} catch (reason) {
			if (token === revision.current) setError(String(reason));
		} finally {
			if (token === revision.current) setBusy(null);
		}
	}

	async function renderNative() {
		if (!input || record || busy || !status?.available) return;
		invalidate();
		const token = revision.current;
		setBusy("render");
		try {
			const api = window.electronAPI?.jianyingPortraitAdjustment;
			if (!api) throw new Error("Native retouch requires QCut Desktop");
			const result = await api.render({
				...input,
				adjustments: structuredClone(adjustments),
				sourceKey: sourceKey.current,
				frameNumber: inputTiming.current?.frameNumber ?? 0,
				...(inputTiming.current
					? { timestampSeconds: inputTiming.current.timestampSeconds }
					: {}),
			});
			if (token !== revision.current) return;
			if (
				result.provider !== "jianying-local-swing-v1" ||
				result.width !== input.width ||
				result.height !== input.height
			)
				throw new Error("Native output dimensions or provider changed");
			setNative(checkedFrame({ ...result, name: "Native result" }));
		} catch (reason) {
			if (token === revision.current) setError(String(reason));
		} finally {
			if (token === revision.current) setBusy(null);
		}
	}

	async function renderCandidate() {
		if (
			!input ||
			record ||
			busy ||
			!candidateStatus?.available ||
			!candidateStatus.backendVersion
		)
			return;
		const timing = inputTiming.current;
		if (!timing) {
			setError("Candidate inference requires a known source timestamp");
			return;
		}
		const token = ++revision.current;
		const request: BeautyLabCandidateRequest = {
			protocol: BEAUTY_LAB_CANDIDATE_PROTOCOL,
			requestId: crypto.randomUUID(),
			backendVersion: candidateStatus.backendVersion,
			width: input.width,
			height: input.height,
			rgba: new Uint8Array(input.rgba),
			adjustments: structuredClone(adjustments),
			sourceKey: sourceKey.current,
			...timing,
		};
		setCandidate(null);
		setCandidateReport(null);
		setBusy("candidate");
		setError(null);
		try {
			const api = window.electronAPI?.beautyLab;
			if (!api?.renderCandidate)
				throw new Error("Candidate inference requires QCut Desktop");
			const result = await api.renderCandidate(request);
			if (token !== revision.current) return;
			if (
				result.protocol !== request.protocol ||
				result.source !== "live-candidate" ||
				result.backendId !== BEAUTY_LAB_CANDIDATE_BACKEND ||
				result.backendVersion !== request.backendVersion ||
				result.requestId !== request.requestId ||
				result.sourceKey !== request.sourceKey ||
				result.frameNumber !== request.frameNumber ||
				result.timestampSeconds !== request.timestampSeconds ||
				result.width !== request.width ||
				result.height !== request.height
			) {
				throw new Error(
					"Candidate output does not belong to the current input"
				);
			}
			const frame = checkedFrame({ ...result, name: "Live candidate" });
			setCandidate(frame);
			setCandidateReport(result);
		} catch (reason) {
			if (token === revision.current) setError(String(reason));
		} finally {
			if (token === revision.current) setBusy(null);
		}
	}

	async function detectFaces() {
		if (!input || record || busy || !status?.available) return;
		const token = revision.current;
		setBusy("detect");
		setError(null);
		try {
			const api = window.electronAPI?.jianyingPortraitAdjustment;
			if (!api) throw new Error("Face detection requires QCut Desktop");
			const result = await api.detect({
				...input,
				sourceKey: sourceKey.current,
				frameNumber: 0,
			});
			if (token === revision.current)
				setFaces(result.faces.slice(0, result.appliedFaceLimit));
		} catch (reason) {
			if (token === revision.current) setError(String(reason));
		} finally {
			if (token === revision.current) setBusy(null);
		}
	}

	function leaveRecord() {
		replaceInput({ frame: null });
		setAdjustments(draftFromTimeline({ adjustments: initialAdjustments }));
	}

	return {
		status,
		candidateStatus,
		candidateReport,
		cases,
		adjustments,
		input,
		native,
		candidate,
		faces,
		record,
		busy,
		error,
		changeAdjustments,
		importImage,
		captureFrame,
		loadRecord,
		renderNative,
		renderCandidate,
		detectFaces,
		leaveRecord,
	};
}
