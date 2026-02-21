/**
 * StructurePanel — Right panel showing parsed script structure:
 * episode hierarchy, characters, scenes, filter tabs, and generation controls.
 */

import { useState } from "react";
import { useMoyinStore } from "@/stores/moyin-store";
import { CharacterList } from "./character-list";
import { SceneList } from "./scene-list";
import { GenerateActions } from "./generate-actions";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
	FileTextIcon,
	SparklesIcon,
	MapPinIcon,
	UsersIcon,
} from "lucide-react";

type StructureTab = "overview" | "characters" | "scenes" | "generate";

const TABS: { key: StructureTab; label: string; icon: React.ElementType }[] = [
	{ key: "overview", label: "Overview", icon: FileTextIcon },
	{ key: "characters", label: "Characters", icon: UsersIcon },
	{ key: "scenes", label: "Scenes", icon: MapPinIcon },
	{ key: "generate", label: "Generate", icon: SparklesIcon },
];

function OverviewContent() {
	const scriptData = useMoyinStore((s) => s.scriptData);
	const characters = useMoyinStore((s) => s.characters);
	const scenes = useMoyinStore((s) => s.scenes);
	const parseStatus = useMoyinStore((s) => s.parseStatus);

	if (parseStatus !== "ready" || !scriptData) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
				<FileTextIcon className="mb-3 h-10 w-10 opacity-40" />
				<p className="text-sm font-medium">No Script Parsed</p>
				<p className="text-xs mt-1 max-w-[200px]">
					Paste a screenplay in the left panel and click Parse Script to begin.
				</p>
			</div>
		);
	}

	const { title, genre, episodes } = scriptData;

	return (
		<div className="space-y-3">
			{/* Title & genre */}
			<div className="space-y-1">
				{title && <p className="text-sm font-medium">{title}</p>}
				{genre && (
					<Badge variant="outline" className="text-[10px]">
						{genre}
					</Badge>
				)}
			</div>

			{/* Stats */}
			<div className="grid grid-cols-3 gap-2">
				<div className="rounded-md border p-2 text-center">
					<p className="text-lg font-semibold">{characters.length}</p>
					<p className="text-[10px] text-muted-foreground">Characters</p>
				</div>
				<div className="rounded-md border p-2 text-center">
					<p className="text-lg font-semibold">{scenes.length}</p>
					<p className="text-[10px] text-muted-foreground">Scenes</p>
				</div>
				<div className="rounded-md border p-2 text-center">
					<p className="text-lg font-semibold">{episodes?.length ?? 0}</p>
					<p className="text-[10px] text-muted-foreground">Episodes</p>
				</div>
			</div>

			{/* Episode list */}
			{episodes && episodes.length > 0 && (
				<div className="space-y-1.5">
					<p className="text-xs font-medium text-muted-foreground">Episodes</p>
					{episodes.map((ep, i) => (
						<div
							key={ep.id}
							className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs"
						>
							<span className="text-muted-foreground">#{i + 1}</span>
							<span className="font-medium flex-1 truncate">{ep.title}</span>
							{ep.sceneIds && (
								<Badge variant="secondary" className="text-[10px]">
									{ep.sceneIds.length} scenes
								</Badge>
							)}
						</div>
					))}
				</div>
			)}

			{/* Character summary */}
			{characters.length > 0 && (
				<div className="space-y-1.5">
					<p className="text-xs font-medium text-muted-foreground">
						Characters ({characters.length})
					</p>
					<div className="flex flex-wrap gap-1">
						{characters.map((c) => (
							<Badge key={c.id} variant="outline" className="text-[10px]">
								{c.name}
							</Badge>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

export function StructurePanel() {
	const [activeTab, setActiveTab] = useState<StructureTab>("overview");
	const parseStatus = useMoyinStore((s) => s.parseStatus);
	const isReady = parseStatus === "ready";

	return (
		<div className="space-y-3">
			{/* Tab bar */}
			<div className="flex items-center gap-1 border-b pb-0">
				{TABS.map((tab) => {
					const Icon = tab.icon;
					const disabled = tab.key !== "overview" && !isReady;
					return (
						<button
							key={tab.key}
							type="button"
							disabled={disabled}
							onClick={() => !disabled && setActiveTab(tab.key)}
							className={cn(
								"flex items-center gap-1 px-2 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors",
								activeTab === tab.key
									? "border-primary text-primary"
									: disabled
										? "border-transparent text-muted-foreground/40 cursor-not-allowed"
										: "border-transparent text-muted-foreground hover:text-foreground"
							)}
						>
							<Icon className="h-3 w-3" />
							{tab.label}
						</button>
					);
				})}
			</div>

			{/* Tab content */}
			{activeTab === "overview" && <OverviewContent />}
			{activeTab === "characters" && <CharacterList />}
			{activeTab === "scenes" && <SceneList />}
			{activeTab === "generate" && <GenerateActions />}
		</div>
	);
}
