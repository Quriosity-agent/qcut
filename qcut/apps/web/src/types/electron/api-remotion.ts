/**
 * Remotion operations sub-interface for ElectronAPI.
 */

import type {
	RemotionFolderSelectResult,
	RemotionFolderScanResult,
	RemotionFolderBundleResult,
	RemotionFolderImportResult,
} from "./remotion";

export interface ElectronRemotionFolderOps {
	remotionFolder?: {
		select: () => Promise<RemotionFolderSelectResult>;
		scan: (folderPath: string) => Promise<RemotionFolderScanResult>;
		bundle: (
			folderPath: string,
			compositionIds?: string[]
		) => Promise<RemotionFolderBundleResult>;
		import: (folderPath: string) => Promise<RemotionFolderImportResult>;
		checkBundler: () => Promise<{ available: boolean }>;
		validate: (
			folderPath: string
		) => Promise<{ isValid: boolean; error?: string }>;
	};
}

export interface ElectronRemotionOps {
	remotion?: {
		preRender: (options: {
			elementId: string;
			componentId: string;
			props: Record<string, unknown>;
			outputDir: string;
			format: string;
			quality: number;
			width: number;
			height: number;
			fps: number;
			totalFrames: number;
			onProgress?: (frame: number) => void;
		}) => Promise<{
			success: boolean;
			frames: Record<string, string>;
			error?: string;
		}>;
		cleanup: (sessionId: string) => Promise<void>;
	};
}
