"use client";

import { Wand2Icon } from "lucide-react";
import { AudioPanel } from "./video-edit-audio";

export default function VideoEditView() {
	return (
		<div className="h-full flex flex-col p-4">
			{/* Header */}
			<div className="flex items-center mb-4">
				<Wand2Icon className="size-5 text-primary mr-2" />
				<h3 className="text-sm font-medium">Audio Studio</h3>
			</div>

			<AudioPanel />
		</div>
	);
}
