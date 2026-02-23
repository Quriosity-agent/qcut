/**
 * File operations sub-interface for ElectronAPI.
 */

export interface ElectronFileOps {
	openFileDialog: () => Promise<string | null>;

	openMultipleFilesDialog: () => Promise<string[]>;

	saveFileDialog: (
		defaultFilename?: string,
		filters?: Array<{ name: string; extensions: string[] }>
	) => Promise<{
		canceled: boolean;
		filePath?: string;
	}>;

	/** File path utility (Electron 37+ removed File.path on dropped files) */
	getPathForFile: (file: File) => string;

	readFile: (filePath: string) => Promise<Buffer | null>;
	writeFile: (
		filePath: string,
		data: Buffer | Uint8Array
	) => Promise<{ success: boolean }>;
	saveBlob: (
		data: Buffer | Uint8Array,
		defaultFilename?: string
	) => Promise<{
		success: boolean;
		filePath?: string;
		canceled?: boolean;
		error?: string;
	}>;
	getFileInfo: (filePath: string) => Promise<{
		size: number;
		created: Date;
		modified: Date;
		isFile: boolean;
		isDirectory: boolean;
	}>;
}
