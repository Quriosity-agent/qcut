import { Ban, Check } from "lucide-react";
import type { JianyingPortraitAdjustmentStatus } from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { selectPortraitSkinTone } from "@/lib/portrait/portrait-skin-tone";
import { JIANYING_PORTRAIT_LEGACY_SKIN_RESOURCE_ID } from "../../../../../../electron/jianying-portrait-adjustment-runtime/skin-tone-catalog";
import { cn } from "@/lib/utils";

export function PortraitSkinToneControls({
	tones,
	adjustments,
	disabled,
	locale,
	onChange,
	onInteractionStart,
	onInteractionEnd,
}: {
	tones: NonNullable<JianyingPortraitAdjustmentStatus["skinTones"]>;
	adjustments: MediaPortraitAdjustments;
	disabled: boolean;
	locale: string;
	onChange: (adjustments: MediaPortraitAdjustments) => void;
	onInteractionStart: () => void;
	onInteractionEnd: () => void;
}) {
	const hasValues =
		(adjustments.values.face_adjust_skin_Intensity ?? 0) !== 0 ||
		(adjustments.values.face_adjust_skin_ColdWarm ?? 0) !== 0;
	const selected =
		adjustments.skinToneResourceId === undefined
			? hasValues
				? JIANYING_PORTRAIT_LEGACY_SKIN_RESOURCE_ID
				: null
			: adjustments.skinToneResourceId;
	const isZh = locale === "zh";
	const change = ({
		resourceId,
	}: {
		resourceId?: MediaPortraitAdjustments["skinToneResourceId"];
	}) => {
		if (
			disabled ||
			(resourceId &&
				!tones.some((tone) => tone.resourceId === resourceId && tone.ready))
		)
			return;
		onInteractionStart();
		onChange(selectPortraitSkinTone({ adjustments, resourceId }));
		onInteractionEnd();
	};
	return (
		<div
			role="group"
			aria-label={isZh ? "肤色选择（全部人脸）" : "Skin tone (all faces)"}
			className="flex flex-wrap items-center gap-2 py-2"
			data-testid="portrait-skin-tone-palette"
		>
			<button
				type="button"
				title={isZh ? "无" : "None"}
				aria-label={isZh ? "无肤色" : "No skin tone"}
				aria-pressed={selected === null}
				disabled={disabled}
				className={cn(
					"flex size-8 shrink-0 items-center justify-center rounded-full border disabled:opacity-40",
					selected === null &&
						"ring-2 ring-primary ring-offset-2 ring-offset-background"
				)}
				onClick={() => change({})}
				onKeyDown={(event) => event.stopPropagation()}
			>
				<Ban className="size-4" aria-hidden="true">
					<title>{isZh ? "无" : "None"}</title>
				</Ban>
			</button>
			{tones.map((tone) => {
				const title = isZh ? tone.titleZh : tone.titleEn;
				return (
					<button
						key={tone.resourceId}
						type="button"
						title={title}
						aria-label={title}
						aria-pressed={selected === tone.resourceId}
						disabled={disabled || !tone.ready}
						style={{ backgroundColor: tone.color }}
						className={cn(
							"flex size-8 shrink-0 items-center justify-center rounded-full border border-black/30 text-black disabled:opacity-40",
							selected === tone.resourceId &&
								"ring-2 ring-primary ring-offset-2 ring-offset-background"
						)}
						onClick={() => change({ resourceId: tone.resourceId })}
						onKeyDown={(event) => event.stopPropagation()}
					>
						{selected === tone.resourceId ? (
							<Check className="size-4" aria-hidden="true">
								<title>{title}</title>
							</Check>
						) : null}
					</button>
				);
			})}
		</div>
	);
}
