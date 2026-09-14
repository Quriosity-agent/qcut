import { useId } from "react";
import {
	AlignCenter,
	AlignLeft,
	AlignRight,
	AlignVerticalJustifyCenter,
	AlignVerticalJustifyEnd,
	AlignVerticalJustifyStart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FontPicker } from "@/components/ui/font-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { FontFamily } from "@/constants/font-constants";
import type { SubtitleStyle } from "@/types/timeline";
import { useTranslation } from "@/lib/i18n";

export function CaptionStyleSlider({
	label,
	value,
	min,
	max,
	step,
	onChange,
	onInteractionStart,
	onInteractionEnd,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	onChange: (value: number) => void;
	onInteractionStart: () => void;
	onInteractionEnd: () => void;
}) {
	const inputId = useId();
	return (
		<div className="space-y-1.5">
			<Label className="text-xs" htmlFor={inputId}>
				{label}
			</Label>
			<div className="flex items-center gap-2">
				<Slider
					aria-label={label}
					value={[value]}
					min={min}
					max={max}
					step={step}
					onValueChange={([nextValue]) => onChange(nextValue)}
					onPointerDown={onInteractionStart}
					onPointerUp={onInteractionEnd}
					onPointerCancel={onInteractionEnd}
					onKeyDown={onInteractionStart}
					onKeyUp={onInteractionEnd}
					className="min-w-0 flex-1"
				/>
				<Input
					id={inputId}
					type="number"
					aria-label={`${label} value`}
					value={Number(value.toFixed(2))}
					min={min}
					max={max}
					step={step}
					onFocus={onInteractionStart}
					onBlur={onInteractionEnd}
					onChange={(event) => {
						const nextValue = Number(event.target.value);
						if (Number.isFinite(nextValue)) {
							onChange(Math.min(max, Math.max(min, nextValue)));
						}
					}}
					className="h-7 w-16 text-center text-xs"
				/>
			</div>
		</div>
	);
}

/** Label + colour swatch row shared by the caption tabs. */
export function ColorControl({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
}) {
	const inputId = useId();
	return (
		<div className="flex items-center justify-between gap-3">
			<Label className="text-xs" htmlFor={inputId}>
				{label}
			</Label>
			<Input
				id={inputId}
				type="color"
				aria-label={label}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className="h-8 w-16 cursor-pointer p-1"
			/>
		</div>
	);
}

/** Enter/Space activation for click-driven buttons (repo accessibility rule 5). */
export function activateOnKeyboard({
	event,
	action,
}: {
	event: React.KeyboardEvent<HTMLButtonElement>;
	action: () => void;
}) {
	if (event.key !== "Enter" && event.key !== " ") return;
	event.preventDefault();
	action();
}

function SpacingField({
	label,
	value,
	min,
	max,
	step,
	onChange,
	onInteractionStart,
	onInteractionEnd,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	onChange: (value: number) => void;
	onInteractionStart: () => void;
	onInteractionEnd: () => void;
}) {
	const inputId = useId();
	return (
		<div className="flex min-w-0 flex-1 items-center gap-2">
			<Label className="shrink-0 text-xs" htmlFor={inputId}>
				{label}
			</Label>
			<Input
				id={inputId}
				type="number"
				aria-label={label}
				value={Number(value.toFixed(2))}
				min={min}
				max={max}
				step={step}
				onFocus={onInteractionStart}
				onBlur={onInteractionEnd}
				onChange={(event) => {
					const nextValue = Number(event.target.value);
					if (Number.isFinite(nextValue)) {
						onChange(Math.min(max, Math.max(min, nextValue)));
					}
				}}
				className="h-7 min-w-0 flex-1 text-center text-xs"
			/>
		</div>
	);
}

