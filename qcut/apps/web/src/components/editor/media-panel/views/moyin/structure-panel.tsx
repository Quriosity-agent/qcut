/**
 * StructurePanel — Right panel showing parsed script structure:
 * episode tree, characters, scenes, and generation controls.
 */

import { useState, useCallback, useEffect } from "react";
import { useMoyinStore } from "@/stores/moyin-store";
import type { MoyinStep } from "@/stores/moyin-store";
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

const stepToTab: Record<MoyinStep, StructureTab> = {
	script: "overview",
	characters: "characters",
	scenes: "scenes",
	generate: "generate",
};

const tabToStep: Record<StructureTab, MoyinStep> = {
	overview: "script",
	characters: "characters",
	scenes: "scenes",
	shots: "scenes",
	generate: "generate",
};

const TABS: { key: StructureTab; label: string; icon: React.ElementType }[] = [
	{ key: "overview", label: "Structure", icon: FileTextIcon },
	{ key: "characters", label: "Characters", icon: UsersIcon },
	{ key: "scenes", label: "Scenes", icon: MapPinIcon },
	{ key: "shots", label: "Shots", icon: CameraIcon },
	{ key: "generate", label: "Generate", icon: SparklesIcon },
];

export function StructurePanel() {
	const activeStep = useMoyinStore((s) => s.activeStep);
	const setActiveStep = useMoyinStore((s) => s.setActiveStep);
	const [activeTab, setActiveTab] = useState<StructureTab>(
		stepToTab[activeStep] || "overview"
	);

	// Sync tab when store step changes externally (e.g. on project load)
	useEffect(() => {
		const mappedTab = stepToTab[activeStep];
		// Don't override "shots" with "scenes" if user explicitly chose shots
		if (mappedTab && activeTab !== "shots") {
			setActiveTab(mappedTab);
		} else if (mappedTab && activeTab === "shots" && activeStep !== "scenes") {
			setActiveTab(mappedTab);
		}
	}, [activeStep, activeTab]);

	const handleTabChange = useCallback(
		(tab: StructureTab) => {
			setActiveTab(tab);
			setActiveStep(tabToStep[tab]);
		},
		[setActiveStep]
	);

	// Keyboard shortcuts for navigation and deletion
	const deleteSelectedItem = useMoyinStore((s) => s.deleteSelectedItem);
	const selectNextItem = useMoyinStore((s) => s.selectNextItem);
	const selectPrevItem = useMoyinStore((s) => s.selectPrevItem);
	const setSelectedItem = useMoyinStore((s) => s.setSelectedItem);

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			// Don't interfere with input/textarea editing
			const tag = (e.target as HTMLElement)?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

			switch (e.key) {
				case "Delete":
				case "Backspace":
					deleteSelectedItem();
					break;
				case "Escape":
					setSelectedItem(null, null);
					break;
				case "ArrowDown":
					e.preventDefault();
					selectNextItem();
					break;
				case "ArrowUp":
					e.preventDefault();
					selectPrevItem();
					break;
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [deleteSelectedItem, selectNextItem, selectPrevItem, setSelectedItem]);

	return (
		<div className="space-y-3">
			{/* Tab bar */}
			<div className="flex items-center gap-1 border-b pb-0">
				{TABS.map((tab) => {
					const Icon = tab.icon;
					return (
						<button
							key={tab.key}
							type="button"
							onClick={() => handleTabChange(tab.key)}
							className={cn(
								"flex items-center gap-1 px-2 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors",
								activeTab === tab.key
									? "border-primary text-primary"
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
