import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CaptionPresetGrid } from "@/components/captions/caption-preset-grid";
import {
	CaptionStyleControls,
	CaptionStyleSlider,
	ColorControl,
} from "@/components/captions/caption-style-controls";
import type { CaptionStylePreset } from "@/lib/captions/caption-style-presets";
import { useTranslation } from "@/lib/i18n";
import type { SubtitleStyle } from "@/types/timeline";

const SUB_TAB_CLASS = "h-7 rounded-sm text-xs";

/**
 * 文本 tab of the caption panel: the caption text, the apply-to-all switch
 * and the 基础 / 气泡 / 花字 style groups.
 */
export function CaptionTextTab({
	text,
	onTextChange,
	style,
	applyToAll,
	onApplyToAllChange,
	onStyleChange,
	onInteractionStart,
	onInteractionEnd,
	selectedPresetId,
	onSelectPreset,
}: {
	text: string;
	onTextChange: (text: string) => void;
	style: SubtitleStyle;
	applyToAll: boolean;
	onApplyToAllChange: (applyToAll: boolean) => void;
	onStyleChange: (updates: Partial<SubtitleStyle>) => void;
	onInteractionStart: () => void;
	onInteractionEnd: () => void;
	selectedPresetId?: string;
	onSelectPreset: (preset: CaptionStylePreset) => void;
}) {
	const { t } = useTranslation();
	return (
		<div className="space-y-4" data-testid="caption-text-tab">
			<Textarea
				placeholder={t("caption.textPlaceholder")}
				aria-label={t("caption.textPlaceholder")}
				value={text}
				className="min-h-20 resize-none bg-background/50"
				onChange={(event) => onTextChange(event.target.value)}
			/>
			<div className="flex items-center gap-2">
				<Checkbox
					id="caption-apply-all"
					checked={applyToAll}
					onCheckedChange={(checked) => onApplyToAllChange(checked === true)}
					data-testid="caption-apply-all"
				/>
				<Label htmlFor="caption-apply-all" className="text-xs leading-snug">
					{t("caption.applyToAll")}
				</Label>
			</div>
			<Tabs defaultValue="basic">
				<TabsList className="grid h-8 w-full grid-cols-3 rounded-md p-0.5">
					<TabsTrigger value="basic" className={SUB_TAB_CLASS}>
						{t("caption.textTab.basic")}
					</TabsTrigger>
					<TabsTrigger value="bubble" className={SUB_TAB_CLASS}>
						{t("caption.textTab.bubble")}
					</TabsTrigger>
					<TabsTrigger value="fancy" className={SUB_TAB_CLASS}>
						{t("caption.textTab.fancy")}
					</TabsTrigger>
				</TabsList>
				<TabsContent value="basic" className="mt-4 space-y-4">
					<CaptionStyleControls
						style={style}
						onChange={onStyleChange}
						onInteractionStart={onInteractionStart}
						onInteractionEnd={onInteractionEnd}
					/>
					<div className="space-y-2 border-t border-border pt-4">
						<Label className="text-xs">{t("caption.presetStyles")}</Label>
						<CaptionPresetGrid
							selectedId={selectedPresetId}
							onSelect={onSelectPreset}
						/>
					</div>
				</TabsContent>
				<TabsContent value="bubble" className="mt-4 space-y-4">
					<ColorControl
						label={t("caption.backgroundColor")}
						value={style.backgroundColor}
						onChange={(backgroundColor) => onStyleChange({ backgroundColor })}
					/>
					<CaptionStyleSlider
						label={t("caption.backgroundOpacity")}
						value={style.bgOpacity * 100}
						min={0}
						max={100}
						step={1}
						onChange={(bgOpacity) =>
							onStyleChange({ bgOpacity: bgOpacity / 100 })
						}
						onInteractionStart={onInteractionStart}
						onInteractionEnd={onInteractionEnd}
					/>
				</TabsContent>
				<TabsContent value="fancy" className="mt-4 space-y-4">
					<CaptionStyleSlider
						label={t("caption.textOpacity")}
						value={style.fontOpacity * 100}
						min={0}
						max={100}
						step={1}
						onChange={(fontOpacity) =>
							onStyleChange({ fontOpacity: fontOpacity / 100 })
						}
						onInteractionStart={onInteractionStart}
						onInteractionEnd={onInteractionEnd}
					/>
					<ColorControl
						label={t("caption.outlineColor")}
						value={style.outlineColor}
						onChange={(outlineColor) => onStyleChange({ outlineColor })}
					/>
					<CaptionStyleSlider
						label={t("caption.outlineWidth")}
						value={style.outlineWidth}
						min={0}
						max={10}
						step={0.5}
						onChange={(outlineWidth) => onStyleChange({ outlineWidth })}
						onInteractionStart={onInteractionStart}
						onInteractionEnd={onInteractionEnd}
					/>
					<ColorControl
						label={t("caption.shadowColor")}
						value={style.shadowColor}
						onChange={(shadowColor) => onStyleChange({ shadowColor })}
					/>
				</TabsContent>
			</Tabs>
		</div>
	);
}
