/**
 * Output data models for ViMax pipeline.
 *
 * Ported from: vimax/interfaces/output.py
 */

export interface ImageOutput {
	image_path: string;
	image_url?: string;
	prompt: string;
	model: string;
	width: number;
	height: number;
	generation_time: number;
	cost: number;
	metadata: Record<string, unknown>;
}

export interface VideoOutput {
	video_path: string;
	video_url?: string;
	source_image?: string;
	prompt: string;
	model: string;
	duration: number;
	width: number;
	height: number;
	fps: number;
	generation_time: number;
	cost: number;
	metadata: Record<string, unknown>;
}

export interface PipelineOutput {
	pipeline_name: string;
	started_at: string;
	completed_at?: string;
	images: ImageOutput[];
	videos: VideoOutput[];
	final_video?: VideoOutput;
	total_cost: number;
	output_directory: string;
	config_path?: string;
	errors: string[];
}

// -- Factory helpers --

export function createImageOutput(
	partial: Partial<ImageOutput> & { image_path: string }
): ImageOutput {
	return {
		prompt: "",
		model: "",
		width: 0,
		height: 0,
		generation_time: 0,
		cost: 0,
		metadata: {},
		...partial,
	};
}

export function createVideoOutput(
	partial: Partial<VideoOutput> & { video_path: string }
): VideoOutput {
	return {
		prompt: "",
		model: "",
		duration: 0,
		width: 0,
		height: 0,
		fps: 24,
		generation_time: 0,
		cost: 0,
		metadata: {},
		...partial,
	};
}

export function createPipelineOutput(
	partial: Partial<PipelineOutput> & { pipeline_name: string }
): PipelineOutput {
	return {
		started_at: new Date().toISOString(),
		images: [],
		videos: [],
		total_cost: 0,
		output_directory: "",
		errors: [],
		...partial,
	};
}

// -- Computed helpers --

export function isPipelineSuccess(output: PipelineOutput): boolean {
	return output.errors.length === 0 && output.final_video != null;
}

export function getPipelineDuration(output: PipelineOutput): number | null {
	if (!output.completed_at) return null;
	return (
		(new Date(output.completed_at).getTime() -
			new Date(output.started_at).getTime()) /
		1000
	);
}

export function addImageToOutput(
	output: PipelineOutput,
	image: ImageOutput
): void {
	output.images.push(image);
	output.total_cost += image.cost;
}

export function addVideoToOutput(
	output: PipelineOutput,
	video: VideoOutput
): void {
	output.videos.push(video);
	output.total_cost += video.cost;
}
