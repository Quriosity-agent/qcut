export interface ComparisonInput {
	name: string;
	width: number;
	height: number;
	rgba: Uint8Array;
	resized: boolean;
}

export function comparisonTestImage(): ComparisonInput {
	const width = 320;
	const height = 180;
	const rgba = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const offset = (y * width + x) * 4;
			rgba[offset] = Math.round((x * 255) / (width - 1));
			rgba[offset + 1] = Math.round((y * 255) / (height - 1));
			rgba[offset + 2] =
				(Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? 230 : 20;
			rgba[offset + 3] = 255;
		}
	}
	return { name: "QCut 测试图", width, height, rgba, resized: false };
}

export async function readComparisonImage({
	file,
	maxEdge = 640,
	maxPixels = 40_000_000,
}: {
	file: File;
	maxEdge?: number;
	maxPixels?: number;
}): Promise<ComparisonInput> {
	if (
		![maxEdge, maxPixels].every((value) => Number.isInteger(value) && value > 0)
	)
		throw new RangeError("图片处理尺寸限制必须为正整数。");
	if (
		!["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
		file.size > 20 * 1024 * 1024
	) {
		throw new Error("请选择 20 MB 以内的 PNG、JPEG 或 WebP 图片。");
	}
	const bitmap = await createImageBitmap(file);
	try {
		if (
			!bitmap.width ||
			!bitmap.height ||
			bitmap.width * bitmap.height > 40_000_000
		) {
			throw new Error("图片尺寸无效或超过 4000 万像素。");
		}
		const ratio = Math.min(
			1,
			maxEdge / Math.max(bitmap.width, bitmap.height),
			Math.sqrt(maxPixels / (bitmap.width * bitmap.height))
		);
		const roundedWidth = Math.max(1, Math.round(bitmap.width * ratio));
		const roundedHeight = Math.max(1, Math.round(bitmap.height * ratio));
		const exceedsPixelLimit = roundedWidth * roundedHeight > maxPixels;
		const width = exceedsPixelLimit
			? Math.max(1, Math.floor(bitmap.width * ratio))
			: roundedWidth;
		const height = exceedsPixelLimit
			? Math.max(1, Math.floor(bitmap.height * ratio))
			: roundedHeight;
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d", { colorSpace: "srgb" });
		if (!context) throw new Error("无法读取图片像素。");
		context.drawImage(bitmap, 0, 0, width, height);
		const rgba = new Uint8Array(context.getImageData(0, 0, width, height).data);
		for (let i = 3; i < rgba.length; i += 4) {
			if (rgba[i] !== 255)
				throw new Error(
					"本轮对照需要不透明图片，请选择 JPEG 或不含透明区域的图片。"
				);
		}
		return {
			name: file.name,
			width,
			height,
			rgba,
			resized: width !== bitmap.width || height !== bitmap.height,
		};
	} finally {
		bitmap.close();
	}
}
