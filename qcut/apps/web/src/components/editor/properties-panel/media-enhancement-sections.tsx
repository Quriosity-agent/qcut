import { LoaderCircle, Sparkles } from "lucide-react";
import { useEffect } from "react";
import type { MediaEnhancements } from "@/types/timeline";
import { useTranslation } from "@/lib/i18n";
import type { MediaItem } from "@/stores/media/media-store-types";
import { useStabilizationStore } from "@/stores/stabilization-store";
import {
	DEFAULT_STABILIZATION_LEVEL,
	STABILIZATION_LEVELS,
	stabilizationLevelForValue,
	stabilizationValueForLevel,
	type StabilizationLevel,
} from "@/lib/video/stabilization-levels";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	PropertyGroup,
	PropertyItem,
	PropertyItemLabel,
} from "./property-item";
import { NumberControl } from "./visual-property-controls";

// Jianying-style enhancement sections for the visual → basic sub-tab. Every
// toggle binds to `MediaEnhancements`, which the FFmpeg export path already
// renders (deshake / hqdn3d / unsharp / Lanczos resample), so a checked box
// always means a real filter.

/** Strength `一键画质提升` applies to the local clarity (unsharp) filter. */
export const QUICK_ENHANCE_CLARITY = 40;
/** Strength `画面降噪` starts at when switched on. */
export const DEFAULT_DENOISE_STRENGTH = 30;

interface EnhancementSectionProps {
	enhancements: MediaEnhancements;
	onChange: (enhancements: MediaEnhancements, history?: boolean) => void;
	onInteractionStart: () => void;
	onInteractionEnd: () => void;
}

/** Analysis state of the in-house stabilizer for the clip's source media. */
function StabilizationAnalysisStatus({
	mediaItem,
	enabled,
}: {
	mediaItem: MediaItem;
	enabled: boolean;
}) {
	const { t } = useTranslation();
	const entry = useStabilizationStore((state) => state.entries[mediaItem.id]);
	const ensureAnalysis = useStabilizationStore((state) => state.ensureAnalysis);
	const forget = useStabilizationStore((state) => state.forget);
	const status = entry?.status ?? "idle";
	useEffect(() => {
		if (!enabled || status !== "idle") return;
		void ensureAnalysis({ mediaItem }).catch(() => {});
	}, [enabled, ensureAnalysis, mediaItem, status]);
	if (!enabled || status === "idle") return null;
	if (status === "error") {
		return (
			<PropertyItem>
				<div
					className="flex w-full items-center justify-between gap-2 text-xs text-destructive"
					data-testid="media-stabilization-status"
					data-status="error"
				>
					<span className="truncate">
						{t("mediaProperties.stabilizationStatus.error", {
							error: entry?.error ?? "",
						})}
					</span>
					<Button
						variant="outline"
						size="sm"
						className="h-6 shrink-0 px-2 text-xs"
						onClick={() => forget({ mediaId: mediaItem.id })}
					>
						{t("mediaProperties.stabilizationStatus.retry")}
					</Button>
				</div>
			</PropertyItem>
		);
	}
	return (
		<PropertyItem>
			<div
				className="flex w-full items-center gap-2 text-xs text-muted-foreground"
				data-testid="media-stabilization-status"
				data-status={status}
			>
				{status === "ready" ? null : (
					<LoaderCircle className="size-3.5 animate-spin" />
				)}
				<span>
					{status === "ready"
						? t("mediaProperties.stabilizationStatus.ready")
						: status === "hashing"
							? t("mediaProperties.stabilizationStatus.hashing")
							: t("mediaProperties.stabilizationStatus.analyzing", {
									percent: Math.round((entry?.progress ?? 0) * 100),
								})}
				</span>
			</div>
		</PropertyItem>
	);
}

