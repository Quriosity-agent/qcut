/**
 * ShotBreakdown — visual shot list grouped by scene with sticky headers.
 * Compact layout for scanning many shots at a glance.
 */

import { useCallback, useMemo } from "react";
import { useMoyinStore } from "@/stores/moyin-store";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
	CameraIcon,
	FileTextIcon,
	MapPinIcon,
	MessageSquareIcon,
	PlusIcon,
	UserIcon,
} from "lucide-react";

function ShotStatusDot({ status }: { status: string }) {
	return (
		<span
			className={cn(
				"inline-block h-1.5 w-1.5 rounded-full shrink-0",
				status === "completed"
					? "bg-green-500"
					: status === "generating"
						? "bg-yellow-500 animate-pulse"
						: status === "failed"
							? "bg-red-500"
							: "bg-muted-foreground/30"
			)}
		/>
	);
}

export function ShotBreakdown() {
	const scenes = useMoyinStore((s) => s.scenes);
	const shots = useMoyinStore((s) => s.shots);
	const addShot = useMoyinStore((s) => s.addShot);
	const selectedItemId = useMoyinStore((s) => s.selectedItemId);
	const setSelectedItem = useMoyinStore((s) => s.setSelectedItem);

	const handleAddShot = useCallback(
		(sceneId: string) => {
			const sceneShots = shots.filter((s) => s.sceneRefId === sceneId);
			const newShot = {
				id: `shot_${Date.now()}`,
				index: shots.length,
				sceneRefId: sceneId,
				actionSummary: `Shot ${sceneShots.length + 1}`,
				characterIds: [],
				characterVariations: {},
				imageStatus: "idle" as const,
				imageProgress: 0,
				videoStatus: "idle" as const,
				videoProgress: 0,
			};
			addShot(newShot);
			setSelectedItem(newShot.id, "shot");
		},
		[shots, addShot, setSelectedItem]
	);

	const shotsByScene = useMemo(() => {
		const map: Record<string, typeof shots> = {};
		for (const shot of shots) {
			if (!map[shot.sceneRefId]) map[shot.sceneRefId] = [];
			map[shot.sceneRefId].push(shot);
		}
		return map;
	}, [shots]);

	// Only show scenes that have shots
	const scenesWithShots = useMemo(
		() => scenes.filter((s) => (shotsByScene[s.id]?.length ?? 0) > 0),
		[scenes, shotsByScene]
	);

	if (shots.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
				<FileTextIcon className="mb-3 h-10 w-10 opacity-40" />
				<p className="text-sm font-medium">No Shots Generated</p>
				<p className="text-xs mt-1 max-w-[200px]">
					Generate shots from the Structure tab to see the breakdown here.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-0">
			{scenesWithShots.map((scene) => {
				const sceneShots = shotsByScene[scene.id] || [];
				return (
					<div key={scene.id}>
						{/* Sticky scene header */}
						<div className="sticky top-0 z-10 flex items-center gap-1.5 bg-background border-b px-1.5 py-1.5">
							<MapPinIcon className="h-3 w-3 text-muted-foreground shrink-0" />
							<span className="text-[10px] font-medium truncate flex-1">
								{scene.name || scene.location}
							</span>
							<button
								type="button"
								onClick={() => handleAddShot(scene.id)}
								className="p-0.5 rounded hover:bg-muted transition-colors"
								aria-label={`Add shot to ${scene.name || scene.location}`}
							>
								<PlusIcon className="h-3 w-3 text-muted-foreground" />
							</button>
							<Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
								{sceneShots.length}
							</Badge>
						</div>

						{/* Shot rows */}
						{sceneShots.map((shot) => (
							<button
								key={shot.id}
								type="button"
								onClick={() => setSelectedItem(shot.id, "shot")}
								className={cn(
									"flex items-center gap-1.5 w-full px-1.5 py-1 text-left transition-colors",
									selectedItemId === shot.id
										? "bg-primary/10 text-primary"
										: "hover:bg-muted"
								)}
							>
								{/* Index */}
								<span className="text-[9px] font-mono text-muted-foreground w-5 shrink-0 text-right">
									{String(shot.index + 1).padStart(2, "0")}
								</span>

								{/* Shot size badge */}
								{shot.shotSize && (
									<Badge
										variant="outline"
										className="text-[8px] px-1 py-0 h-3.5 font-mono shrink-0"
									>
										{shot.shotSize}
									</Badge>
								)}

								{/* Camera movement */}
								{shot.cameraMovement && (
									<CameraIcon className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
								)}

								{/* Action summary */}
								<span className="text-[10px] truncate flex-1 min-w-0">
									{shot.actionSummary || "—"}
								</span>

								{/* Dialogue indicator */}
								{shot.dialogue && (
									<MessageSquareIcon className="h-2.5 w-2.5 shrink-0 text-blue-500" />
								)}

								{/* Character count */}
								{shot.characterNames && shot.characterNames.length > 0 && (
									<span className="flex items-center gap-0.5 shrink-0">
										<UserIcon className="h-2.5 w-2.5 text-muted-foreground" />
										<span className="text-[9px] text-muted-foreground">
											{shot.characterNames.length}
										</span>
									</span>
								)}

								{/* Status dots */}
								<span className="flex items-center gap-0.5 shrink-0">
									<ShotStatusDot status={shot.imageStatus} />
									<ShotStatusDot status={shot.videoStatus} />
								</span>
							</button>
						))}
					</div>
				);
			})}
		</div>
	);
}
