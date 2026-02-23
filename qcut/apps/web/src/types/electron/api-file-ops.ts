/**
 * File operations sub-interface for ElectronAPI.
 */

export interface ElectronFileOps {
	openFileDialog: () => Promise<string | null>;

	openMultipleFilesDialog: () => Promise<string[]>;

	saveFileDialog: (
		defaultFilename?: string,
		filters?: Array<{ name: string; extensions: string[] }>
	) => Promise<string | null>;

	/** File path utility (Electron 37+ removed File.path on dropped files) */
	getPathForFile: (file: File) => string;

	readFile: (filePath: string) => Promise<Buffer | null>;
	writeFile: (
		filePath: string,
		data: Buffer | string
	) => Promise<boolean>;
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
		name: string;
		path: string;
		size: number;
		lastModified: Date;
		type: string;
	} | null>;
}
