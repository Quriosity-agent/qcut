import {
	resolveStickerLabRoot,
	type StickerLabRootOptions,
} from "../stickers/sticker-lab-root-config.js";

export function resolveStickerLabRootOverride({
	...options
}: StickerLabRootOptions): string | undefined {
	const resolution = resolveStickerLabRoot(options);
	return resolution.source === "default" ? undefined : resolution.rootPath;
}
