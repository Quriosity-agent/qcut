/**
 * Skills operations sub-interface for ElectronAPI.
 */

export interface ElectronSkillsOps {
	skills?: {
		list: (projectId: string) => Promise<
			Array<{
				id: string;
				name: string;
				description: string;
				dependencies?: string;
				folderName: string;
				mainFile: string;
				additionalFiles: string[];
				content: string;
				createdAt: number;
				updatedAt: number;
			}>
		>;
		import: (
			projectId: string,
			sourcePath: string
		) => Promise<{
			id: string;
			name: string;
			description: string;
			dependencies?: string;
			folderName: string;
			mainFile: string;
			additionalFiles: string[];
			content: string;
			createdAt: number;
			updatedAt: number;
		} | null>;
		delete: (projectId: string, skillId: string) => Promise<void>;
		getContent: (
			projectId: string,
			skillId: string,
			filename: string
		) => Promise<string>;
		browse: () => Promise<string | null>;
		getPath: (projectId: string) => Promise<string>;
		scanGlobal: () => Promise<
			Array<{
				path: string;
				name: string;
				description: string;
				bundled?: boolean;
			}>
		>;
		syncForClaude: (projectId: string) => Promise<{
			synced: boolean;
			copied: number;
			skipped: number;
			removed: number;
			warnings: string[];
			error?: string;
		}>;
	};
}
