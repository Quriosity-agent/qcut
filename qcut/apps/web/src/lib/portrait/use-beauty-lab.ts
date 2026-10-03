import { useEffect, useRef, useState } from "react";
import { readComparisonImage } from "@/components/editor/media-panel/views/adjustments/filter-comparison-input";
import type {
	BeautyLabResearchCase,
	JianyingPortraitAdjustmentStatus,
	JianyingPortraitDetectedFace,
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
	const [busy, setBusy] = useState<"load" | "render" | "detect" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const revision = useRef(0);
	const sourceKey = useRef(`beauty-lab:${crypto.randomUUID()}`);
	const captured = useRef(false);

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
		return () => {
			active = false;
			revision.current++;
		};
	}, []);

	function invalidate() {
		revision.current++;
		setNative(null);
		setCandidate(null);
		setBusy(null);
		setError(null);
	}

	function replaceInput({
		frame,
		isCaptured = false,
	}: {
		frame: BeautyLabFrame | null;
		isCaptured?: boolean;
	}) {
		invalidate();
		captured.current = isCaptured;
		sourceKey.current = `beauty-lab:${crypto.randomUUID()}`;
		setInput(frame);
		setRecord(null);
		setFaces([]);
		setAdjustments((value) => ({
			...value,
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
				frameNumber: 0,
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
		detectFaces,
		leaveRecord,
	};
}
