/**
 * Sound/Freesound operations sub-interface for ElectronAPI.
 */

export interface ElectronSoundOps {
	sounds: {
		search: (params: {
			q?: string;
			type?: "effects" | "songs";
			page?: number;
			page_size?: number;
			sort?: "downloads" | "rating" | "created" | "score";
			min_rating?: number;
			commercial_only?: boolean;
		}) => Promise<{
			success: boolean;
			count?: number;
			next?: string | null;
			previous?: string | null;
			results?: Array<{
				id: number;
				name: string;
				description: string;
				url: string;
				previewUrl?: string;
				downloadUrl?: string;
				duration: number;
				filesize: number;
				type: string;
				channels: number;
				bitrate: number;
				bitdepth: number;
				samplerate: number;
				username: string;
				tags: string[];
				license: string;
				created: string;
				downloads: number;
				rating: number;
				ratingCount: number;
			}>;
			query?: string;
			type?: string;
			page?: number;
			pageSize?: number;
			sort?: string;
			minRating?: number;
			error?: string;
			message?: string;
		}>;
		downloadPreview: (params: { url: string; id: number }) => Promise<{
			success: boolean;
			localPath?: string;
			error?: string;
		}>;
	};
}
