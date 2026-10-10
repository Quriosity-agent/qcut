import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
	compareBeautyLabFrames,
	validateBeautyLabFrame,
	type BeautyLabFrame,
} from "@/lib/portrait/beauty-lab-difference";

export interface BeautyLabResultsProps {
	input: BeautyLabFrame | null;
	native: BeautyLabFrame | null;
	candidate: BeautyLabFrame | null;
	gain: number;
	nativeLabel: string;
	candidateLabel: string;
	locale: string;
}

const COPY = {
	en: {
		original: "Original",
		frames: "Frames",
		differences: "Differences",
		noInput: "No input frame",
		noNative: "No native result",
		noCandidate: "No candidate result",
		invalidFrame: "Invalid frame",
		missing: "Missing",
		mismatch: "Size mismatch",
		comparing: "Comparing...",
		unavailable: "Comparison unavailable",
		canvasUnavailable: "Canvas unavailable",
		changed: "Changed",
		rgbMae: "RGB MAE",
		rgbMax: "RGB max",
		alphaMax: "Alpha max",
	},
	zh: {
		original: "原图",
		frames: "图像",
		differences: "差异",
		noInput: "暂无输入图像",
		noNative: "暂无原生结果",
		noCandidate: "暂无候选结果",
		invalidFrame: "图像数据无效",
		missing: "缺少",
		mismatch: "尺寸不一致",
		comparing: "正在比较...",
		unavailable: "无法比较",
		canvasUnavailable: "画布不可用",
		changed: "变化像素",
		rgbMae: "RGB 平均误差",
		rgbMax: "RGB 最大误差",
		alphaMax: "Alpha 最大误差",
	},
};

function useValidatedFrame({ frame }: { frame: BeautyLabFrame | null }) {
	return useMemo(() => {
		if (!frame) return { frame: null, invalid: false };
		try {
			validateBeautyLabFrame({ frame });
			return { frame, invalid: false };
		} catch {
			return { frame: null, invalid: true };
		}
	}, [frame]);
}

function BeautyLabCanvas({
	frame,
	label,
	unavailableLabel,
}: {
	frame: BeautyLabFrame;
	label: string;
	unavailableLabel: string;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [failedFrame, setFailedFrame] = useState<BeautyLabFrame | null>(null);
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		try {
			canvas.width = frame.width;
			canvas.height = frame.height;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Canvas 2D context unavailable.");
			const image = context.createImageData(frame.width, frame.height);
			image.data.set(frame.rgba);
			context.putImageData(image, 0, 0);
			setFailedFrame(null);
		} catch {
			canvas.width = 0;
			canvas.height = 0;
			setFailedFrame(frame);
		}
		return () => {
			// Resetting the backing store releases full-resolution pixel allocations.
			canvas.width = 0;
			canvas.height = 0;
		};
	}, [frame]);

	const failed = failedFrame === frame;
	return (
		<>
			<canvas
				ref={canvasRef}
				role="img"
				aria-label={label}
				hidden={failed}
				className="absolute inset-0 h-full w-full object-contain"
			/>
			{failed ? (
				<p className="px-3 text-center text-xs text-muted-foreground [overflow-wrap:anywhere]">
					{unavailableLabel}
				</p>
			) : null}
		</>
	);
}

function BeautyLabFigure({
	label,
	aspectRatio,
	frame,
	message,
	canvasUnavailableLabel,
	children,
}: {
	label: string;
	aspectRatio: string;
	frame: BeautyLabFrame | null;
	message: string;
	canvasUnavailableLabel: string;
	children?: ReactNode;
}) {
	return (
		<figure aria-label={label} className="min-w-0 space-y-2">
			<figcaption className="text-xs font-medium [overflow-wrap:anywhere]">
				{label}
			</figcaption>
			<div
				className="relative flex w-full items-center justify-center overflow-hidden bg-muted/40"
				style={{ aspectRatio }}
				data-testid="beauty-lab-frame-viewport"
			>
				{frame ? (
					<BeautyLabCanvas
						frame={frame}
						label={label}
						unavailableLabel={canvasUnavailableLabel}
					/>
				) : (
					<p className="px-3 text-center text-xs text-muted-foreground [overflow-wrap:anywhere]">
						{message}
					</p>
				)}
			</div>
			{children}
		</figure>
	);
}

interface ComparisonState {
	reference: BeautyLabFrame;
	candidate: BeautyLabFrame;
	gain: number;
	result: ReturnType<typeof compareBeautyLabFrames> | null;
}

