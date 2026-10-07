import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type {
	BeautyLabIndependentResult,
	BeautyLabIndependentStatus,
} from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import type { BeautyLabFrame } from "./beauty-lab-difference";
import { validateIndependentBeautyResult } from "./beauty-lab-independent-result";

interface IndependentBlocker {
	code: "runtime" | "input" | "record" | "dimensions" | "unsupported" | "scope";
	message: string;
	selections?: string[];
}

export function useBeautyLabIndependent({
	input,
	adjustments,
	locked,
	busy,
	revision,
	sourceKey,
	onBusy,
	onError,
}: {
	input: BeautyLabFrame | null;
	adjustments: MediaPortraitAdjustments;
	locked: boolean;
	busy: boolean;
	revision: MutableRefObject<number>;
	sourceKey: MutableRefObject<string>;
	onBusy: (value: "independent" | null) => void;
	onError: (value: string | null) => void;
}) {
	const [status, setStatus] = useState<BeautyLabIndependentStatus | null>(null);
	const [frame, setFrame] = useState<BeautyLabFrame | null>(null);
	const [report, setReport] = useState<BeautyLabIndependentResult | null>(null);
	const [job, setJob] = useState<{
		requestId: string;
		cancelling: boolean;
	} | null>(null);
	const pending = useRef<{ requestId: string; cancelled: boolean } | null>(
		null
	);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		void window.electronAPI?.beautyLab
			?.inspectIndependent?.()
			.then((value) => {
				if (mounted.current) setStatus(value);
			})
			.catch((error: unknown) => {
				if (mounted.current) onError(String(error));
			});
		return () => {
			mounted.current = false;
			const current = pending.current;
			if (current) {
				current.cancelled = true;
				void window.electronAPI?.beautyLab
					?.cancelIndependent?.({ requestId: current.requestId })
					.catch(() => {});
			}
		};
	}, [onError]);

	const unsupported = status
		? Object.entries(adjustments.values)
				.filter(([key, value]) => value !== 0 && !status.controls.includes(key))
				.map(([key]) => key)
		: [];
	const unsupportedMakeup = status
		? Object.values(adjustments.makeup ?? {})
				.filter(({ cardId }) => !status.makeupCards.includes(cardId))
				.map(({ cardId }) => cardId)
		: [];
	function selectionIssue(): IndependentBlocker | null {
		if (!status?.available)
			return {
				code: "runtime",
				message: status?.message ?? "Checking independent engine…",
			};
		if (!input)
			return {
				code: "input",
				message: "Import a photo to use the independent engine",
			};
		if (locked)
			return { code: "record", message: "Offline records are read-only" };
		if (input.width > 1280 || input.height > 1280)
			return {
				code: "dimensions",
				message: "Independent photos require maximum edge ≤1280",
			};
		const selections = [...unsupported, ...unsupportedMakeup];
		if (selections.length)
			return {
				code: "unsupported",
				selections,
				message: `Independent does not support: ${selections.join(", ")}`,
			};
		const scopedOrManual =
			adjustments.faceTarget?.mode === "single" ||
			adjustments.faces?.length ||
			adjustments.skinToneResourceId ||
			Object.keys(adjustments.manualBody ?? {}).length ||
			adjustments.manualRetouch?.strokes.length;
		if (scopedOrManual)
			return {
				code: "scope",
				message:
					"Independent supports a single-face photo with all-faces selection; manual edits and skin tones require native processing",
			};
		return null;
	}
	const issue = selectionIssue();
	const blocker = issue?.message ?? null;

	function clear() {
		setFrame(null);
		setReport(null);
	}
	async function render() {
		if (!input || locked || busy || pending.current || !status?.available)
			return;
		if (blocker) {
			onError(blocker);
			return;
		}
		const token = ++revision.current;
		const request = {
			requestId: crypto.randomUUID(),
			sourceKey: sourceKey.current,
			width: input.width,
			height: input.height,
			rgba: new Uint8Array(input.rgba),
			adjustments: structuredClone(adjustments),
		};
		const current = { requestId: request.requestId, cancelled: false };
		pending.current = current;
		setJob({ requestId: current.requestId, cancelling: false });
		clear();
		onBusy("independent");
		onError(null);
		try {
			const api = window.electronAPI?.beautyLab;
			if (!api?.renderIndependent)
				throw new Error("Independent engine requires QCut Desktop");
			const result = await api.renderIndependent(request);
			if (!mounted.current || token !== revision.current || current.cancelled)
				return;
			if (
				result.requestId !== request.requestId ||
				result.sourceKey !== request.sourceKey
			)
				throw new Error("Independent output belongs to a different request");
			const rendered = {
				width: result.width,
				height: result.height,
				rgba: result.rgba,
				name: "Independent result",
			};
			await validateIndependentBeautyResult({ input, frame: rendered, result });
			if (!mounted.current || token !== revision.current || current.cancelled)
				return;
			setFrame(rendered);
			setReport(result);
		} catch (error) {
			if (mounted.current && token === revision.current && !current.cancelled)
				onError(String(error));
		} finally {
			if (pending.current === current) {
				pending.current = null;
				if (mounted.current) setJob(null);
			}
			if (mounted.current && token === revision.current) onBusy(null);
		}
	}
	async function cancel() {
		const current = pending.current;
		if (!current || current.cancelled) return;
		current.cancelled = true;
		setJob({ requestId: current.requestId, cancelling: true });
		try {
			const api = window.electronAPI?.beautyLab;
			if (!api?.cancelIndependent)
				throw new Error("Independent cancellation unavailable");
			await api.cancelIndependent({ requestId: current.requestId });
		} catch (error) {
			if (!mounted.current || pending.current !== current) return;
			current.cancelled = false;
			setJob({ requestId: current.requestId, cancelling: false });
			onError(String(error));
		}
	}
	return { status, frame, report, job, blocker, issue, clear, render, cancel };
}
