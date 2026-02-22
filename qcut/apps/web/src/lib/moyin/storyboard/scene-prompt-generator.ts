/**
 * Scene Prompt Generator
 *
 * Generates three-tier prompts for split scenes:
 * 1. Image Prompt - Static description for first frame
 * 2. End Frame Prompt - Static description for end frame (if needed)
 * 3. Video Prompt - Dynamic action description for video generation
 *
 * Strategy:
 * - If scene has text descriptions, generate from text (no API call)
 * - Fall back to Vision API only when scene has NO text descriptions
 *
 * Ported from moyin-creator.
 */

// ==================== Types ====================

/** Minimal scene shape for prompt generation (avoids coupling to store) */
export interface SplitSceneInput {
	id: number;
	row: number;
	col: number;
	actionSummary?: string;
	cameraMovement?: string;
	dialogue?: string;
	sceneName?: string;
	sceneDescription?: string;
}

export interface ScenePromptRequest {
	storyboardImage: string;
	storyPrompt: string;
	scenes: SplitSceneInput[];
	apiKey: string;
	provider?: string;
	baseUrl?: string;
	model?: string;
}

export interface GeneratedPrompt {
	id: number;
	// First frame (static)
	imagePrompt: string;
	imagePromptZh: string;
	// End frame (static)
	needsEndFrame: boolean;
	endFramePrompt: string;
	endFramePromptZh: string;
	endFrameReason?: string;
	// Video action (dynamic)
	videoPrompt: string;
	videoPromptZh: string;
	// Legacy compatibility
	prompt: string;
	promptZh: string;
	action?: string;
	camera?: string;
}

// ==================== Helpers ====================

function sceneHasTextDescription(scene: SplitSceneInput): boolean {
	const hasAction = !!(
		scene.actionSummary && scene.actionSummary.trim().length > 5
	);
	const hasSceneDesc = !!(
		scene.sceneDescription && scene.sceneDescription.trim().length > 5
	);
	return hasAction || hasSceneDesc;
}

function inferNeedsEndFrame(scene: SplitSceneInput): {
	needs: boolean;
	reason?: string;
} {
	const action = (scene.actionSummary || "").toLowerCase();
	const camera = (scene.cameraMovement || "").toLowerCase();

	const movementKeywords = [
		"走",
		"跑",
		"冲",
		"离开",
		"进入",
		"走进",
		"走出",
		"冲向",
		"奔向",
		"walk",
		"run",
		"enter",
		"exit",
		"move",
		"rush",
	];
	const transformKeywords = [
		"变",
		"转变",
		"蜕变",
		"化为",
		"transform",
		"change",
	];
	const cameraKeywords = [
		"360",
		"环绕",
		"推进",
		"拉远",
		"航拍",
		"穿梭",
		"变焦",
		"摇臂",
		"升降",
		"左移",
		"右移",
		"左摇",
		"右摇",
		"上仰",
		"下俯",
		"dolly",
		"pan",
		"tilt",
		"rotate",
		"orbit",
		"zoom",
		"truck",
		"crane",
		"drone",
		"fpv",
		"tracking",
	];

	for (const kw of movementKeywords) {
		if (action.includes(kw)) {
			return { needs: true, reason: `位置移动: ${kw}` };
		}
	}
	for (const kw of transformKeywords) {
		if (action.includes(kw)) {
			return { needs: true, reason: `状态变化: ${kw}` };
		}
	}
	for (const kw of cameraKeywords) {
		if (camera.includes(kw)) {
			return { needs: true, reason: `镜头运动: ${kw}` };
		}
	}

	return { needs: false };
}

