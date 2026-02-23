/**
 * Project folder types.
 */

export type ProjectFolderFileInfo = {
	name: string;
	path: string;
	relativePath: string;
	type: "video" | "audio" | "image" | "unknown";
	size: number;
	modifiedAt: number;
	isDirectory: boolean;
};

export type ProjectFolderScanResult = {
	files: ProjectFolderFileInfo[];
	folders: string[];
	totalSize: number;
	scanTime: number;
};
