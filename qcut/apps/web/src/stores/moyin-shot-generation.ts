/**
 * Per-shot image/video generation helpers for MoyinStore.
 * Extracted to keep moyin-store.ts under 800 lines.
 */

import type { ScriptCharacter, ScriptScene, Shot } from "@/types/moyin-script";
import { getFalApiKeyAsync } from "@/lib/ai-video/core/fal-request";
import { VISUAL_STYLE_PRESETS } from "@/lib/moyin/presets/visual-styles";

/** Build an image prompt from shot + context data. */
export function buildShotImagePrompt(
	shot: Shot,
	scene: ScriptScene | undefined,
	characters: ScriptCharacter[],
	selectedStyleId: string
): string {
	const charDescs = (shot.characterIds || [])
		.map((cid) => characters.find((c) => c.id === cid))
		.filter(Boolean)
		.map((c) => c!.visualPromptEn || c!.appearance || c!.name)
		.join(", ");

	const stylePreset = VISUAL_STYLE_PRESETS.find(
		(s) => s.id === selectedStyleId
	);
	const styleToken = stylePreset?.prompt || "";

	return [
		shot.imagePrompt || shot.visualPrompt || shot.actionSummary || "",
		charDescs && `Characters: ${charDescs}`,
		scene?.visualPrompt && `Scene: ${scene.visualPrompt}`,
		shot.shotSize && `Shot size: ${shot.shotSize}`,
		shot.cameraMovement && `Camera: ${shot.cameraMovement}`,
		styleToken,
	]
		.filter(Boolean)
		.join(". ");
}

/** Generate an image via fal.ai with configurable size. */
export async function generateFalImage(
	prompt: string,
	size: { width: number; height: number } = { width: 1920, height: 1080 }
): Promise<string> {
	const apiKey = await getFalApiKeyAsync();
	if (!apiKey) {
		throw new Error("FAL API key not configured. Please set it in Settings.");
	}

	const response = await fetch("https://fal.run/fal-ai/flux-pro/v1.1-ultra", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Key ${apiKey}`,
		},
		body: JSON.stringify({
			prompt,
			num_images: 1,
			image_size: size,
			safety_tolerance: "6",
		}),
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({}));
		const detail =
			(errorData as Record<string, unknown>).detail || response.statusText;
		throw new Error(`Image generation failed: ${detail}`);
	}

	const data = (await response.json()) as {
		images?: Array<{ url: string }>;
	};
	const imageUrl = data.images?.[0]?.url;
	if (!imageUrl) throw new Error("No image returned from API");
	return imageUrl;
}

/** Generate a single shot image (1920x1080). */
export async function generateShotImageRequest(
	prompt: string
): Promise<string> {
	return generateFalImage(prompt);
}

/** Generate a video from an existing shot image via fal.ai. */
export async function generateShotVideoRequest(
	imageUrl: string,
	prompt: string
): Promise<string> {
	const apiKey = await getFalApiKeyAsync();
	if (!apiKey) {
		throw new Error("FAL API key not configured. Please set it in Settings.");
	}

	const response = await fetch(
		"https://fal.run/fal-ai/wan/v2.1/image-to-video",
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Key ${apiKey}`,
			},
			body: JSON.stringify({
				image_url: imageUrl,
				prompt,
			}),
		}
	);

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({}));
		const detail =
			(errorData as Record<string, unknown>).detail || response.statusText;
		throw new Error(`Video generation failed: ${detail}`);
	}

	const data = (await response.json()) as { video?: { url: string } };
	const videoUrl = data.video?.url;
	if (!videoUrl) throw new Error("No video returned from API");
	return videoUrl;
}

/**
 * Persist a remote media URL to local Electron storage.
 * Falls back to the original URL if Electron is unavailable or save fails.
 */
export async function persistShotMedia(
	url: string,
	filename: string
): Promise<string> {
	try {
		const electronAPI = (window as unknown as Record<string, unknown>)
			.electronAPI as
			| {
					saveBlob?: (data: Uint8Array, filename: string) => Promise<string>;
			  }
			| undefined;
		if (!electronAPI?.saveBlob) return url;

		const response = await fetch(url);
		if (!response.ok) return url;

		const buffer = await response.arrayBuffer();
		const localPath = await electronAPI.saveBlob(
			new Uint8Array(buffer),
			filename
		);
		return localPath || url;
	} catch {
		// Persistence failed — keep remote URL
		return url;
	}
}

/** Check if an error is a content moderation rejection. */
export function isModerationError(error: unknown): boolean {
	const msg = error instanceof Error ? error.message : String(error ?? "");
	const patterns = [
		"content policy",
		"moderation",
		"nsfw",
		"safety",
		"banned",
		"restricted content",
		"inappropriate",
	];
	const lower = msg.toLowerCase();
	return patterns.some((p) => lower.includes(p));
}

/** Build a prompt for end frame image generation. */
export function buildEndFramePrompt(shot: Shot): string {
	return shot.endFramePrompt || shot.imagePrompt || shot.actionSummary || "";
}
