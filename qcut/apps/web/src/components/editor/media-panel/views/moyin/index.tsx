/**
 * MoyinView — Root component for the Moyin script-to-storyboard workflow.
 *
 * Four-step workflow:
 * 1. Script — paste/type screenplay text and parse it
 * 2. Characters — review extracted characters
 * 3. Scenes — review extracted scenes
 * 4. Generate — trigger storyboard generation
 */

"use client";

import { useMoyinStore } from "@/stores/moyin-store";
import type { MoyinStep } from "@/stores/moyin-store";
import { ScriptInput } from "./script-input";
import { CharacterList } from "./character-list";
import { SceneList } from "./scene-list";
import { GenerateActions } from "./generate-actions";
import { StepIndicator } from "./step-indicator";

const STEP_COMPONENTS: Record<MoyinStep, React.FC> = {
	script: ScriptInput,
	characters: CharacterList,
	scenes: SceneList,
	generate: GenerateActions,
};

export function MoyinView() {
	const activeStep = useMoyinStore((s) => s.activeStep);
	const ActiveComponent = STEP_COMPONENTS[activeStep];

	return (
		<div className="flex h-full flex-col p-3 space-y-3">
			<StepIndicator />
			<div className="flex-1 min-h-0 overflow-y-auto">
				<ActiveComponent />
			</div>
		</div>
	);
}
