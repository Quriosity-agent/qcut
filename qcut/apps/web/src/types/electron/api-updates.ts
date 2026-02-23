/**
 * Auto-update and release notes sub-interface for ElectronAPI.
 */

import type { ReleaseNote } from "./release-notes";

export interface ElectronUpdateOps {
	updates?: {
		checkForUpdates: () => Promise<{
			available: boolean;
			version?: string;
			message?: string;
			error?: string;
		}>;
		installUpdate: () => Promise<{
			success: boolean;
			message?: string;
			error?: string;
		}>;
		getReleaseNotes: (version?: string) => Promise<ReleaseNote | null>;
		getChangelog: () => Promise<ReleaseNote[]>;
		onUpdateAvailable: (
			callback: (data: {
				version: string;
				releaseNotes?: string;
				releaseDate?: string;
			}) => void
		) => () => void;
		onDownloadProgress: (
			callback: (data: {
				percent: number;
				transferred: number;
				total: number;
			}) => void
		) => () => void;
		onUpdateDownloaded: (
			callback: (data: { version: string }) => void
		) => () => void;
	};
}
