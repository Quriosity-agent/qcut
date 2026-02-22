/**
 * PromptEditor — three-tier prompt editing for shots.
 * Image prompt (首帧), Video prompt (视频), End frame prompt (尾帧).
 * Each tier supports EN/ZH toggle.
 */

import { useState } from "react";
import type { Shot } from "@/types/moyin-script";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
	ChevronDownIcon,
	ChevronRightIcon,
	CopyIcon,
	ImageIcon,
	FilmIcon,
	SquareIcon,
} from "lucide-react";

type Lang = "en" | "zh";

interface PromptSectionProps {
	label: string;
	icon: React.ElementType;
	enValue: string;
	zhValue: string;
	onEnChange: (value: string) => void;
	onZhChange: (value: string) => void;
	readOnly?: boolean;
}

function PromptSection({
	label,
	icon: Icon,
	enValue,
	zhValue,
	onEnChange,
	onZhChange,
	readOnly,
}: PromptSectionProps) {
	const [expanded, setExpanded] = useState(true);
	const [lang, setLang] = useState<Lang>("en");
	const [copied, setCopied] = useState(false);

	const value = lang === "en" ? enValue : zhValue;
	const onChange = lang === "en" ? onEnChange : onZhChange;
	const hasContent = enValue || zhValue;

	const handleCopy = async () => {
		const text = [enValue && `EN: ${enValue}`, zhValue && `ZH: ${zhValue}`]
			.filter(Boolean)
			.join("\n");
		if (text) {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		}
	};

	if (readOnly && !hasContent) return null;

	return (
		<div className="border rounded-md">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs font-medium hover:bg-muted/50 transition-colors"
			>
				{expanded ? (
					<ChevronDownIcon className="h-3 w-3 shrink-0" />
				) : (
					<ChevronRightIcon className="h-3 w-3 shrink-0" />
				)}
				<Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
				<span className="flex-1 text-left">{label}</span>
				{hasContent && (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							handleCopy();
						}}
						className="p-0.5 rounded hover:bg-muted text-muted-foreground"
						aria-label={`Copy ${label}`}
					>
						{copied ? (
							<span className="text-[9px] text-green-600">Copied</span>
						) : (
							<CopyIcon className="h-2.5 w-2.5" />
						)}
					</button>
				)}
			</button>

			{expanded && (
				<div className="px-2 pb-2 space-y-1.5">
					{/* EN/ZH toggle */}
					<div className="flex items-center gap-0.5">
						{(["en", "zh"] as const).map((l) => (
							<button
								key={l}
								type="button"
								onClick={() => setLang(l)}
								className={cn(
									"px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors",
									lang === l
										? "bg-primary text-primary-foreground"
										: "text-muted-foreground hover:bg-muted"
								)}
							>
								{l === "en" ? "EN" : "ZH"}
							</button>
						))}
					</div>

					{readOnly ? (
						<p className="text-xs whitespace-pre-wrap">
							{value || (
								<span className="text-muted-foreground italic">Empty</span>
							)}
						</p>
					) : (
						<Textarea
							className="text-xs min-h-[48px] resize-none"
							rows={3}
							value={value}
							onChange={(e) => onChange(e.target.value)}
							placeholder={`${label} (${lang === "en" ? "English" : "Chinese"})`}
						/>
					)}
				</div>
			)}
		</div>
	);
}

interface PromptEditorProps {
	draft: Partial<Shot>;
	onUpdate: (updates: Partial<Shot>) => void;
	readOnly?: boolean;
}

export function PromptEditor({ draft, onUpdate, readOnly }: PromptEditorProps) {
	return (
		<div className="space-y-1.5">
			<Label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
				Prompts
			</Label>

			<PromptSection
				label="Image Prompt"
				icon={ImageIcon}
				enValue={draft.imagePrompt ?? ""}
				zhValue={draft.imagePromptZh ?? ""}
				onEnChange={(v) => onUpdate({ imagePrompt: v })}
				onZhChange={(v) => onUpdate({ imagePromptZh: v })}
				readOnly={readOnly}
			/>

			<PromptSection
				label="Video Prompt"
				icon={FilmIcon}
				enValue={draft.videoPrompt ?? ""}
				zhValue={draft.videoPromptZh ?? ""}
				onEnChange={(v) => onUpdate({ videoPrompt: v })}
				onZhChange={(v) => onUpdate({ videoPromptZh: v })}
				readOnly={readOnly}
			/>

			<div className="space-y-1">
				{!readOnly && (
					<div className="flex items-center gap-2 px-0.5">
						<Checkbox
							id="needs-end-frame"
							checked={draft.needsEndFrame ?? false}
							onCheckedChange={(checked) =>
								onUpdate({ needsEndFrame: !!checked })
							}
						/>
						<label
							htmlFor="needs-end-frame"
							className="text-[10px] text-muted-foreground cursor-pointer"
						>
							Enable end frame
						</label>
					</div>
				)}

				{(draft.needsEndFrame ||
					draft.endFramePrompt ||
					draft.endFramePromptZh) && (
					<PromptSection
						label="End Frame Prompt"
						icon={SquareIcon}
						enValue={draft.endFramePrompt ?? ""}
						zhValue={draft.endFramePromptZh ?? ""}
						onEnChange={(v) => onUpdate({ endFramePrompt: v })}
						onZhChange={(v) => onUpdate({ endFramePromptZh: v })}
						readOnly={readOnly}
					/>
				)}
			</div>
		</div>
	);
}
