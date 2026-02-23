/**
 * Image Grid Generator
 *
 * Generates multiple images and composites them into a grid layout.
 * Uses sharp for image compositing when available, falls back to
 * returning individual images.
 *
 * @module electron/native-pipeline/grid-generator
 */

import * as path from "path";
import * as fs from "fs";

export interface GridOptions {
	layout: "2x2" | "3x3" | "2x3" | "3x2" | "1x2" | "2x1";
	gap: number;
	backgroundColor: string;
	outputPath: string;
}

export interface GridResult {
	success: boolean;
	outputPath?: string;
	imagePaths: string[];
	error?: string;
}

function parseLayout(layout: string): { cols: number; rows: number } {
	const match = layout.match(/^(\d+)x(\d+)$/);
	if (!match) return { cols: 2, rows: 2 };
	return { cols: parseInt(match[1], 10), rows: parseInt(match[2], 10) };
}

export function getGridImageCount(layout: string): number {
	const { cols, rows } = parseLayout(layout);
	return cols * rows;
}

export async function compositeGrid(
	imagePaths: string[],
	options: GridOptions
): Promise<GridResult> {
	const { cols, rows } = parseLayout(options.layout);
	const needed = cols * rows;

	if (imagePaths.length < needed) {
		return {
			success: false,
			imagePaths,
			error: `Need ${needed} images for ${options.layout} grid, got ${imagePaths.length}`,
		};
	}

	try {
		// Dynamic import with eval to prevent Vite static analysis
		const sharpModuleName = "sharp";
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const sharp = (await new Function("name", "return import(name)")(
			sharpModuleName
		).catch(() => null)) as { default: (input: any) => any } | null;
		if (!sharp) {
			return {
				success: true,
				imagePaths: imagePaths.slice(0, needed),
				error: "sharp not available, returning individual images",
			};
		}

		const firstMeta = await sharp.default(imagePaths[0]).metadata();
		const imgW = firstMeta.width || 512;
		const imgH = firstMeta.height || 512;
		const gap = options.gap;
		const totalW = cols * imgW + (cols - 1) * gap;
		const totalH = rows * imgH + (rows - 1) * gap;

		const composites: Array<{ input: string; left: number; top: number }> = [];
		for (let r = 0; r < rows; r++) {
			for (let c = 0; c < cols; c++) {
				const idx = r * cols + c;
				if (idx < imagePaths.length) {
					composites.push({
						input: imagePaths[idx],
						left: c * (imgW + gap),
						top: r * (imgH + gap),
					});
				}
			}
		}

		const outputDir = path.dirname(options.outputPath);
		fs.mkdirSync(outputDir, { recursive: true });

		await sharp
			.default({
				create: {
					width: totalW,
					height: totalH,
					channels: 3,
					background: options.backgroundColor || "#000000",
				},
			})
			.composite(composites)
			.png()
			.toFile(options.outputPath);

		return {
			success: true,
			outputPath: options.outputPath,
			imagePaths: imagePaths.slice(0, needed),
		};
	} catch (err) {
		return {
			success: false,
			imagePaths,
			error: `Grid compositing failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}