export function StabilizationSection({
	enhancements,
	onChange,
	mediaItem,
}: Pick<EnhancementSectionProps, "enhancements" | "onChange"> & {
	mediaItem?: MediaItem;
}) {
	const { t } = useTranslation();
	const title = t("mediaProperties.stabilization");
	const level =
		stabilizationLevelForValue(enhancements.stabilization) ??
		DEFAULT_STABILIZATION_LEVEL;
	const enabled = enhancements.stabilization > 0;
	const setLevel = (next: StabilizationLevel) =>
		onChange({
			...enhancements,
			stabilization: stabilizationValueForLevel(next),
		});
	return (
		<PropertyGroup
			title={title}
			defaultExpanded={false}
			testId="media-stabilization-section"
			enabled={enabled}
			enableLabel={t("mediaProperties.enableSection", { label: title })}
			onEnabledChange={(checked) =>
				onChange({
					...enhancements,
					stabilization: checked ? stabilizationValueForLevel(level) : 0,
				})
			}
			info={t("mediaProperties.stabilizationInfo")}
			resetLabel={t("mediaProperties.resetSection", { label: title })}
			onReset={() => onChange({ ...enhancements, stabilization: 0 })}
		>
			<PropertyItem>
				<PropertyItemLabel>
					{t("mediaProperties.stabilizationLevel")}
				</PropertyItemLabel>
				<Select
					value={level}
					onValueChange={(value) => setLevel(value as StabilizationLevel)}
				>
					<SelectTrigger
						className="h-8 w-40 text-xs"
						aria-label={t("mediaProperties.stabilizationLevel")}
						data-testid="media-stabilization-level"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{STABILIZATION_LEVELS.map((entry) => (
							<SelectItem key={entry.level} value={entry.level}>
								{t(entry.labelKey)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</PropertyItem>
			{mediaItem ? (
				<StabilizationAnalysisStatus mediaItem={mediaItem} enabled={enabled} />
			) : null}
		</PropertyGroup>
	);
}

export function QuickEnhanceSection({
	enhancements,
	onChange,
}: Pick<EnhancementSectionProps, "enhancements" | "onChange">) {
	const { t } = useTranslation();
	const title = t("mediaProperties.quickEnhance");
	const enabled = enhancements.clarity > 0;
	return (
		<PropertyGroup
			title={title}
			defaultExpanded={false}
			testId="media-quick-enhance-section"
			enabled={enabled}
			enableLabel={t("mediaProperties.enableSection", { label: title })}
			onEnabledChange={(checked) =>
				onChange({
					...enhancements,
					clarity: checked ? QUICK_ENHANCE_CLARITY : 0,
				})
			}
			info={t("mediaProperties.quickEnhanceInfo")}
		>
			<p className="text-[11px] text-muted-foreground">
				{t("mediaProperties.clarity")}: {enhancements.clarity}
			</p>
		</PropertyGroup>
	);
}

export function SuperResolutionSection({
	enhancements,
	onChange,
	onOpenAIUpscale,
}: Pick<EnhancementSectionProps, "enhancements" | "onChange"> & {
	onOpenAIUpscale: () => void;
}) {
	const { t } = useTranslation();
	const title = t("mediaProperties.superResolution");
	const enabled = enhancements.upscale > 1;
	const setUpscale = (upscale: MediaEnhancements["upscale"]) =>
		onChange({ ...enhancements, upscale });
	return (
		<>
			<PropertyGroup
				title={title}
				defaultExpanded={false}
				testId="media-super-resolution-section"
				enabled={enabled}
				enableLabel={t("mediaProperties.enableSection", { label: title })}
				onEnabledChange={(checked) => setUpscale(checked ? 2 : 1)}
				info={t("mediaProperties.superResolutionInfo")}
				resetLabel={t("mediaProperties.resetSection", { label: title })}
				onReset={() => setUpscale(1)}
			>
				<div className="space-y-3">
					<PropertyItem>
						<PropertyItemLabel>
							{t("mediaProperties.superResolutionLevel")}
						</PropertyItemLabel>
						<Select
							value={String(enabled ? enhancements.upscale : 2)}
							onValueChange={(value) =>
								setUpscale(Number(value) as MediaEnhancements["upscale"])
							}
						>
							<SelectTrigger
								className="h-8 w-40 text-xs"
								aria-label={t("mediaProperties.superResolutionLevel")}
								data-testid="media-super-resolution-level"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="2">
									{t("mediaProperties.superResolution.local2x")}
								</SelectItem>
								<SelectItem value="4">
									{t("mediaProperties.superResolution.local4x")}
								</SelectItem>
							</SelectContent>
						</Select>
					</PropertyItem>
				</div>
			</PropertyGroup>
			{/* Cloud upscale stays reachable while the local resample is off. */}
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="w-full"
				onClick={onOpenAIUpscale}
			>
				<Sparkles className="mr-2 size-3.5" />
				{t("mediaProperties.superResolutionCloud")}
			</Button>
		</>
	);
}

export function DenoiseSection({
	enhancements,
	onChange,
	onInteractionStart,
	onInteractionEnd,
}: EnhancementSectionProps) {
	const { t } = useTranslation();
	const title = t("mediaProperties.denoiseSection");
	const enabled = enhancements.denoise > 0;
	return (
		<PropertyGroup
			title={title}
			defaultExpanded={false}
			testId="media-denoise-section"
			enabled={enabled}
			enableLabel={t("mediaProperties.enableSection", { label: title })}
			onEnabledChange={(checked) =>
				onChange({
					...enhancements,
					denoise: checked ? DEFAULT_DENOISE_STRENGTH : 0,
				})
			}
			resetLabel={t("mediaProperties.resetSection", { label: title })}
			onReset={() => onChange({ ...enhancements, denoise: 0 })}
		>
			<NumberControl
				label={t("mediaProperties.denoiseStrength")}
				value={enhancements.denoise}
				min={0}
				max={100}
				onChange={(denoise) => onChange({ ...enhancements, denoise }, false)}
				onInteractionStart={onInteractionStart}
				onInteractionEnd={onInteractionEnd}
			/>
		</PropertyGroup>
	);
}
