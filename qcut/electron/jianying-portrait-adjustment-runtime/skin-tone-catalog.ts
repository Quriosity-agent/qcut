import type { MediaPortraitSkinToneResourceId } from "../jianying-portrait-adjustment-contract.js";

// beauty_panels.ini skinColor/skinColorNew and the matching cached packages.
export const JIANYING_PORTRAIT_SKIN_TONES = [
	{
		resourceId: "7408757645705743616",
		version: "004bc0e61d910a38838da7332b0699af",
		titleZh: "美黑",
		titleEn: "Tan",
		color: "#A9775D",
	},
	{
		resourceId: "7408757645705760000",
		version: "74cd555080d70f9ccf3a1133a65f9f8d",
		titleZh: "粉白",
		titleEn: "Pink white",
		color: "#fad1c0",
	},
	{
		resourceId: "7408757645705776384",
		version: "011d6e743de9fe79ed77e210e57c2b4e",
		titleZh: "冷白",
		titleEn: "Cool white",
		color: "#fdebe2",
	},
	{
		resourceId: "7408757645705792768",
		version: "e63127a737132a3cbdb2a25bcb9ec38b",
		titleZh: "暖白",
		titleEn: "Warm white",
		color: "#ffdcba",
	},
	{
		resourceId: "7408757645705809152",
		version: "c1a8324810990e5dfbe4f3a36fc6f94f",
		titleZh: "小麦色",
		titleEn: "Wheat",
		color: "#d6a273",
	},
] as const satisfies readonly {
	resourceId: MediaPortraitSkinToneResourceId;
	version: string;
	titleZh: string;
	titleEn: string;
	color: string;
}[];

export const JIANYING_PORTRAIT_SKIN_DEFAULT_INTENSITY = 60;
export const JIANYING_PORTRAIT_LEGACY_SKIN_RESOURCE_ID = "7408757645705760000";

export function isPortraitSkinToneKey({ key }: { key: string }) {
	return (
		key === "face_adjust_skin_Intensity" || key === "face_adjust_skin_ColdWarm"
	);
}

export function parsePortraitSkinToneResourceId({
	value,
}: {
	value: unknown;
}): MediaPortraitSkinToneResourceId | null | undefined {
	if (value === undefined || value === null) return value;
	const tone = JIANYING_PORTRAIT_SKIN_TONES.find(
		({ resourceId }) => resourceId === value
	);
	if (!tone) throw new Error("Unknown portrait skin tone resource");
	return tone.resourceId;
}
