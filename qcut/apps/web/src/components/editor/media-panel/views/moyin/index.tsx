/**
 * MoyinView — Root component for the Moyin script-to-storyboard workflow.
 *
 * Split-panel layout:
 * - Left (~30%): ScriptInputPanel — script input + config
 * - Center (~40%): StructurePanel — episode/character/scene hierarchy
 * - Right (~30%): PropertyPanel — detail view for selected item (shown on selection)
 */

"use client";

import { useEffect } from "react";
import { useParams } from "@tanstack/react-router";
import { useMoyinStore } from "@/stores/moyin-store";
import {
	ResizablePanelGroup,
	ResizablePanel,
	ResizableHandle,
} from "@/components/ui/resizable";
import { ScriptInput } from "./script-input";
import { StructurePanel } from "./structure-panel";
import { PropertyPanel } from "./property-panel";
import { FileTextIcon, XIcon } from "lucide-react";
import { EXAMPLE_SCRIPTS } from "@/lib/moyin/script/example-scripts";

export function MoyinView() {
	const params = useParams({ from: "/editor/$project_id" });
	const projectId = params.project_id;
	const parseStatus = useMoyinStore((s) => s.parseStatus);
	const characters = useMoyinStore((s) => s.characters);
	const scenes = useMoyinStore((s) => s.scenes);
	const shots = useMoyinStore((s) => s.shots);
	const episodes = useMoyinStore((s) => s.episodes);
	const checkApiKeyStatus = useMoyinStore((s) => s.checkApiKeyStatus);
	const loadProject = useMoyinStore((s) => s.loadProject);
	const selectedItemId = useMoyinStore((s) => s.selectedItemId);
	const selectedItemType = useMoyinStore((s) => s.selectedItemType);
	const setSelectedItem = useMoyinStore((s) => s.setSelectedItem);

	useEffect(() => {
		checkApiKeyStatus();
	}, [checkApiKeyStatus]);

	useEffect(() => {
		if (projectId) loadProject(projectId);
	}, [projectId, loadProject]);

	// Auto-load the first example when the store is empty after project load
	const rawScript = useMoyinStore((s) => s.rawScript);
	useEffect(() => {
		if (
			parseStatus === "idle" &&
			!rawScript.trim() &&
			characters.length === 0 &&
			EXAMPLE_SCRIPTS.length > 0
		) {
			const ex = EXAMPLE_SCRIPTS[0];
			useMoyinStore.setState({
				rawScript: ex.content,
				language: ex.language,
				scriptData: ex.structure.scriptData,
				characters: ex.structure.characters,
				scenes: ex.structure.scenes,
				episodes: ex.structure.episodes,
				shots: ex.structure.shots,
				parseStatus: "ready",
				activeStep: "characters",
			});
		}
	}, [parseStatus, rawScript, characters.length]);

	const hasSelection = !!selectedItemId;

	const detailsLabel = (() => {
		if (!selectedItemId || !selectedItemType) return "Details";
		if (selectedItemType === "character") {
			const c = characters.find((ch) => ch.id === selectedItemId);
			return c ? `Character: ${c.name}` : "Character";
		}
		if (selectedItemType === "scene") {
			const s = scenes.find((sc) => sc.id === selectedItemId);
			return s ? `Scene: ${s.name || s.location}` : "Scene";
		}
		if (selectedItemType === "shot") {
			const idx = shots.findIndex((sh) => sh.id === selectedItemId);
			return idx >= 0 ? `Shot ${idx + 1} of ${shots.length}` : "Shot";
		}
		if (selectedItemType === "episode") {
			const ep = episodes.find((e) => e.id === selectedItemId);
			return ep ? `Episode: ${ep.title}` : "Episode";
		}
		return "Details";
	})();

	const statusText =
		parseStatus === "parsing"
			? "Parsing..."
			: parseStatus === "ready"
				? `${characters.length} characters, ${scenes.length} scenes`
				: parseStatus === "error"
					? "Parse error"
					: "";

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-2 border-b">
				<div className="flex items-center gap-1.5 text-sm font-medium">
					<FileTextIcon className="h-4 w-4 text-muted-foreground" />
					Script Editor
				</div>
				{statusText && (
					<span
						role="status"
						aria-live="polite"
						className="text-xs text-muted-foreground"
					>
						{statusText}
					</span>
				)}
			</div>

			{/* Split panels */}
			<div className="flex-1 min-h-0">
				<ResizablePanelGroup
					orientation="horizontal"
					aria-label="Script editor workspace"
				>
					<ResizablePanel
						defaultSize={hasSelection ? "30%" : "40%"}
						minSize="20%"
					>
						<div className="h-full overflow-y-auto p-3">
							<ScriptInput />
						</div>
					</ResizablePanel>
					<ResizableHandle aria-label="Resize script and structure panels" />
					<ResizablePanel
						defaultSize={hasSelection ? "40%" : "60%"}
						minSize="25%"
					>
						<div className="h-full overflow-y-auto p-3">
							<StructurePanel />
						</div>
					</ResizablePanel>
					{hasSelection && (
						<>
							<ResizableHandle aria-label="Resize structure and properties panels" />
							<ResizablePanel defaultSize="30%" minSize="20%">
								<div className="h-full overflow-y-auto">
									<div className="flex items-center justify-between px-3 py-2 border-b">
										<span className="text-xs font-medium text-muted-foreground truncate">
											{detailsLabel}
										</span>
										<button
											type="button"
											onClick={() => setSelectedItem(null, null)}
											className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
											aria-label="Close details"
										>
											<XIcon className="h-3.5 w-3.5" />
										</button>
									</div>
									<div className="p-3">
										<PropertyPanel />
									</div>
								</div>
							</ResizablePanel>
						</>
					)}
				</ResizablePanelGroup>
			</div>
		</div>
	);
}
