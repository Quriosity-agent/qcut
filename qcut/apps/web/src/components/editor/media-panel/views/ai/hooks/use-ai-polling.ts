import { getGenerationStatus } from "@/lib/ai-video-client";
import { debugLogger } from "@/lib/debug-logger";
import type { MediaStore } from "@/stores/media-store-types";
import {
	PROGRESS_CONSTANTS,
	STATUS_MESSAGES,
	UI_CONSTANTS,
	ERROR_MESSAGES,
} from "../constants/ai-constants";
import type { GeneratedVideo } from "../types/ai-types";

export interface PollingCallbacks {
	setGenerationProgress: (
		progress: number | ((previous: number) => number)
	) => void;
	setStatusMessage: (message: string) => void;
	setGeneratedVideo: (video: GeneratedVideo | null) => void;
	setIsGenerating: (isGenerating: boolean) => void;
	setPollingInterval: (
		interval:
			| NodeJS.Timeout
			| null
			| ((current: NodeJS.Timeout | null) => NodeJS.Timeout | null)
	) => void;
	onError?: (error: string) => void;
}

export interface PollingContext {
	prompt: string;
	selectedModels: string[];
	activeProject: { id: string } | null;
	addMediaItem: MediaStore["addMediaItem"] | undefined;
}

interface CreateStatusPollerOptions {
	callbacks: PollingCallbacks;
	context: PollingContext;
}

function clearPollingInterval({
	callbacks,
}: {
	callbacks: PollingCallbacks;
}): void {
	callbacks.setPollingInterval((current) => {
		if (current) {
			clearInterval(current);
		}
		return null;
	});
}

export function createStatusPoller({
	callbacks,
	context,
}: CreateStatusPollerOptions) {
	return async function startStatusPolling(jobId: string): Promise<void> {
		let hasResolved = false;

		const resolveOnce = ({ resolve }: { resolve: () => void }) => {
			if (!hasResolved) {
				hasResolved = true;
				resolve();
			}
		};

		clearPollingInterval({ callbacks });
		callbacks.setGenerationProgress(PROGRESS_CONSTANTS.POLLING_START_PROGRESS);
		callbacks.setStatusMessage(STATUS_MESSAGES.STARTING);

		return new Promise<void>((resolve) => {
			const pollStatus = async () => {
				try {
					const status = await getGenerationStatus(jobId);

					if (status.progress) {
						callbacks.setGenerationProgress(status.progress);
					}

					if (status.status === "processing") {
						callbacks.setStatusMessage(
							`${STATUS_MESSAGES.PROCESSING} ${status.progress || 0}%`
						);
						return;
					}

					if (
						status.status === "completed" &&
						(status.videoUrl ?? status.video_url)
					) {
						clearPollingInterval({ callbacks });
						callbacks.setGenerationProgress(
							PROGRESS_CONSTANTS.COMPLETE_PROGRESS
						);
						callbacks.setStatusMessage(STATUS_MESSAGES.COMPLETE);

						const newVideo: GeneratedVideo = {
							jobId,
							videoUrl: status.videoUrl ?? status.video_url ?? "",
							videoPath: undefined,
							fileSize: undefined,
							duration: undefined,
							prompt: context.prompt.trim(),
							model: context.selectedModels[0] || "unknown",
						};

						callbacks.setGeneratedVideo(newVideo);

						if (context.activeProject) {
							try {
								console.log(
									"[AI Generation] Downloading generated video for media store...",
									{
										projectId: context.activeProject.id,
										modelId: context.selectedModels[0] || "unknown",
										videoUrl: newVideo.videoUrl,
									}
								);

								const response = await fetch(newVideo.videoUrl);
								const blob = await response.blob();
								const file = new File(
									[blob],
									`generated-video-${newVideo.jobId.substring(0, 8)}.mp4`,
									{ type: "video/mp4" }
								);

								if (!context.addMediaItem) {
									throw new Error("Media store not ready");
								}

								console.log("[AI Generation] Adding video to media store...", {
									projectId: context.activeProject.id,
									name: `AI: ${newVideo.prompt.substring(0, 30)}...`,
									duration: newVideo.duration || 5,
									width: 1920,
									height: 1080,
									fileSize: file.size,
								});

								const newItemId = await context.addMediaItem(
									context.activeProject.id,
									{
										name: `AI: ${newVideo.prompt.substring(0, 30)}...`,
										type: "video",
										file,
										url: newVideo.videoUrl,
										duration: newVideo.duration || 5,
										width: 1920,
										height: 1080,
									}
								);

								console.log("[AI Generation] addMediaItem succeeded", {
									mediaItemId: newItemId,
									projectId: context.activeProject.id,
								});

								debugLogger.log(
									"AIGeneration",
									`Added AI video to media with ID: ${newItemId}`
								);

								debugLogger.log("AIGeneration", "VIDEO_ADDED_TO_MEDIA_STORE", {
									videoUrl: newVideo.videoUrl,
									projectId: context.activeProject.id,
								});
							} catch (error) {
								console.error("[AI Generation] addMediaItem failed", {
									projectId: context.activeProject?.id,
									modelId: context.selectedModels[0] || "unknown",
									videoUrl: newVideo.videoUrl,
									error: error instanceof Error ? error.message : String(error),
								});

								debugLogger.log(
									"AIGeneration",
									"VIDEO_ADD_TO_MEDIA_STORE_FAILED",
									{
										error:
											error instanceof Error ? error.message : "Unknown error",
										projectId: context.activeProject.id,
									}
								);
							}
						}

						callbacks.setIsGenerating(false);
						resolveOnce({ resolve });
						return;
					}

					if (status.status === "failed") {
						clearPollingInterval({ callbacks });
						const errorMessage =
							status.error || ERROR_MESSAGES.GENERATION_FAILED;
						callbacks.onError?.(errorMessage);
						callbacks.setIsGenerating(false);
						resolveOnce({ resolve });
					}
				} catch (error) {
					debugLogger.log("AIGeneration", "STATUS_POLLING_ERROR", {
						error: error instanceof Error ? error.message : "Unknown error",
						jobId,
					});
					callbacks.setGenerationProgress((previous) =>
						Math.min(previous + 5, 90)
					);
				}
			};

			pollStatus();
			const interval = setInterval(() => {
				pollStatus();
			}, UI_CONSTANTS.POLLING_INTERVAL_MS);
			callbacks.setPollingInterval(interval);
		});
	};
}

export function useAIPolling({
	callbacks,
	context,
}: CreateStatusPollerOptions) {
	return createStatusPoller({ callbacks, context });
}
