export interface ClaudeMediaImportedEvent {
	id: string;
	metadata?: unknown;
	name: string;
	path: string;
	projectId: string;
	requestId?: string;
	size: number;
	type: "video" | "audio" | "image";
}

export interface ClaudeMediaDeletedEvent {
	mediaId: string;
	projectId: string;
	requestId?: string;
}

/**
 * A media file was renamed in the project folder. Its id follows the file
 * name, so the editor re-keys the item and points every clip at the new id.
 */
export interface ClaudeMediaRenamedEvent {
	/** The id the item and its clips had before the rename. */
	mediaId: string;
	newMediaId: string;
	newName: string;
	newPath: string;
	projectId: string;
	requestId?: string;
}

export interface ClaudeMediaRendererResponse {
	error?: string;
	requestId: string;
}
