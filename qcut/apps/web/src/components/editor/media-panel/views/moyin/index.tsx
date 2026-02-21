/**
 * MoyinView — Root component for the Moyin script-to-storyboard workflow.
 *
 * Split-panel layout:
 * - Left (~40%): ScriptInputPanel — script input + config
 * - Right (~60%): StructurePanel — episode/character/scene hierarchy
 */

"use client";

import { useEffect } from "react";
import { useMoyinStore } from "@/stores/moyin-store";
import {
	ResizablePanelGroup,
	ResizablePanel,
	ResizableHandle,
} from "@/components/ui/resizable";
import { ScriptInput } from "./script-input";
import { StructurePanel } from "./structure-panel";
import { FileTextIcon } from "lucide-react";

export function MoyinView() {
	const parseStatus = useMoyinStore((s) => s.parseStatus);
	const characters = useMoyinStore((s) => s.characters);
	const scenes = useMoyinStore((s) => s.scenes);
	const checkApiKeyStatus = useMoyinStore((s) => s.checkApiKeyStatus);

	useEffect(() => {
		checkApiKeyStatus();
	}, [checkApiKeyStatus]);

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
					<span className="text-xs text-muted-foreground">{statusText}</span>
				)}
			</div>

			{/* Split panels */}
			<div className="flex-1 min-h-0">
				<ResizablePanelGroup orientation="horizontal">
					<ResizablePanel defaultSize="40%" minSize="25%">
						<div className="h-full overflow-y-auto p-3">
							<ScriptInput />
						</div>
					</ResizablePanel>
					<ResizableHandle />
					<ResizablePanel defaultSize="60%" minSize="30%">
						<div className="h-full overflow-y-auto p-3">
							<StructurePanel />
						</div>
					</ResizablePanel>
				</ResizablePanelGroup>
			</div>
		</div>
	);
}
