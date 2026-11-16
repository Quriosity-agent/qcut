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
	/**
	 * When the asker stops waiting (epoch milliseconds) and puts the file
	 * back: the editor takes the rename back rather than finish after it.
	 */
	deadlineAt?: number;
}

export interface ClaudeMediaRendererResponse {
	error?: string;
	requestId: string;
}

/**
 * Asks the editor to read again every media file of the project that was
 * written over in the project folder since the editor copied it.
 */
export interface ClaudeMediaRefreshEvent {
	projectId: string;
	requestId?: string;
	/**
	 * How long the asker waits for the answer, when shorter than the usual
	 * wait (an export start does not hold on for minutes). The refresh itself
	 * runs to its end either way: finishing late does no harm.
	 */
	timeoutMs?: number;
}

/** What `POST /api/claude/media/:projectId/refresh` found and did. */
export interface ClaudeMediaRefreshResult {
	/** Media items with a file in the project folder that were compared. */
	checked: number;
	/** Items whose file had changed; the editor now holds the new file. */
	refreshed: Array<{ id: string; name: string }>;
	/** Items whose changed file could not be read; they keep the old copy. */
	failed: Array<{ id: string; name: string; error: string }>;
}
