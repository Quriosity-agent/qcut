import { useCallback, useMemo, useState } from "react";
import { Eraser, Highlighter, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PRESET_LABEL_KEYS } from "@/components/captions/caption-preset-grid";
import {
	captionsToSegments,
	DEFAULT_EMPHASIS_PRESET_ID,
	findEmphasisPreset,
	pickEmphasisCandidates,
	resolveLaneBaseStyle,
} from "@/lib/captions/caption-emphasis";
import { CAPTION_STYLE_PRESETS } from "@/lib/captions/caption-style-presets";
import { selectKeySegments } from "@/lib/captions/smart-recognition";
import { formatClockTime } from "@/lib/captions/workbench";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { usePlaybackStore } from "@/stores/editor/playback-store";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { CaptionElement } from "@/types/timeline";

/**
 * 字幕 tab of the caption panel: every caption on the lane, numbered and in
 * order, with inline editing and the key-point (划重点) actions.
 */
export function CaptionListTab({
	trackId,
	activeElementId,
}: {
	trackId: string;
	activeElementId: string;
}) {
	const { t } = useTranslation();
	const tracks = useTimelineStore((state) => state.tracks);
	const selectElement = useTimelineStore((state) => state.selectElement);
	const updateCaptionElement = useTimelineStore(
		(state) => state.updateCaptionElement
	);
	const removeElementFromTrack = useTimelineStore(
		(state) => state.removeElementFromTrack
	);
	const pushHistory = useTimelineStore((state) => state.pushHistory);
	const seek = usePlaybackStore((state) => state.seek);
	const [emphasisPresetId, setEmphasisPresetId] = useState(
		DEFAULT_EMPHASIS_PRESET_ID
	);
	const [isPicking, setIsPicking] = useState(false);
	const captions = useMemo(() => {
		const track = tracks.find((candidate) => candidate.id === trackId);
		return (track?.elements ?? [])
			.filter(
				(element): element is CaptionElement => element.type === "captions"
			)
			.sort((a, b) => a.startTime - b.startTime);
	}, [trackId, tracks]);
	const emphasizedCount = captions.filter((caption) => caption.emphasis).length;

	const focusCaption = useCallback(
		(caption: CaptionElement) => {
			selectElement(trackId, caption.id);
			seek(caption.startTime);
		},
		[seek, selectElement, trackId]
	);

	const applyEmphasis = useCallback(
		(ids: string[]) => {
			if (ids.length === 0) {
				toast.info(t("caption.list.noCandidates"));
				return;
			}
			const preset = findEmphasisPreset({ presetId: emphasisPresetId });
			pushHistory();
			for (const id of ids) {
				updateCaptionElement(
					trackId,
					id,
					{ emphasis: true, style: structuredClone(preset.style) },
					false
				);
			}
			toast.success(t("caption.list.highlighted", { count: ids.length }));
		},
		[emphasisPresetId, pushHistory, t, trackId, updateCaptionElement]
	);

	// Ask the labeler first; without a configured model fall back to the
	// local quote heuristic so the button always does something.
	const autoHighlight = useCallback(async () => {
		setIsPicking(true);
		try {
			let ids: string[] = [];
			try {
				const chosen = await selectKeySegments({
					segments: captionsToSegments({ captions }),
				});
				ids = captions
					.filter((_, index) => chosen.has(index))
					.map((caption) => caption.id);
			} catch {
				ids = [];
			}
			if (ids.length === 0) ids = pickEmphasisCandidates({ captions });
			applyEmphasis(ids);
		} finally {
			setIsPicking(false);
		}
	}, [applyEmphasis, captions]);

	const restyleEmphasized = useCallback(
		(presetId: string) => {
			setEmphasisPresetId(presetId);
			const targets = captions.filter((caption) => caption.emphasis);
			if (targets.length === 0) return;
			const preset = findEmphasisPreset({ presetId });
			pushHistory();
			for (const caption of targets) {
				updateCaptionElement(
					trackId,
					caption.id,
					{ style: structuredClone(preset.style) },
					false
				);
			}
		},
		[captions, pushHistory, trackId, updateCaptionElement]
	);

	const clearEmphasis = useCallback(() => {
		const targets = captions.filter((caption) => caption.emphasis);
		if (targets.length === 0) return;
		const base = resolveLaneBaseStyle({ captions });
		pushHistory();
		for (const caption of targets) {
			updateCaptionElement(
				trackId,
				caption.id,
				{ emphasis: false, style: structuredClone(base) },
				false
			);
		}
		toast.success(t("caption.list.cleared", { count: targets.length }));
	}, [captions, pushHistory, t, trackId, updateCaptionElement]);

	return (
		<div className="space-y-3" data-testid="caption-list-tab">
			<p className="text-[10px] text-muted-foreground">
				{t("caption.list.count", { count: captions.length })}
			</p>
			{captions.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					{t("caption.list.empty")}
				</p>
			) : (
				<ol
					className="max-h-80 space-y-1 overflow-y-auto pr-1"
					data-testid="caption-list"
				>
					{captions.map((caption, index) => {
						const active = caption.id === activeElementId;
						const end =
							caption.startTime +
							Math.max(
								0,
								caption.duration - caption.trimStart - caption.trimEnd
							);
						const words =
							caption.words?.filter((word) => word.type === "word") ?? [];
						return (
							<li
								key={caption.id}
								className={cn(
									"rounded-md border",
									active
										? "border-primary/60 bg-primary/10"
										: "border-transparent hover:bg-muted/60"
								)}
								data-testid="caption-list-row"
							>
								<button
									type="button"
									className="flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left"
									onClick={() => focusCaption(caption)}
									aria-current={active ? "true" : undefined}
								>
									<span className="flex items-center gap-2 text-[10px] text-muted-foreground">
										<span className="w-5 tabular-nums">{index + 1}</span>
										<span className="tabular-nums">
											{formatClockTime({ seconds: caption.startTime })} –{" "}
											{formatClockTime({ seconds: end })}
										</span>
										{caption.emphasis ? (
											<Highlighter className="size-3 text-primary">
												<title>{t("caption.list.emphasized")}</title>
											</Highlighter>
										) : null}
									</span>
									{active ? null : (
										<span className="line-clamp-2 text-xs">{caption.text}</span>
									)}
								</button>
								{active ? (
									<div className="space-y-1.5 px-2 pb-2">
										<Textarea
											value={caption.text}
											aria-label={t("caption.textPlaceholder")}
											className="min-h-14 resize-none text-xs"
											onChange={(event) =>
												updateCaptionElement(trackId, caption.id, {
													text: event.target.value,
												})
											}
										/>
										{words.length > 0 ? (
											<div className="flex flex-wrap gap-1">
												{words.map((word) => (
													<button
														key={word.id}
														type="button"
														className="rounded bg-muted px-1.5 py-0.5 text-[10px] hover:bg-muted/70"
														title={formatClockTime({ seconds: word.start })}
														onClick={() => seek(word.start)}
													>
														{word.text}
													</button>
												))}
											</div>
										) : null}
										<div className="flex justify-end">
											<Button
												type="button"
												variant="text"
												size="sm"
												className="h-6 px-2 text-[10px]"
												onClick={() =>
													removeElementFromTrack(trackId, caption.id)
												}
											>
												<Trash2 className="size-3" />
												{t("caption.list.delete")}
											</Button>
										</div>
									</div>
								) : null}
							</li>
						);
					})}
				</ol>
			)}
			<div className="space-y-2 border-t border-border pt-3">
				<div className="flex items-center gap-2">
					<Label className="shrink-0 text-xs">
						{t("caption.list.keywordStyle")}
					</Label>
					<Select value={emphasisPresetId} onValueChange={restyleEmphasized}>
						<SelectTrigger
							className="h-7 text-xs"
							aria-label={t("caption.list.keywordStyle")}
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{CAPTION_STYLE_PRESETS.map((preset) => {
								const labels = PRESET_LABEL_KEYS[preset.id];
								return (
									<SelectItem key={preset.id} value={preset.id}>
										{labels ? t(labels.name) : preset.name}
									</SelectItem>
								);
							})}
						</SelectContent>
					</Select>
				</div>
				<div className="grid grid-cols-2 gap-2">
					<Button
						type="button"
						size="sm"
						variant="secondary"
						className="h-8 text-xs"
						disabled={isPicking || captions.length === 0}
						onClick={() => void autoHighlight()}
						data-testid="caption-auto-highlight"
					>
						{isPicking ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							<Highlighter className="size-3.5" />
						)}
						{t("caption.list.autoHighlight")}
					</Button>
					<Button
						type="button"
						size="sm"
						variant="outline"
						className="h-8 text-xs"
						disabled={emphasizedCount === 0}
						onClick={clearEmphasis}
						data-testid="caption-clear-highlights"
					>
						<Eraser className="size-3.5" />
						{t("caption.list.clearKeywords")}
					</Button>
				</div>
			</div>
		</div>
	);
}
