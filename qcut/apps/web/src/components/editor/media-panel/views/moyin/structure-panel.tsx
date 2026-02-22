/**
 * StructurePanel — Right panel showing parsed script structure:
 * episode tree, characters, scenes, and generation controls.
 */

import { useState } from "react";
import { useMoyinStore } from "@/stores/moyin-store";
import { EpisodeTree } from "./episode-tree";
import { CharacterList } from "./character-list";
import { SceneList } from "./scene-list";
import { ShotBreakdown } from "./shot-breakdown";
import { GenerateActions } from "./generate-actions";
import { cn } from "@/lib/utils";
import {
	CameraIcon,
	FileTextIcon,
	SparklesIcon,
	MapPinIcon,
	UsersIcon,
} from "lucide-react";

type StructureTab = "overview" | "characters" | "scenes" | "shots" | "generate";

const TABS: { key: StructureTab; label: string; icon: React.ElementType }[] = [
	{ key: "overview", label: "Structure", icon: FileTextIcon },
	{ key: "characters", label: "Characters", icon: UsersIcon },
	{ key: "scenes", label: "Scenes", icon: MapPinIcon },
	{ key: "shots", label: "Shots", icon: CameraIcon },
	{ key: "generate", label: "Generate", icon: SparklesIcon },
];

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
			{activeTab === "overview" && <EpisodeTree />}
			{activeTab === "characters" && <CharacterList />}
			{activeTab === "scenes" && <SceneList />}
			{activeTab === "shots" && <ShotBreakdown />}
			{activeTab === "generate" && <GenerateActions />}
		</div>
	);
}