function generatePromptFromText(
	scene: SplitSceneInput,
	_storyContext: string
): GeneratedPrompt {
	const action = scene.actionSummary || "";
	const camera = scene.cameraMovement || "";
	const dialogue = scene.dialogue || "";
	const sceneDesc = scene.sceneDescription || "";
	const sceneName = scene.sceneName || `场景 ${scene.id}`;

	const imagePromptParts: string[] = [];
	if (sceneDesc) imagePromptParts.push(sceneDesc);
	if (action) imagePromptParts.push(action);
	const imagePromptZh = imagePromptParts.join("。") || `${sceneName} 的画面`;

	const videoPromptParts: string[] = [];
	if (action) videoPromptParts.push(action);
	if (camera) videoPromptParts.push(`镜头: ${camera}`);
	if (dialogue) videoPromptParts.push(`对白: "${dialogue.substring(0, 50)}"`);
	const videoPromptZh =
		videoPromptParts.join("。") || `${sceneName} 的动态画面`;

	const endFrameInfo = inferNeedsEndFrame(scene);
	let endFramePromptZh = "";
	if (endFrameInfo.needs && action) {
		endFramePromptZh = `${action} 之后的画面`;
	}

	return {
		id: scene.id,
		imagePrompt: imagePromptZh,
		imagePromptZh,
		needsEndFrame: endFrameInfo.needs,
		endFramePrompt: endFramePromptZh,
		endFramePromptZh,
		endFrameReason: endFrameInfo.reason,
		videoPrompt: videoPromptZh,
		videoPromptZh,
		prompt: videoPromptZh,
		promptZh: videoPromptZh,
		action: action || undefined,
		camera: camera || undefined,
	};
}

function createPlaceholderPrompt(sceneId: number): GeneratedPrompt {
	return {
		id: sceneId,
		imagePrompt: `场景 ${sceneId}`,
		imagePromptZh: `场景 ${sceneId}`,
		needsEndFrame: false,
		endFramePrompt: "",
		endFramePromptZh: "",
		videoPrompt: `场景 ${sceneId} 的动态画面`,
		videoPromptZh: `场景 ${sceneId} 的动态画面`,
		prompt: `场景 ${sceneId} 的动态画面`,
		promptZh: `场景 ${sceneId} 的动态画面`,
	};
}

// ==================== Vision API ====================

const VISION_SYSTEM_PROMPT_TEMPLATE = (sceneList: string) => `
# Role
You are a world-class cinematographer specializing in AI-assisted filmmaking.

You understand the THREE-TIER PROMPT SYSTEM:
1. **First Frame Prompt**: STATIC description for the starting image
2. **End Frame Prompt**: STATIC description for the ending image (only if needed)
3. **Video Prompt**: DYNAMIC description for the motion/action between frames

# When Does a Scene NEED an End Frame?
Set "needsEndFrame": true if:
- Large position change (walk in/out, transformation)
- Major camera movement (360° rotation, dolly, pan)
- Scene transition or stylized video

Set "needsEndFrame": false if:
- Simple dialogue, subtle motion, static camera

# Frames to Analyze
${sceneList}

# Output Format
Return RAW JSON array (no markdown). BILINGUAL output required.
[
  {
    "id": 1,
    "imagePrompt": "English static first frame...",
    "imagePromptZh": "中文首帧描述...",
    "needsEndFrame": true,
    "endFramePrompt": "English end frame...",
    "endFramePromptZh": "中文尾帧描述...",
    "endFrameReason": "position change",
    "videoPrompt": "English action...",
    "videoPromptZh": "中文动作描述..."
  }
]`;