export function CaptionStyleControls({
	style,
	onChange,
	onInteractionStart,
	onInteractionEnd,
}: {
	style: SubtitleStyle;
	onChange: (updates: Partial<SubtitleStyle>) => void;
	onInteractionStart: () => void;
	onInteractionEnd: () => void;
}) {
	const { t } = useTranslation();
	const fontId = useId();
	const colorId = useId();
	const textStyleButtons = [
		{
			label: t("caption.bold"),
			active: style.bold,
			content: "B",
			className: "font-bold",
			action: () => onChange({ bold: !style.bold }),
		},
		{
			label: t("caption.underline"),
			active: style.underline,
			content: "U",
			className: "underline",
			action: () => onChange({ underline: !style.underline }),
		},
		{
			label: t("caption.italic"),
			active: style.italic,
			content: "I",
			className: "italic",
			action: () => onChange({ italic: !style.italic }),
		},
	];
	const setVertical = (align: "top" | "center" | "bottom", y: number) =>
		onChange({ position: { ...style.position, align, y } });
	const alignments = [
		{
			key: "left",
			label: t("caption.alignLeft"),
			icon: AlignLeft,
			active: style.textAlign === "left",
			action: () => onChange({ textAlign: "left" }),
		},
		{
			key: "center",
			label: t("caption.alignCenter"),
			icon: AlignCenter,
			active: style.textAlign === "center",
			action: () => onChange({ textAlign: "center" }),
		},
		{
			key: "right",
			label: t("caption.alignRight"),
			icon: AlignRight,
			active: style.textAlign === "right",
			action: () => onChange({ textAlign: "right" }),
		},
		{
			key: "top",
			label: t("caption.positionTop"),
			icon: AlignVerticalJustifyStart,
			active: style.position.align === "top",
			action: () => setVertical("top", 10),
		},
		{
			key: "middle",
			label: t("caption.positionMiddle"),
			icon: AlignVerticalJustifyCenter,
			active: style.position.align === "center",
			action: () => setVertical("center", 50),
		},
		{
			key: "bottom",
			label: t("caption.positionBottom"),
			icon: AlignVerticalJustifyEnd,
			active: style.position.align === "bottom",
			action: () => setVertical("bottom", 90),
		},
	];
	return (
		<div className="space-y-4" data-testid="caption-style-controls">
			<div className="space-y-1.5">
				<Label className="text-xs" htmlFor={fontId}>
					{t("caption.font")}
				</Label>
				<FontPicker
					id={fontId}
					aria-label={t("caption.fontFamily")}
					defaultValue={style.fontFamily}
					onValueChange={(fontFamily: FontFamily) => onChange({ fontFamily })}
				/>
			</div>
			<CaptionStyleSlider
				label={t("caption.fontSize")}
				value={style.fontSize}
				min={8}
				max={200}
				step={1}
				onChange={(fontSize) => onChange({ fontSize })}
				onInteractionStart={onInteractionStart}
				onInteractionEnd={onInteractionEnd}
			/>
			<div className="flex items-end gap-2">
				<div className="min-w-0 flex-1 space-y-1.5">
					<Label className="text-xs">{t("caption.style")}</Label>
					<div className="grid grid-cols-3 gap-1">
						{textStyleButtons.map((button) => (
							<Button
								key={button.label}
								type="button"
								variant={button.active ? "default" : "outline"}
								size="sm"
								className={`h-8 ${button.className}`}
								onClick={button.action}
								onKeyDown={(event) =>
									activateOnKeyboard({ event, action: button.action })
								}
								aria-label={button.label}
								aria-pressed={button.active}
							>
								{button.content}
							</Button>
						))}
					</div>
				</div>
				<div className="w-16 space-y-1.5">
					<Label className="text-xs" htmlFor={colorId}>
						{t("caption.color")}
					</Label>
					<Input
						id={colorId}
						type="color"
						aria-label={t("caption.fontColor")}
						value={style.fontColor}
						onChange={(event) => onChange({ fontColor: event.target.value })}
						className="h-8 w-full cursor-pointer p-1"
					/>
				</div>
			</div>
			<div className="flex gap-3">
				<SpacingField
					label={t("caption.characterSpacing")}
					value={style.letterSpacing}
					min={-10}
					max={50}
					step={0.5}
					onChange={(letterSpacing) => onChange({ letterSpacing })}
					onInteractionStart={onInteractionStart}
					onInteractionEnd={onInteractionEnd}
				/>
				<SpacingField
					label={t("caption.lineSpacing")}
					value={style.lineSpacing}
					min={0.8}
					max={3}
					step={0.05}
					onChange={(lineSpacing) => onChange({ lineSpacing })}
					onInteractionStart={onInteractionStart}
					onInteractionEnd={onInteractionEnd}
				/>
			</div>
			<div className="space-y-1.5">
				<Label className="text-xs">{t("caption.alignment")}</Label>
				<div className="grid grid-cols-6 gap-1">
					{alignments.map((alignment) => {
						const Icon = alignment.icon;
						return (
							<Button
								key={alignment.key}
								type="button"
								variant={alignment.active ? "default" : "outline"}
								size="sm"
								className="h-8 px-0"
								onClick={alignment.action}
								onKeyDown={(event) =>
									activateOnKeyboard({ event, action: alignment.action })
								}
								aria-label={alignment.label}
								title={alignment.label}
								aria-pressed={alignment.active}
							>
								<Icon className="size-4">
									<title>{alignment.label}</title>
								</Icon>
							</Button>
						);
					})}
				</div>
			</div>
		</div>
	);
}
