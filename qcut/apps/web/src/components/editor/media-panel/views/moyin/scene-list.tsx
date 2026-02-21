/**
 * SceneList — step 3: review extracted scenes before generation.
 */

import { useMoyinStore } from "@/stores/moyin-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeftIcon, ArrowRightIcon, MapPinIcon } from "lucide-react";

export function SceneList() {
	const scenes = useMoyinStore((s) => s.scenes);
	const setActiveStep = useMoyinStore((s) => s.setActiveStep);

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<p className="text-xs text-muted-foreground">
					{scenes.length} scene{scenes.length !== 1 ? "s" : ""} extracted
				</p>
			</div>

			{scenes.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
					<MapPinIcon className="mb-2 h-8 w-8" />
					<p className="text-sm">No scenes found</p>
					<p className="text-xs">Go back and try a different script</p>
				</div>
			) : (
				<div className="space-y-2">
					{scenes.map((scene, idx) => (
						<Card key={scene.id} className="border shadow-none">
							<CardHeader className="pb-1 pt-3 px-3">
								<CardTitle className="text-sm flex items-center gap-2">
									<span className="text-muted-foreground text-xs">
										#{idx + 1}
									</span>
									{scene.name || scene.location}
								</CardTitle>
							</CardHeader>
							<CardContent className="px-3 pb-3 pt-1 space-y-1">
								{scene.location && scene.name && (
									<p className="text-xs text-muted-foreground">
										{scene.location}
									</p>
								)}
								{scene.atmosphere && (
									<p className="text-xs text-muted-foreground line-clamp-2">
										{scene.atmosphere}
									</p>
								)}
								<div className="flex flex-wrap gap-1">
									{scene.time && (
										<Badge variant="outline" className="text-[10px] px-1.5">
											{scene.time}
										</Badge>
									)}
									{scene.tags?.map((tag) => (
										<Badge
											key={tag}
											variant="secondary"
											className="text-[10px] px-1"
										>
											{tag}
										</Badge>
									))}
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}

			<div className="flex items-center gap-2 pt-1">
				<Button
					variant="outline"
					size="sm"
					onClick={() => setActiveStep("characters")}
				>
					<ArrowLeftIcon className="mr-1 h-3.5 w-3.5" />
					Characters
				</Button>
				<Button
					size="sm"
					className="flex-1"
					onClick={() => setActiveStep("generate")}
					disabled={scenes.length === 0}
				>
					Generate
					<ArrowRightIcon className="ml-1 h-3.5 w-3.5" />
				</Button>
			</div>
		</div>
	);
}
