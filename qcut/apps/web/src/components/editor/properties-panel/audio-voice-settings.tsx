import type { AudioSettingsEditorBindings } from "./audio/audio-properties-types";
import { AudioVoiceConversionSettings } from "./audio/audio-ai-voice-settings";
import { AudioVoicePresetControls } from "./audio/audio-preset-controls";

export function AudioVoiceSettings({
	bindings,
}: {
	bindings: AudioSettingsEditorBindings;
}) {
	return (
		<div data-testid="audio-voice-settings">
			<AudioVoicePresetControls bindings={bindings} />
			<AudioVoiceConversionSettings bindings={bindings} />
		</div>
	);
}