function BeautyLabDifference({
	reference,
	candidate,
	referenceLabel,
	candidateLabel,
	gain,
	aspectRatio,
	copy,
}: {
	reference: BeautyLabFrame | null;
	candidate: BeautyLabFrame | null;
	referenceLabel: string;
	candidateLabel: string;
	gain: number;
	aspectRatio: string;
	copy: (typeof COPY)["en"] | (typeof COPY)["zh"];
}) {
	const [comparison, setComparison] = useState<ComparisonState | null>(null);
	useEffect(() => {
		setComparison(null);
		if (
			!reference ||
			!candidate ||
			reference.width !== candidate.width ||
			reference.height !== candidate.height
		) {
			return;
		}
		let active = true;
		// Coalesce gain changes without scanning pixels during parent pointer renders.
		const requestId = requestAnimationFrame(() => {
			if (!active) return;
			let result: ComparisonState["result"] = null;
			try {
				result = compareBeautyLabFrames({ reference, candidate, gain });
			} catch {
				result = null;
			}
			setComparison({ reference, candidate, gain, result });
		});
		return () => {
			active = false;
			cancelAnimationFrame(requestId);
		};
	}, [reference, candidate, gain]);

	const current =
		comparison?.reference === reference &&
		comparison?.candidate === candidate &&
		comparison?.gain === gain
			? comparison
			: null;
	let message = copy.comparing;
	if (!reference || !candidate) {
		const missing = [
			reference ? null : referenceLabel,
			candidate ? null : candidateLabel,
		].filter(Boolean);
		message = `${copy.missing}: ${missing.join(", ")}`;
	} else if (
		reference.width !== candidate.width ||
		reference.height !== candidate.height
	) {
		message = `${copy.mismatch}: ${reference.width}x${reference.height} / ${candidate.width}x${candidate.height}`;
	} else if (current && !current.result) {
		message = copy.unavailable;
	}
	const result = current?.result;
	const metrics = result?.metrics;
	const metricEntries = metrics
		? [
				[copy.changed, `${metrics.changedPixels} / ${metrics.pixelCount}`],
				[copy.rgbMae, metrics.rgbMae.toFixed(3)],
				[copy.rgbMax, String(metrics.rgbMax)],
				[copy.alphaMax, String(metrics.alphaMax)],
			]
		: [];

	return (
		<BeautyLabFigure
			label={`${referenceLabel} \u2192 ${candidateLabel}`}
			aspectRatio={aspectRatio}
			frame={result?.difference ?? null}
			message={message}
			canvasUnavailableLabel={copy.canvasUnavailable}
		>
			{metrics ? (
				<dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] tabular-nums">
					{metricEntries.map(([label, value]) => (
						<div key={label} className="min-w-0 [overflow-wrap:anywhere]">
							<dt className="text-muted-foreground">{label}</dt>
							<dd>{value}</dd>
						</div>
					))}
				</dl>
			) : null}
		</BeautyLabFigure>
	);
}

export function BeautyLabResults({
	input,
	native,
	candidate,
	gain,
	nativeLabel,
	candidateLabel,
	locale,
}: BeautyLabResultsProps) {
	const copy = locale.toLowerCase().startsWith("zh") ? COPY.zh : COPY.en;
	const originalFrame = useValidatedFrame({ frame: input });
	const nativeFrame = useValidatedFrame({ frame: native });
	const candidateFrame = useValidatedFrame({ frame: candidate });
	const anchor =
		originalFrame.frame ?? nativeFrame.frame ?? candidateFrame.frame;
	const aspectRatio = anchor ? `${anchor.width} / ${anchor.height}` : "1 / 1";
	const slots = [
		{
			id: "original",
			label: copy.original,
			...originalFrame,
			empty: copy.noInput,
		},
		{ id: "native", label: nativeLabel, ...nativeFrame, empty: copy.noNative },
		{
			id: "candidate",
			label: candidateLabel,
			...candidateFrame,
			empty: copy.noCandidate,
		},
	];
	const pairs = [
		{ id: "input-native", reference: slots[0], candidate: slots[1] },
		{ id: "input-candidate", reference: slots[0], candidate: slots[2] },
		{ id: "native-candidate", reference: slots[1], candidate: slots[2] },
	];

	return (
		<div
			className="@container min-w-0 space-y-4"
			data-testid="beauty-lab-results"
		>
			<section aria-label={copy.frames} className="space-y-2">
				<h3 className="text-xs font-medium">{copy.frames}</h3>
				<div className="grid grid-cols-1 gap-4 @min-[40rem]:grid-cols-3">
					{slots.map((slot) => (
						<BeautyLabFigure
							key={slot.id}
							label={slot.label}
							aspectRatio={aspectRatio}
							frame={slot.frame}
							message={slot.invalid ? copy.invalidFrame : slot.empty}
							canvasUnavailableLabel={copy.canvasUnavailable}
						/>
					))}
				</div>
			</section>
			<section aria-label={copy.differences} className="space-y-2">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h3 className="text-xs font-medium">{copy.differences}</h3>
					<span className="text-[10px] tabular-nums text-muted-foreground">
						RGB x{gain}
					</span>
				</div>
				<div className="grid grid-cols-1 gap-4 @min-[40rem]:grid-cols-3">
					{pairs.map((pair) => (
						<BeautyLabDifference
							key={pair.id}
							reference={pair.reference.frame}
							candidate={pair.candidate.frame}
							referenceLabel={pair.reference.label}
							candidateLabel={pair.candidate.label}
							gain={gain}
							aspectRatio={aspectRatio}
							copy={copy}
						/>
					))}
				</div>
			</section>
		</div>
	);
}
