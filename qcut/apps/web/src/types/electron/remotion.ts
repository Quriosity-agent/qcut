/**
 * Remotion folder import types.
 */

export interface RemotionCompositionInfo {
	id: string;
	name: string;
	durationInFrames: number;
	fps: number;
	width: number;
	height: number;
	componentPath: string;
	importPath: string;
	line: number;
}

export interface RemotionFolderSelectResult {
	success: boolean;
	folderPath?: string;
	cancelled?: boolean;
	error?: string;
}

export interface RemotionFolderScanResult {
	isValid: boolean;
	rootFilePath: string | null;
	compositions: RemotionCompositionInfo[];
	errors: string[];
	folderPath: string;
}

export interface RemotionBundleResult {
	compositionId: string;
	success: boolean;
	code?: string;
	sourceMap?: string;
	error?: string;
}

export interface RemotionFolderBundleResult {
	success: boolean;
	results: RemotionBundleResult[];
	successCount: number;
	errorCount: number;
	folderPath: string;
}

export interface RemotionFolderImportResult {
	success: boolean;
	scan: RemotionFolderScanResult;
	bundle: RemotionFolderBundleResult | null;
	importTime: number;
	error?: string;
}
