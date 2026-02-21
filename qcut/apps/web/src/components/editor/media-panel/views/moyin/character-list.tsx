/**
 * CharacterList — step 2: review and edit extracted characters.
 */

import { useMoyinStore } from "@/stores/moyin-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeftIcon, ArrowRightIcon, UserIcon } from "lucide-react";

export function CharacterList() {
	const characters = useMoyinStore((s) => s.characters);
	const setActiveStep = useMoyinStore((s) => s.setActiveStep);

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<p className="text-xs text-muted-foreground">
					{characters.length} character{characters.length !== 1 ? "s" : ""}{" "}
					extracted
				</p>
			</div>

			{characters.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
					<UserIcon className="mb-2 h-8 w-8" />
					<p className="text-sm">No characters found</p>
					<p className="text-xs">Go back and try a different script</p>
				</div>
			) : (
				<div className="space-y-2">
					{characters.map((char) => (
						<Card key={char.id} className="border shadow-none">
							<CardHeader className="pb-1 pt-3 px-3">
								<CardTitle className="text-sm flex items-center gap-2">
									<UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
									{char.name}
									{char.gender && (
										<Badge variant="outline" className="text-[10px] px-1.5">
											{char.gender}
										</Badge>
									)}
									{char.age && (
										<Badge variant="outline" className="text-[10px] px-1.5">
											{char.age}
										</Badge>
									)}
								</CardTitle>
							</CardHeader>
							<CardContent className="px-3 pb-3 pt-1">
								{char.role && (
									<p className="text-xs text-muted-foreground line-clamp-2">
										{char.role}
									</p>
								)}
								{char.tags && char.tags.length > 0 && (
									<div className="mt-1.5 flex flex-wrap gap-1">
										{char.tags.map((tag) => (
											<Badge
												key={tag}
												variant="secondary"
												className="text-[10px] px-1"
											>
												{tag}
											</Badge>
										))}
									</div>
								)}
							</CardContent>
						</Card>
					))}
				</div>
			)}

			<div className="flex items-center gap-2 pt-1">
				<Button
					variant="outline"
					size="sm"
					onClick={() => setActiveStep("script")}
				>
					<ArrowLeftIcon className="mr-1 h-3.5 w-3.5" />
					Script
				</Button>
				<Button
					size="sm"
					className="flex-1"
					onClick={() => setActiveStep("scenes")}
				>
					Scenes
					<ArrowRightIcon className="ml-1 h-3.5 w-3.5" />
				</Button>
			</div>
		</div>
	);
}
