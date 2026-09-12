import type { MediaFolder } from "@/stores/media/media-store-types";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { MediaItemName } from "./media-item-card";
import { MEDIA_STRIP_HEIGHT } from "./media-strip-preview";

const FOLDER_BODY_COLOR = "#213a63";
const FOLDER_TAB_COLOR = "#2d4f85";

/**
 * A folder shown among the media tiles, like a file browser: a folder glyph
 * (tab plus body, tinted with the folder's colour) and the name below.
 * Clicking it opens the folder; the sidebar keeps rename, colour and delete.
 */
export function MediaFolderCard({
	folder,
	viewMode,
	onOpen,
}: {
	folder: MediaFolder;
	viewMode: "grid" | "list";
	onOpen: (folderId: string) => void;
}) {
	const { t } = useTranslation();
	const body = folder.color || FOLDER_BODY_COLOR;
	const tab = folder.color ? undefined : FOLDER_TAB_COLOR;
	return (
		<button
			type="button"
			className="group flex w-full flex-col gap-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
			onClick={(event) => {
				event.stopPropagation();
				onOpen(folder.id);
			}}
			aria-label={t("media.openFolder", { name: folder.name })}
			title={folder.name}
			data-testid="media-folder-card"
			data-folder-id={folder.id}
		>
			<div
				className={cn(
					"relative w-full overflow-hidden rounded-md",
					viewMode === "grid" && "aspect-video"
				)}
				style={
					viewMode === "list"
						? { height: `${MEDIA_STRIP_HEIGHT}px` }
						: undefined
				}
				aria-hidden="true"
			>
				<div
					className="absolute left-0 top-0 h-[26%] w-[38%] rounded-t-md"
					style={{
						backgroundColor: tab ?? body,
						filter: tab ? undefined : "brightness(1.25)",
					}}
				/>
				<div
					className="absolute inset-x-0 bottom-0 top-[18%] rounded-md transition-[filter] group-hover:brightness-110"
					style={{ backgroundColor: body }}
				/>
			</div>
			<MediaItemName name={folder.name} />
		</button>
	);
}
