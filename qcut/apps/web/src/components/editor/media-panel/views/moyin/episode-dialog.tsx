/**
 * EpisodeDialog — create/edit dialog for episodes.
 */

import { useState, useEffect } from "react";
import { useMoyinStore } from "@/stores/moyin/moyin-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from "@/components/ui/dialog";

export function EpisodeDialog({
	open,
	onOpenChange,
	episodeId,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	episodeId?: string;
}) {
	const episodes = useMoyinStore((s) => s.episodes);
	const addEpisode = useMoyinStore((s) => s.addEpisode);
	const updateEpisode = useMoyinStore((s) => s.updateEpisode);

	const existingEpisode = episodeId
		? episodes.find((ep) => ep.id === episodeId)
		: undefined;
	const isEditing = !!existingEpisode;

	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");

	useEffect(() => {
		if (open && existingEpisode) {
			setTitle(existingEpisode.title);
			setDescription(existingEpisode.description || "");
		} else if (open) {
			setTitle("");
			setDescription("");
		}
	}, [open, existingEpisode]);

	const handleSave = () => {
		if (!title.trim()) return;

		if (isEditing && episodeId) {
			updateEpisode(episodeId, { title: title.trim(), description });
		} else {
			addEpisode({
				id: `ep_${Date.now()}`,
				index: episodes.length,
				title: title.trim(),
				description,
				sceneIds: [],
			});
		}
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[400px]">
				<DialogHeader>
					<DialogTitle className="text-sm">
						{isEditing ? "Edit Episode" : "New Episode"}
					</DialogTitle>
				</DialogHeader>
				<div className="space-y-3 py-2">
					<div className="space-y-1">
						<Label className="text-xs">Title</Label>
						<Input
							className="h-8 text-sm"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="Episode title"
							autoFocus
						/>
					</div>
					<div className="space-y-1">
						<Label className="text-xs">Description</Label>
						<Textarea
							className="text-sm min-h-[60px] resize-none"
							rows={3}
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Brief description (optional)"
						/>
					</div>
				</div>
				<DialogFooter>
					<Button
						variant="outline"
						size="sm"
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button size="sm" onClick={handleSave} disabled={!title.trim()}>
						{isEditing ? "Save" : "Create"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
