import { Ban, Palette } from "lucide-react";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { JianyingPortraitMakeupCardStatus } from "@/types/electron";
import type {
	MediaPortraitAdjustments,
	MediaPortraitMakeupCategory,
	MediaPortraitMakeupSelection,
} from "@/types/timeline";
import { applyPortraitMakeup } from "@/lib/portrait/portrait-face-scope";
import { cn } from "@/lib/utils";
import { PortraitNumberControl } from "./portrait-number-control";

const MAKEUP_CATEGORY_LABELS: Record<
	MediaPortraitMakeupCategory,
	{ zh: string; en: string }
> = {
	look: { zh: "套装", en: "Looks" },
	lip: { zh: "口红", en: "Lip" },
	blush: { zh: "腮红", en: "Blush" },
	contour: { zh: "修容", en: "Contour" },
	aegyo: { zh: "卧蚕", en: "Aegyo" },
	brows: { zh: "眉毛", en: "Brows" },
	lashes: { zh: "睫毛", en: "Lashes" },
	eyeliner: { zh: "眼线", en: "Eyeliner" },
	eyeshadow: { zh: "眼影", en: "Eyeshadow" },
	contacts: { zh: "美瞳", en: "Contacts" },
	highlight: { zh: "高光", en: "Highlight" },
	freckles: { zh: "雀斑", en: "Freckles" },
};

const MAKEUP_CATEGORIES = Object.keys(
	MAKEUP_CATEGORY_LABELS
) as MediaPortraitMakeupCategory[];

function MakeupCard({
	card,
	disabled,
	selected,
	locale,
	onSelect,
}: {
	card?: JianyingPortraitMakeupCardStatus;
	disabled: boolean;
	selected: boolean;
	locale: string;
	onSelect: () => void;
}) {
	const isZh = locale === "zh";
	const noneLabel = isZh ? "无" : "None";
	const label = card ? (isZh ? card.titleZh : card.titleEn) : noneLabel;
	return (
		<button
			type="button"
			className="group w-full min-w-0 rounded-md text-center focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
			aria-label={label}
			title={label}
			aria-pressed={selected}
			disabled={disabled || (card !== undefined && !card.ready)}
			onClick={onSelect}
			onKeyDown={(event) => event.stopPropagation()}
			data-testid={`portrait-makeup-card-${card?.id ?? "none"}`}
		>
			<span
				className={cn(
					"flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border bg-muted/50 transition-colors",
					selected
						? "border-cyan-500 ring-1 ring-cyan-500"
						: "border-border group-hover:border-muted-foreground/70"
				)}
			>
				{card?.thumbnailDataUrl ? (
					<img
						src={card.thumbnailDataUrl}
						alt=""
						className="size-full object-cover"
					/>
				) : card ? (
					<Palette
						aria-hidden="true"
						className="size-5 text-muted-foreground"
					/>
				) : (
					<Ban aria-hidden="true" className="size-5 text-muted-foreground" />
				)}
			</span>
			<span className="mt-1 block h-4 truncate text-[10px] leading-4 text-muted-foreground">
				{label}
			</span>
		</button>
	);
}

export function PortraitMakeupControls({
	cards,
	adjustments,
	disabled,
	locale,
	onChange,
	onInteractionStart,
	onInteractionEnd,
}: {
	cards: JianyingPortraitMakeupCardStatus[];
	adjustments: MediaPortraitAdjustments;
	disabled: boolean;
	locale: string;
	onChange: (adjustments: MediaPortraitAdjustments) => void;
	onInteractionStart: () => void;
	onInteractionEnd: () => void;
}) {
	const [category, setCategory] = useState<MediaPortraitMakeupCategory>("look");
	const categoryCards = cards.filter((card) => card.category === category);
	const selection = adjustments.makeup?.[category];
	const selectedCard = categoryCards.find(
		(card) => card.id === selection?.cardId
	);
	const changeCategory = ({
		nextSelection,
	}: {
		nextSelection?: MediaPortraitMakeupSelection;
	}) => {
		const makeup = nextSelection
			? { ...adjustments.makeup, [category]: nextSelection }
			: Object.fromEntries(
					Object.entries(adjustments.makeup ?? {}).filter(
						([currentCategory]) => currentCategory !== category
					)
				);
		onChange(applyPortraitMakeup({ adjustments, makeup }));
	};
	const selectCard = ({ card }: { card: JianyingPortraitMakeupCardStatus }) => {
		if (disabled || !card.ready || card.id === selection?.cardId) return;
		onInteractionStart();
		changeCategory({
			nextSelection: { cardId: card.id, intensity: card.defaultIntensity },
		});
		onInteractionEnd();
	};
	const clearCategory = () => {
		if (disabled || !selection) return;
		onInteractionStart();
		changeCategory({});
		onInteractionEnd();
	};
	const changeIntensity = ({ intensity }: { intensity: number }) => {
		if (disabled || !selectedCard?.ready || !selection) return;
		changeCategory({
			nextSelection: { ...selection, intensity },
		});
	};

	return (
		<Tabs
			value={category}
			onValueChange={(value) =>
				setCategory(value as MediaPortraitMakeupCategory)
			}
			className="min-w-0 space-y-3"
			onKeyDown={(event) => event.stopPropagation()}
			data-testid="portrait-section-makeup"
		>
			<TabsList
				className="flex h-auto min-w-0 flex-wrap justify-start gap-1 rounded-none bg-transparent p-0"
				aria-label={locale === "zh" ? "美妆分类" : "Makeup categories"}
			>
				{MAKEUP_CATEGORIES.map((item) => {
					const label =
						MAKEUP_CATEGORY_LABELS[item][locale === "zh" ? "zh" : "en"];
					return (
						<TabsTrigger
							key={item}
							type="button"
							value={item}
							title={label}
							className="h-6 max-w-full min-w-14 rounded-full bg-secondary/60 px-3 py-0 text-[11px] text-muted-foreground data-[state=active]:bg-secondary data-[state=active]:text-foreground data-[state=active]:shadow-none"
							disabled={disabled}
						>
							<span className="truncate">{label}</span>
						</TabsTrigger>
					);
				})}
			</TabsList>
			<TabsContent value={category} className="min-w-0 space-y-3">
				<div className="grid min-w-0 grid-cols-4 gap-2">
					<MakeupCard
						disabled={disabled}
						selected={!selection}
						locale={locale}
						onSelect={clearCategory}
					/>
					{categoryCards.map((card) => (
						<MakeupCard
							key={card.id}
							card={card}
							disabled={disabled}
							selected={card.id === selection?.cardId}
							locale={locale}
							onSelect={() => selectCard({ card })}
						/>
					))}
				</div>
				<PortraitNumberControl
					label={locale === "zh" ? "强度" : "Intensity"}
					locale={locale}
					value={selection?.intensity ?? 0}
					min={0}
					max={100}
					step={1}
					disabled={disabled || !selectedCard?.ready}
					onChange={(intensity) => changeIntensity({ intensity })}
					onInteractionStart={onInteractionStart}
					onInteractionEnd={onInteractionEnd}
				/>
			</TabsContent>
		</Tabs>
	);
}
