/**
 * Media import types.
 */

export interface MediaImportOptions {
	sourcePath: string;
	projectId: string;
	mediaId: string;
	preferSymlink?: boolean;
}

export interface MediaImportResult {
	success: boolean;
	targetPath: string;
	importMethod: "symlink" | "copy";
	originalPath: string;
	fileSize: number;
	error?: string;
}

export interface MediaImportMetadata {
	importMethod: "symlink" | "copy";
	originalPath: string;
	importedAt: number;
	fileSize: number;
}
