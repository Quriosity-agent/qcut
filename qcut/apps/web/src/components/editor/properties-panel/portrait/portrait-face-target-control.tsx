import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { PortraitFaceDetection } from "@/lib/portrait/jianying-portrait-face-detection";
import {
	portraitScopeForDetectedFace,
	type PortraitEditScope,
} from "@/lib/portrait/portrait-face-scope";
import type { MediaPortraitAdjustments } from "@/types/timeline";

/**
 * Face picker. It only lists observations returned by the native runtime;
 * fabricated ordinal ids cannot establish a safe person binding.
 */
export function PortraitFaceTargetControl({
	adjustments,
	detection,
	detectionError,
	detecting,
	scope,
	disabled,
	locale,
	onScopeChange,
	onDetect,
}: {
	adjustments: MediaPortraitAdjustments;
	detection: PortraitFaceDetection | null;
	detectionError: string | null;
	detecting: boolean;
	scope: PortraitEditScope;
	disabled: boolean;
	locale: string;
	onScopeChange: (scope: PortraitEditScope) => void;
	onDetect: () => void;
}) {
	const isZh = locale === "zh";
	const value =
		scope.mode === "all" ? "all" : `person-${scope.personBindingId}`;
	const configuredBindingIds = new Set(
		(adjustments.faces ?? []).flatMap((face) =>
			face.personBindingId ? [face.personBindingId] : []
		)
	);
	const detected = detection?.faces ?? [];
	const appliedLimit = detection?.appliedFaceLimit ?? 5;
	return (
		<div className="space-y-1">
			<div className="flex items-center gap-1">
				<Select
					value={value}
					onValueChange={(next) => {
						if (next === "all") {
							onScopeChange({ mode: "all" });
							return;
						}
						const face = detected.find(
							(candidate) =>
								candidate.personBindingId === next.slice("person-".length)
						);
						if (!face || !detection) return;
						onScopeChange(
							portraitScopeForDetectedFace({
								face,
								frameNumber: detection.frameNumber,
							})
						);
					}}
					disabled={disabled}
				>
					<SelectTrigger
						className="h-8 w-full text-xs"
						aria-label={isZh ? "人脸选择" : "Face target"}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">
							{isZh ? "全部人脸" : "All faces"}
						</SelectItem>
						{detected.map((face, index) => (
							<SelectItem
								key={face.personBindingId}
								value={`person-${face.personBindingId}`}
							>
								{`${isZh ? "人脸" : "Face"} ${index + 1}`}
								{index >= appliedLimit
									? isZh
										? "（不生效）"
										: " (inert)"
									: ""}
								{configuredBindingIds.has(face.personBindingId) ? " ●" : ""}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<button
					type="button"
					className="h-8 shrink-0 rounded border px-2 text-xs disabled:opacity-50"
					onClick={onDetect}
					disabled={disabled || detecting}
					title={isZh ? "识别画面中的人脸" : "Detect faces in the frame"}
				>
					{detecting ? (isZh ? "识别中" : "…") : isZh ? "识别" : "Detect"}
				</button>
			</div>
			{detectionError ? (
				<p className="text-[10px] text-muted-foreground">{detectionError}</p>
			) : null}
			{detected.length > appliedLimit ? (
				<p className="text-[10px] text-muted-foreground">
					{isZh
						? `本机运行时同时最多对 ${appliedLimit} 张人脸生效`
						: `The runtime applies effects to at most ${appliedLimit} faces`}
				</p>
			) : null}
		</div>
	);
}