async function generatePromptsViaVisionAPI(
	storyboardImage: string,
	storyPrompt: string,
	scenes: SplitSceneInput[],
	apiKey: string,
	_provider: string,
	baseUrl: string,
	model: string
): Promise<GeneratedPrompt[]> {
	const buildEndpoint = (root: string, path: string) => {
		const normalized = root.replace(/\/+$/, "");
		return /\/v\d+$/.test(normalized)
			? `${normalized}/${path}`
			: `${normalized}/v1/${path}`;
	};

	const sceneList = scenes
		.map((s) => {
			let desc = `- Frame #${s.id}: Position Row ${s.row}, Column ${s.col}`;
			if (s.actionSummary) desc += `\n  Action hint: ${s.actionSummary}`;
			if (s.cameraMovement) desc += `\n  Camera hint: ${s.cameraMovement}`;
			if (s.dialogue)
				desc += `\n  Dialogue: "${s.dialogue.substring(0, 50)}..."`;
			return desc;
		})
		.join("\n");

	const systemPrompt = VISION_SYSTEM_PROMPT_TEMPLATE(sceneList);
	const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

	const response = await fetch(
		buildEndpoint(normalizedBaseUrl, "chat/completions"),
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model,
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: systemPrompt },
							{
								type: "image_url",
								image_url: { url: storyboardImage },
							},
						],
					},
				],
				stream: false,
				response_format: { type: "json_object" },
			}),
		}
	);

	if (!response.ok) {
		const errorText = await response.text();
		if (response.status === 401 || response.status === 403) {
			throw new Error("API Key 无效或已过期");
		}
		let errorMessage = `API request failed: ${response.status}`;
		try {
			const errorJson = JSON.parse(errorText);
			errorMessage =
				errorJson.error?.message || errorJson.message || errorMessage;
		} catch {
			if (errorText && errorText.length < 200) {
				errorMessage = errorText;
			}
		}
		throw new Error(errorMessage);
	}

	const data = await response.json();
	const content = data.choices?.[0]?.message?.content || data.content || "";
	const cleanContent = content.replace(/```json\n?|\n?```/g, "").trim();

	let parsed: Record<string, unknown>[];
	try {
		parsed = JSON.parse(cleanContent);
	} catch {
		throw new Error("AI 响应不是有效的 JSON 格式");
	}

	if (!Array.isArray(parsed)) {
		throw new Error("AI 响应不是数组格式");
	}

	return parsed
		.map((item: Record<string, unknown>) => {
			const needsEndFrame = Boolean(item.needsEndFrame);
			const imagePrompt = String(item.imagePrompt || item.prompt || "");
			const imagePromptZh = String(item.imagePromptZh || imagePrompt);
			const videoPrompt = String(item.videoPrompt || item.prompt || "");
			const videoPromptZh = String(
				item.videoPromptZh || item.promptZh || videoPrompt
			);
			const endFramePrompt = needsEndFrame
				? String(item.endFramePrompt || "")
				: "";
			const endFramePromptZh = needsEndFrame
				? String(item.endFramePromptZh || endFramePrompt)
				: "";

			return {
				id: Number(item.id),
				imagePrompt,
				imagePromptZh,
				needsEndFrame,
				endFramePrompt,
				endFramePromptZh,
				endFrameReason: (item.endFrameReason as string) || undefined,
				videoPrompt,
				videoPromptZh,
				prompt: videoPrompt,
				promptZh: videoPromptZh,
				action: item.action as string | undefined,
				camera: item.camera as string | undefined,
			};
		})
		.filter((p) => (p.videoPrompt || p.imagePrompt) && !Number.isNaN(p.id));
}

// ==================== Main Entry ====================

/**
 * Generate three-tier prompts for scenes.
 *
 * - If ALL scenes have text descriptions -> generate from text (no API)
 * - If SOME scenes lack descriptions -> fall back to Vision API for those
 */
export async function generateScenePrompts(
	config: ScenePromptRequest
): Promise<GeneratedPrompt[]> {
	const {
		storyboardImage,
		storyPrompt,
		scenes,
		apiKey,
		provider = "unknown",
		baseUrl,
		model,
	} = config;

	const scenesWithText = scenes.filter((s) => sceneHasTextDescription(s));
	const scenesWithoutText = scenes.filter((s) => !sceneHasTextDescription(s));

	// All scenes have text -> generate directly
	if (scenesWithoutText.length === 0) {
		return scenes.map((s) => generatePromptFromText(s, storyPrompt));
	}

	const textResults = scenesWithText.map((s) =>
		generatePromptFromText(s, storyPrompt)
	);

	// Fall back to Vision API for scenes without text
	if (scenesWithoutText.length > 0) {
		const normalizedBaseUrl = baseUrl?.replace(/\/+$/, "");
		if (!normalizedBaseUrl || !model) {
			const placeholders = scenesWithoutText.map((s) =>
				createPlaceholderPrompt(s.id)
			);
			return [...textResults, ...placeholders].sort((a, b) => a.id - b.id);
		}

		try {
			const visionResults = await generatePromptsViaVisionAPI(
				storyboardImage,
				storyPrompt,
				scenesWithoutText,
				apiKey,
				provider,
				normalizedBaseUrl,
				model
			);
			return [...textResults, ...visionResults].sort((a, b) => a.id - b.id);
		} catch {
			const placeholders = scenesWithoutText.map((s) =>
				createPlaceholderPrompt(s.id)
			);
			return [...textResults, ...placeholders].sort((a, b) => a.id - b.id);
		}
	}

	return textResults;
}
