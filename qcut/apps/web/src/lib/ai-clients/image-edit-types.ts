/**
 * Shared types for image edit modules.
 * Extracted to break circular dependency between image-edit-client and image-edit-polling.
 */

export interface ImageEditResponse {
	job_id: string;
	status: "processing" | "completed" | "failed";
	message: string;
	result_url?: string;
	seed_used?: number;
	processing_time?: number;
}

export type ImageEditProgressCallback = (status: {
	status: "queued" | "processing" | "completed" | "failed";
	progress?: number;
	message?: string;
	elapsedTime?: number;
	estimatedTime?: number;
}) => void;
