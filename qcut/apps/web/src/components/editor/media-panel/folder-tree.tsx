"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { useFolderStore } from "@/stores/folder-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { CreateFolderDialog } from "./create-folder-dialog";
import { FolderItem } from "./folder-item";

interface FolderTreeProps {
	onFolderSelect?: (folderId: string | null) => void;
}

/**
 * Source sidebar of the media library: a collapsible "Import" group that
 * holds the whole library, the project's folders and the create action.
 */
export function FolderTree({ onFolderSelect }: FolderTreeProps) {
	const { t } = useTranslation();
	const { selectedFolderId, setSelectedFolder, getChildFolders } =
		useFolderStore();
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [isImportGroupOpen, setIsImportGroupOpen] = useState(true);

	const rootFolders = getChildFolders(null);

	const handleSelect = (folderId: string | null) => {
		setSelectedFolder(folderId);
		onFolderSelect?.(folderId);
	};

	const GroupChevron = isImportGroupOpen ? ChevronUp : ChevronDown;

	return (
		<div className="flex h-full flex-col border-r border-border bg-panel-accent/30">
			<ScrollArea className="flex-1">
				<div className="p-2">
					<button
						type="button"
						className="flex w-full items-center justify-between rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/80"
						onClick={() => setIsImportGroupOpen((open) => !open)}
						aria-expanded={isImportGroupOpen}
						data-testid="media-source-group-import"
					>
						<span>{t("media.import")}</span>
						<GroupChevron className="size-3.5 text-muted-foreground" />
					</button>

					{isImportGroupOpen ? (
						<div
							className="mt-1 flex flex-col gap-0.5"
							role="group"
							aria-label={t("media.import")}
						>
							<button
								type="button"
								className={cn(
									"w-full rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
									selectedFolderId === null
										? "text-primary"
										: "text-foreground/85 hover:bg-accent/60"
								)}
								onClick={() => handleSelect(null)}
								aria-pressed={selectedFolderId === null}
								data-testid="media-source-all"
							>
								{t("media.library")}
							</button>

							{rootFolders.map((folder) => (
								<FolderItem
									key={folder.id}
									folder={folder}
									depth={0}
									onSelect={handleSelect}
								/>
							))}

							<button
								type="button"
								className="flex w-full items-center gap-1 rounded-md px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
								onClick={() => setIsCreateDialogOpen(true)}
								data-testid="media-create-folder"
							>
								<Plus className="size-3 shrink-0" />
								<span className="truncate">{t("media.createFolder")}</span>
							</button>
						</div>
					) : null}
				</div>
			</ScrollArea>

			<CreateFolderDialog
				open={isCreateDialogOpen}
				onOpenChange={setIsCreateDialogOpen}
			/>
		</div>
	);
}
