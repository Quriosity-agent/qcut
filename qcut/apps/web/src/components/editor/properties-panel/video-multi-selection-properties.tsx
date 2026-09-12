import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import {
	MEDIA_BATCH_PROPERTIES,
	readMediaBatchValue,
	type MediaBatchMode,
	type MediaBatchProperty,
	type MediaBatchSelection,
} from "@/lib/video/media-batch-properties";
import { usePlaybackStore } from "@/stores/editor/playback-store";
import { useProjectStore } from "@/stores/project-store";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import { VideoBatchNumberField } from "./video-batch-number-field";

const COPY = {
	zh: {
		title: "个视频片段",
		mode: "修改方式",
		set: "统一设为",
		adjust: "各自调整",
		mixed: "混合值",
		commit: "按 Enter 或离开输入框应用；一次修改可一次撤销。",
		adjustHelp:
			"位置和旋转加上输入值；缩放 20 表示各自放大 20%；不透明度 20 表示增加 20 个百分点。负数表示减少。",
		scaleHelp:
			"缩放范围为 1–400%，不透明度为 0–100%。保留各片段的等比缩放设置，启用等比时两轴一起修改。",
		keyframes:
			"有动画的属性只修改当前播放位置对应的关键帧，未覆盖的片段使用首帧或末帧；其他关键帧保留。",
		locked: "选区包含锁定轨道，请先解锁再批量修改。",
		pause: "暂停后编辑",
	},
	en: {
		title: "video clips",
		mode: "Edit mode",
		set: "Set all to",
		adjust: "Adjust each by",
		mixed: "Mixed",
		commit:
			"Press Enter or leave a field to apply. Each edit is one undo step.",
		adjustHelp:
			"Position and rotation add the entered value. Scale 20 enlarges each clip by 20%; opacity 20 adds 20 percentage points. Negative values decrease.",
		scaleHelp:
			"Scale is limited to 1–400%, opacity to 0–100%. Each clip keeps its aspect-ratio setting; linked scales update both axes.",
		keyframes:
			"Animated properties update the keyframe at the playhead, clamped to each clip's first or last frame. Other keyframes stay unchanged.",
		locked: "The selection includes a locked track. Unlock it before editing.",
		pause: "Pause to edit",
	},
};

export function VideoMultiSelectionProperties({
	selections,
}: {
	selections: MediaBatchSelection[];
}) {
	const { t, locale } = useTranslation();
	const copy = COPY[locale];
	const [mode, setMode] = useState<MediaBatchMode>("set");
	const currentTime = usePlaybackStore((state) => state.currentTime);
	const isPlaying = usePlaybackStore((state) => state.isPlaying);
	const pause = usePlaybackStore((state) => state.pause);
	const fps = useProjectStore((state) => state.activeProject?.fps ?? 30);
	const tracks = useTimelineStore((state) => state.tracks);
	const updateBatch = useTimelineStore(
		(state) => state.updateMediaPropertiesBatch
	);
	const locked = selections.some(
		({ trackId }) => tracks.find((track) => track.id === trackId)?.locked
	);
	const selectionKey = JSON.stringify(
		selections.map(({ trackId, element }) => [trackId, element.id])
	);
	const labels: Record<MediaBatchProperty, string> = {
		x: t("mediaProperties.positionX"),
		y: t("mediaProperties.positionY"),
		scaleX: t("mediaProperties.horizontalScale"),
		scaleY: t("mediaProperties.verticalScale"),
		rotation: t("mediaProperties.rotation"),
		opacity: t("mediaProperties.opacity"),
	};
	const hasAnimation = selections.some(({ element }) =>
		MEDIA_BATCH_PROPERTIES.some((property) =>
			Boolean(element.keyframes?.[property]?.length)
		)
	);

	return (
		<div
			className="min-w-0 space-y-4"
			data-testid="video-multi-selection-properties"
		>
			<p className="text-sm font-medium">
				{selections.length} {copy.title}
			</p>
			{isPlaying ? (
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={pause}
					onKeyDown={(event) => event.stopPropagation()}
				>
					{copy.pause}
				</Button>
			) : null}
			<label className="flex items-center justify-between gap-3 text-xs">
				{copy.mode}
				<select
					aria-label={copy.mode}
					className="h-8 rounded-md border border-input bg-background px-2 text-xs"
					value={mode}
					onChange={(event) =>
						setMode(event.target.value === "adjust" ? "adjust" : "set")
					}
				>
					<option value="set">{copy.set}</option>
					<option value="adjust">{copy.adjust}</option>
				</select>
			</label>
			{locked ? (
				<p role="status" className="text-xs text-amber-500">
					{copy.locked}
				</p>
			) : null}
			<div className="space-y-3">
				{MEDIA_BATCH_PROPERTIES.map((property) => {
					const values = selections.map(({ element }) =>
						readMediaBatchValue({ element, property, currentTime, fps })
					);
					const mixed = values.some(
						(value) => Math.abs(value - values[0]) > 0.0001
					);
					const suffix =
						property.startsWith("scale") || property === "opacity"
							? "%"
							: property === "rotation"
								? "°"
								: "px";
					return (
						<VideoBatchNumberField
							key={`${selectionKey}:${property}:${mode}:${currentTime}:${JSON.stringify(values)}:${locked}:${isPlaying}`}
							label={labels[property]}
							value={mode === "set" ? (values[0] ?? 0) : 0}
							mixed={mode === "set" && mixed}
							mixedLabel={copy.mixed}
							suffix={suffix}
							disabled={Boolean(locked || isPlaying)}
							onCommit={(value) =>
								updateBatch({
									elements: selections.map(({ trackId, element }) => ({
										trackId,
										elementId: element.id,
									})),
									property,
									mode,
									value,
									currentTime,
								})
							}
						/>
					);
				})}
			</div>
			<div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
				<p>{copy.commit}</p>
				{mode === "adjust" ? <p>{copy.adjustHelp}</p> : null}
				<p>{copy.scaleHelp}</p>
				{hasAnimation ? <p>{copy.keyframes}</p> : null}
			</div>
		</div>
	);
}
