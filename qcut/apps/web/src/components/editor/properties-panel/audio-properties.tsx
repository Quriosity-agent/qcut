import { MediaElement } from "@/types/timeline";
import {
	PropertyGroup,
	PropertyItem,
	PropertyItemLabel,
	PropertyItemValue,
} from "./property-item";
import { VolumeControl } from "./volume-control";

export function AudioProperties({
	element,
	trackId,
}: {
	element: MediaElement;
	trackId: string;
}) {
	return (
		<div className="space-y-4 p-5">
			<VolumeControl element={element} trackId={trackId} />

			<PropertyGroup title="Audio Info" defaultExpanded={false}>
				<PropertyItem direction="column">
					<PropertyItemLabel>Element Name</PropertyItemLabel>
					<PropertyItemValue>
						<span className="text-xs">{element.name}</span>
					</PropertyItemValue>
				</PropertyItem>
				<PropertyItem direction="column">
					<PropertyItemLabel>Duration</PropertyItemLabel>
					<PropertyItemValue>
						<span className="text-xs">
							{(element.duration / 1000).toFixed(2)}s
						</span>
					</PropertyItemValue>
				</PropertyItem>
			</PropertyGroup>
		</div>
	);
}
