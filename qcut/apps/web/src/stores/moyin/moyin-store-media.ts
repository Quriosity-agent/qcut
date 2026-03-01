/**
 * Moyin Store — Media Generation Actions
 * Shot image, video, and end-frame generation actions.
 * Extracted from moyin-store.ts to keep files under 800 lines.
 */

import type { Shot } from "@/types/moyin-script";
import {
	buildShotImagePrompt,
	buildEndFramePrompt,
	generateFalImage,
	generateShotImageRequest,
	generateShotVideoRequest,
	persistShotMedia,
} from "./moyin-shot-generation";

type SetFn = (
	partial:
		| Partial<{ shots: Shot[]; shotGenerationStatus: Record<string, string> }>
		| ((state: {
				shots: Shot[];
				shotGenerationStatus: Record<string, string>;
		  }) => Partial<{
				shots: Shot[];
				shotGenerationStatus: Record<string, string>;
		  }>)
) => void;
type GetFn = () => {
	shots: Shot[];
	characters: import("@/types/moyin-script").ScriptCharacter[];
	scenes: import("@/types/moyin-script").ScriptScene[];
	selectedStyleId: string;
};
type PatchShotFn = (shotId: string, updates: Partial<Shot>) => void;

export function createMediaActions(
	set: SetFn,
	get: GetFn,
	patchShot: PatchShotFn
) {
	return {
		generateShotImage: async (shotId: string) => {
			const { shots, characters, scenes, selectedStyleId } = get();
			const shot = shots.find((s) => s.id === shotId);
			if (!shot) return;
			patchShot(shotId, {
				imageStatus: "generating",
				imageProgress: 0,
				imageError: undefined,
			});
			try {
				const scene = scenes.find((s) => s.id === shot.sceneRefId);
				const prompt = buildShotImagePrompt(
					shot,
					scene,
					characters,
					selectedStyleId
				);
				patchShot(shotId, { imageProgress: 30 });
				const remoteImageUrl = await generateShotImageRequest(prompt);
				const imageUrl = await persistShotMedia(
					remoteImageUrl,
					`shot-${shotId}-image.png`
				);
				patchShot(shotId, {
					imageStatus: "completed",
					imageProgress: 100,
					imageUrl,
				});
			} catch (error) {
				patchShot(shotId, {
					imageStatus: "failed",
					imageError:
						error instanceof Error ? error.message : "Image generation failed",
				});
			}
		},
		generateShotVideo: async (shotId: string) => {
			const { shots } = get();
			const shot = shots.find((s) => s.id === shotId);
			if (!shot) return;
			patchShot(shotId, {
				videoStatus: "generating",
				videoProgress: 0,
				videoError: undefined,
			});
			try {
				if (!shot.imageUrl)
					throw new Error("Generate an image first before creating video.");
				const prompt = shot.videoPrompt || shot.actionSummary || "";
				patchShot(shotId, { videoProgress: 20 });
				const remoteVideoUrl = await generateShotVideoRequest(
					shot.imageUrl,
					prompt
				);
				const videoUrl = await persistShotMedia(
					remoteVideoUrl,
					`shot-${shotId}-video.mp4`
				);
				patchShot(shotId, {
					videoStatus: "completed",
					videoProgress: 100,
					videoUrl,
				});
			} catch (error) {
				patchShot(shotId, {
					videoStatus: "failed",
					videoError:
						error instanceof Error ? error.message : "Video generation failed",
				});
			}
		},
		generateEndFrameImage: async (shotId: string) => {
			const { shots } = get();
			const shot = shots.find((s) => s.id === shotId);
			if (!shot) return;
			patchShot(shotId, {
				endFrameImageStatus: "generating",
				endFrameImageError: undefined,
			});
			try {
				const prompt = buildEndFramePrompt(shot);
				if (!prompt) throw new Error("No end frame prompt available.");
				const remoteUrl = await generateFalImage(prompt);
				const endFrameImageUrl = await persistShotMedia(
					remoteUrl,
					`shot-${shotId}-endframe.png`
				);
				patchShot(shotId, {
					endFrameImageStatus: "completed",
					endFrameImageUrl,
					endFrameSource: "ai-generated",
				});
			} catch (error) {
				patchShot(shotId, {
					endFrameImageStatus: "failed",
					endFrameImageError:
						error instanceof Error
							? error.message
							: "End frame generation failed",
				});
			}
		},
	};
}
