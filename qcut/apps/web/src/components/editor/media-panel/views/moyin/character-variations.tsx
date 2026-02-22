/**
 * CharacterVariations — CRUD list for character wardrobe/stage variations.
 * Each variation has a name, visual prompt, optional episode range, and image.
 */

import { useState } from "react";
import type { CharacterVariation } from "@/types/moyin-script";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
	CheckIcon,
	PencilIcon,
	PlusIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import { CollapsibleSection } from "./collapsible-section";

interface CharacterVariationsProps {
	variations: CharacterVariation[];
	onChange: (variations: CharacterVariation[]) => void;
}

function generateId(): string {
	return `var-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function CharacterVariations({
	variations,
	onChange,
}: CharacterVariationsProps) {
	const [editingId, setEditingId] = useState<string | null>(null);
	const [draft, setDraft] = useState<Partial<CharacterVariation>>({});

	const handleAdd = () => {
		const newVar: CharacterVariation = {
			id: generateId(),
			name: `Variation ${variations.length + 1}`,
			visualPrompt: "",
		};
		const updated = [...variations, newVar];
		onChange(updated);
		setEditingId(newVar.id);
		setDraft({ ...newVar });
	};

	const handleSave = () => {
		if (!editingId) return;
		onChange(
			variations.map((v) => (v.id === editingId ? { ...v, ...draft } : v))
		);
		setEditingId(null);
		setDraft({});
	};

	const handleCancel = () => {
		// If the variation has no visualPrompt (freshly added), remove it
		const current = variations.find((v) => v.id === editingId);
		if (current && !current.visualPrompt) {
			onChange(variations.filter((v) => v.id !== editingId));
		}
		setEditingId(null);
		setDraft({});
	};

	const handleRemove = (id: string) => {
		onChange(variations.filter((v) => v.id !== id));
		if (editingId === id) {
			setEditingId(null);
			setDraft({});
		}
	};

	return (
		<CollapsibleSection
			title={`Variations (${variations.length})`}
			defaultOpen={variations.length > 0}
		>
			<div className="space-y-2">
				{variations.map((v) => (
					<div key={v.id} className="rounded-md border p-2 space-y-2 text-xs">
						{editingId === v.id ? (
							<VariationEditForm
								draft={draft}
								setDraft={setDraft}
								onSave={handleSave}
								onCancel={handleCancel}
							/>
						) : (
							<VariationReadView
								variation={v}
								onEdit={() => {
									setEditingId(v.id);
									setDraft({ ...v });
								}}
								onRemove={() => handleRemove(v.id)}
							/>
						)}
					</div>
				))}

				<Button
					variant="outline"
					size="sm"
					onClick={handleAdd}
					className="w-full text-xs"
					disabled={editingId !== null}
				>
					<PlusIcon className="mr-1 h-3 w-3" />
					Add Variation
				</Button>
			</div>
		</CollapsibleSection>
	);
}

// ==================== Sub-components ====================

function VariationReadView({
	variation,
	onEdit,
	onRemove,
}: {
	variation: CharacterVariation;
	onEdit: () => void;
	onRemove: () => void;
}) {
	return (
		<>
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-1.5">
					<span className="font-medium">{variation.name}</span>
					{variation.isStageVariation && (
						<Badge variant="secondary" className="text-[10px] px-1 py-0">
							Stage
						</Badge>
					)}
				</div>
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={onEdit}
						className="p-0.5 rounded hover:bg-muted text-muted-foreground"
						aria-label={`Edit "${variation.name}" variation`}
					>
						<PencilIcon className="h-3 w-3" />
					</button>
					<button
						type="button"
						onClick={onRemove}
						className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
						aria-label={`Remove "${variation.name}" variation`}
					>
						<Trash2Icon className="h-3 w-3" />
					</button>
				</div>
			</div>

			{variation.ageDescription && (
				<p className="text-muted-foreground">Age: {variation.ageDescription}</p>
			)}

			{variation.episodeRange && (
				<p className="text-muted-foreground">
					Episodes {variation.episodeRange[0]}–{variation.episodeRange[1]}
				</p>
			)}

			{variation.visualPrompt && (
				<p className="text-muted-foreground line-clamp-2">
					{variation.visualPrompt}
				</p>
			)}

			{variation.imageUrl && (
				<img
					src={variation.imageUrl}
					alt={variation.name}
					className="h-16 w-16 rounded object-cover"
				/>
			)}
		</>
	);
}

function VariationEditForm({
	draft,
	setDraft,
	onSave,
	onCancel,
}: {
	draft: Partial<CharacterVariation>;
	setDraft: (d: Partial<CharacterVariation>) => void;
	onSave: () => void;
	onCancel: () => void;
}) {
	return (
		<>
			<div className="space-y-1">
				<Label className="text-[10px]">Name</Label>
				<Input
					value={draft.name || ""}
					onChange={(e) => setDraft({ ...draft, name: e.target.value })}
					className="h-6 text-xs"
				/>
			</div>

			<div className="space-y-1">
				<Label className="text-[10px]">Age Description</Label>
				<Input
					value={draft.ageDescription || ""}
					onChange={(e) =>
						setDraft({ ...draft, ageDescription: e.target.value })
					}
					className="h-6 text-xs"
					placeholder="e.g., 25 years old"
				/>
			</div>

			<div className="space-y-1">
				<Label className="text-[10px]">Stage Description</Label>
				<Input
					value={draft.stageDescription || ""}
					onChange={(e) =>
						setDraft({ ...draft, stageDescription: e.target.value })
					}
					className="h-6 text-xs"
					placeholder="e.g., Early career"
				/>
			</div>

			<div className="space-y-1">
				<Label className="text-[10px]">Visual Prompt (EN)</Label>
				<Textarea
					value={draft.visualPrompt || ""}
					onChange={(e) => setDraft({ ...draft, visualPrompt: e.target.value })}
					className="min-h-[60px] text-xs"
					placeholder="Detailed visual description..."
				/>
			</div>

			<div className="space-y-1">
				<Label className="text-[10px]">Visual Prompt (ZH)</Label>
				<Textarea
					value={draft.visualPromptZh || ""}
					onChange={(e) =>
						setDraft({ ...draft, visualPromptZh: e.target.value })
					}
					className="min-h-[40px] text-xs"
					placeholder="Chinese visual description..."
				/>
			</div>

			<div className="flex items-center gap-1.5">
				<Button size="sm" onClick={onSave} className="h-6 text-xs px-2">
					<CheckIcon className="mr-1 h-3 w-3" />
					Save
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={onCancel}
					className="h-6 text-xs px-2"
				>
					<XIcon className="mr-1 h-3 w-3" />
					Cancel
				</Button>
			</div>
		</>
	);
}
