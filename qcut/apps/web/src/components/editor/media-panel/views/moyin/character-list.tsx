/**
 * CharacterList — step 2: review and edit extracted characters.
 */

import { useState, useCallback, useMemo } from "react";
import { useMoyinStore } from "@/stores/moyin-store";
import type { ScriptCharacter } from "@/types/moyin-script";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	Loader2,
	PencilIcon,
	PlusIcon,
	SearchIcon,
	SparklesIcon,
	Trash2Icon,
	UserIcon,
	XIcon,
} from "lucide-react";

const EXTRA_TAGS = ["minor", "extra", "background", "群演", "配角"];
const isExtra = (c: ScriptCharacter) =>
	c.tags?.some((t) => EXTRA_TAGS.includes(t.toLowerCase())) ?? false;

function CharacterCard({
	char,
	onUpdate,
	onRemove,
	onSelect,
	isSelected,
}: {
	char: ScriptCharacter;
	onUpdate: (id: string, updates: Partial<ScriptCharacter>) => void;
	onRemove: (id: string) => void;
	onSelect: (id: string) => void;
	isSelected: boolean;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState<Partial<ScriptCharacter>>({});

	const startEdit = useCallback(() => {
		setDraft({
			name: char.name,
			gender: char.gender,
			age: char.age,
			role: char.role,
			appearance: char.appearance,
		});
		setEditing(true);
	}, [char]);

	const cancelEdit = useCallback(() => {
		setDraft({});
		setEditing(false);
	}, []);

	const saveEdit = useCallback(() => {
		onUpdate(char.id, draft);
		setEditing(false);
		setDraft({});
	}, [char.id, draft, onUpdate]);

	if (editing) {
		return (
			<Card className="border border-primary/30 shadow-none">
				<CardContent className="px-3 py-3 space-y-2">
					<div className="space-y-1">
						<Label className="text-[10px]">Name</Label>
						<Input
							className="h-7 text-xs"
							value={draft.name ?? ""}
							onChange={(e) =>
								setDraft((d) => ({ ...d, name: e.target.value }))
							}
						/>
					</div>
					<div className="grid grid-cols-2 gap-2">
						<div className="space-y-1">
							<Label className="text-[10px]">Gender</Label>
							<Input
								className="h-7 text-xs"
								value={draft.gender ?? ""}
								placeholder="男/女"
								onChange={(e) =>
									setDraft((d) => ({ ...d, gender: e.target.value }))
								}
							/>
						</div>
						<div className="space-y-1">
							<Label className="text-[10px]">Age</Label>
							<Input
								className="h-7 text-xs"
								value={draft.age ?? ""}
								placeholder="e.g. 30s"
								onChange={(e) =>
									setDraft((d) => ({ ...d, age: e.target.value }))
								}
							/>
						</div>
					</div>
					<div className="space-y-1">
						<Label className="text-[10px]">Role</Label>
						<Input
							className="h-7 text-xs"
							value={draft.role ?? ""}
							onChange={(e) =>
								setDraft((d) => ({ ...d, role: e.target.value }))
							}
						/>
					</div>
					<div className="space-y-1">
						<Label className="text-[10px]">Appearance</Label>
						<Textarea
							className="text-xs min-h-[48px] resize-none"
							rows={2}
							value={draft.appearance ?? ""}
							onChange={(e) =>
								setDraft((d) => ({ ...d, appearance: e.target.value }))
							}
						/>
					</div>
					<div className="flex items-center gap-1.5 pt-1">
						<Button size="sm" className="h-6 text-xs px-2" onClick={saveEdit}>
							<CheckIcon className="mr-1 h-3 w-3" />
							Save
						</Button>
						<Button
							variant="outline"
							size="sm"
							className="h-6 text-xs px-2"
							onClick={cancelEdit}
						>
							<XIcon className="mr-1 h-3 w-3" />
							Cancel
						</Button>
						<div className="flex-1" />
						<Button
							variant="text"
							size="sm"
							className="h-6 text-xs px-2 text-destructive hover:text-destructive"
							onClick={() => onRemove(char.id)}
						>
							<Trash2Icon className="h-3 w-3" />
						</Button>
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card
			className={`border shadow-none group cursor-pointer transition-colors ${isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
			onClick={() => onSelect(char.id)}
		>
			<CardHeader className="pb-1 pt-3 px-3">
				<CardTitle className="text-sm flex items-center gap-2">
					<UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
					{char.name}
					{char.gender && (
						<Badge variant="outline" className="text-[10px] px-1.5">
							{char.gender}
						</Badge>
					)}
					{char.age && (
						<Badge variant="outline" className="text-[10px] px-1.5">
							{char.age}
						</Badge>
					)}
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							startEdit();
						}}
						className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
						aria-label={`Edit ${char.name}`}
					>
						<PencilIcon className="h-3 w-3 text-muted-foreground" />
					</button>
				</CardTitle>
			</CardHeader>
			<CardContent className="px-3 pb-3 pt-1">
				{char.role && (
					<p className="text-xs text-muted-foreground line-clamp-2">
						{char.role}
					</p>
				)}
				{char.visualPromptEn && (
					<p className="mt-1 text-[10px] text-blue-600 dark:text-blue-400 line-clamp-2">
						{char.visualPromptEn}
					</p>
				)}
				{char.tags && char.tags.length > 0 && (
					<div className="mt-1.5 flex flex-wrap gap-1">
						{char.tags.map((tag) => (
							<Badge key={tag} variant="secondary" className="text-[10px] px-1">
								{tag}
							</Badge>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

export function CharacterList() {
	const characters = useMoyinStore((s) => s.characters);
	const updateCharacter = useMoyinStore((s) => s.updateCharacter);
	const addCharacter = useMoyinStore((s) => s.addCharacter);
	const removeCharacter = useMoyinStore((s) => s.removeCharacter);
	const enhanceCharacters = useMoyinStore((s) => s.enhanceCharacters);
	const analyzeCharacterStages = useMoyinStore((s) => s.analyzeCharacterStages);
	const episodes = useMoyinStore((s) => s.episodes);
	const calibrationStatus = useMoyinStore((s) => s.characterCalibrationStatus);
	const calibrationError = useMoyinStore((s) => s.calibrationError);
	const setSelectedItem = useMoyinStore((s) => s.setSelectedItem);
	const selectedItemId = useMoyinStore((s) => s.selectedItemId);

	const isCalibrating = calibrationStatus === "calibrating";
	const [extrasExpanded, setExtrasExpanded] = useState(false);
	const [isAnalyzing, setIsAnalyzing] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");

	const handleAnalyzeStages = useCallback(async () => {
		setIsAnalyzing(true);
		try {
			await analyzeCharacterStages();
		} finally {
			setIsAnalyzing(false);
		}
	}, [analyzeCharacterStages]);

	const filteredCharacters = useMemo(() => {
		if (!searchQuery.trim()) return characters;
		const q = searchQuery.toLowerCase();
		return characters.filter(
			(c) =>
				c.name.toLowerCase().includes(q) ||
				c.role?.toLowerCase().includes(q) ||
				c.tags?.some((t) => t.toLowerCase().includes(q))
		);
	}, [characters, searchQuery]);

	const { mainChars, extraChars } = useMemo(() => {
		const main: ScriptCharacter[] = [];
		const extras: ScriptCharacter[] = [];
		for (const c of filteredCharacters) {
			if (isExtra(c)) extras.push(c);
			else main.push(c);
		}
		return { mainChars: main, extraChars: extras };
	}, [filteredCharacters]);

	const handleAdd = useCallback(() => {
		addCharacter({
			id: `char_${Date.now()}`,
			name: "New Character",
		});
	}, [addCharacter]);

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<p className="text-xs text-muted-foreground">
					{characters.length} character{characters.length !== 1 ? "s" : ""}{" "}
					extracted
				</p>
				<div className="flex items-center gap-1">
					<Button
						variant="text"
						size="sm"
						className="h-6 text-xs px-2"
						onClick={enhanceCharacters}
						disabled={isCalibrating || characters.length === 0}
					>
						{isCalibrating ? (
							<Loader2 className="mr-1 h-3 w-3 animate-spin" />
						) : (
							<SparklesIcon className="mr-1 h-3 w-3" />
						)}
						{calibrationStatus === "done" ? "Enhanced" : "AI Enhance"}
					</Button>
					{episodes.length > 1 && (
						<Button
							variant="text"
							size="sm"
							className="h-6 text-xs px-2"
							onClick={handleAnalyzeStages}
							disabled={isAnalyzing || characters.length === 0}
						>
							{isAnalyzing ? (
								<Loader2 className="mr-1 h-3 w-3 animate-spin" />
							) : (
								<SparklesIcon className="mr-1 h-3 w-3" />
							)}
							Stages
						</Button>
					)}
					<Button
						variant="text"
						size="sm"
						className="h-6 text-xs px-2"
						onClick={handleAdd}
					>
						<PlusIcon className="mr-1 h-3 w-3" />
						Add
					</Button>
				</div>
			</div>

			{characters.length > 0 && (
				<div className="relative">
					<SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
					<Input
						className="h-7 text-xs pl-7 pr-7"
						placeholder="Search characters..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
					/>
					{searchQuery && (
						<button
							type="button"
							onClick={() => setSearchQuery("")}
							className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted"
						>
							<XIcon className="h-3 w-3 text-muted-foreground" />
						</button>
					)}
				</div>
			)}

			{calibrationError && calibrationStatus === "error" && (
				<div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
					{calibrationError}
				</div>
			)}

			{searchQuery && filteredCharacters.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
					<SearchIcon className="mb-2 h-6 w-6 opacity-40" />
					<p className="text-xs">No characters match "{searchQuery}"</p>
				</div>
			) : characters.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
					<UserIcon className="mb-2 h-8 w-8" />
					<p className="text-sm">No characters found</p>
					<p className="text-xs">Go back and try a different script</p>
				</div>
			) : (
				<div className="space-y-3">
					{/* Main characters */}
					{mainChars.length > 0 && (
						<div className="space-y-2">
							<p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
								Characters ({mainChars.length})
							</p>
							{mainChars.map((char) => (
								<CharacterCard
									key={char.id}
									char={char}
									onUpdate={updateCharacter}
									onRemove={removeCharacter}
									onSelect={(id) => setSelectedItem(id, "character")}
									isSelected={selectedItemId === char.id}
								/>
							))}
						</div>
					)}

					{/* Extras / minor characters */}
					{extraChars.length > 0 && (
						<div className="space-y-2 border-t border-dashed pt-2">
							<button
								type="button"
								onClick={() => setExtrasExpanded(!extrasExpanded)}
								className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
							>
								{extrasExpanded ? (
									<ChevronDownIcon className="h-3 w-3" />
								) : (
									<ChevronRightIcon className="h-3 w-3" />
								)}
								Extras ({extraChars.length})
							</button>
							{extrasExpanded &&
								extraChars.map((char) => (
									<CharacterCard
										key={char.id}
										char={char}
										onUpdate={updateCharacter}
										onRemove={removeCharacter}
										onSelect={(id) => setSelectedItem(id, "character")}
										isSelected={selectedItemId === char.id}
									/>
								))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
