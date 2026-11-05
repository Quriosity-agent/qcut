import fs from "fs";
import type { VisualLayerBlendMode } from "./visual-layer-compositor";

export function buildAssAlphaLayer({
	sourcePath,
	rgbAssPath,
	assFilter,
	outputLabel,
	blendMode,
	width,
	height,
	duration,
	fps,
}: {
	sourcePath: string;
	rgbAssPath: string;
	assFilter: string;
	outputLabel: string;
	blendMode: VisualLayerBlendMode;
	width: number;
	height: number;
	duration: number;
	fps: number;
}): string[] {
	const content = fs.readFileSync(sourcePath, "utf8");
	const rgbContent = content
		.replace(/^YCbCr Matrix:.*\r?\n?/gim, "")
		.replace(/\[Script Info\]/i, "[Script Info]\nYCbCr Matrix: None");
	// ASS's default TV matrix would apply limited-range levels to RGB channels.
	fs.writeFileSync(rgbAssPath, rgbContent);
	const source = ({ color }: { color: "black" | "white" }) =>
		`color=c=${color}:s=${width}x${height}:d=${duration}:r=${fps},format=gbrp,${assFilter}`;

	// Multiplication distributes over white-matte compositing; screen over black.
	if (blendMode === "multiply" || blendMode === "screen") {
		return [
			`${source({ color: blendMode === "multiply" ? "white" : "black" })},format=rgba[${outputLabel}]`,
		];
	}

	const black = `${outputLabel}_black`;
	const color = `${outputLabel}_color`;
	const white = `${outputLabel}_white`;
	const mask = `${outputLabel}_mask`;
	return [
		`${source({ color: "black" })},split=2[${black}][${color}]`,
		`${source({ color: "white" })}[${white}]`,
		// White minus black is the unpainted fraction, including overlapping glyphs.
		`[${white}][${black}]blend=all_expr='255-A+B',extractplanes=g[${mask}]`,
		`[${color}][${mask}]alphamerge,setparams=alpha_mode=premultiplied,unpremultiply=inplace=1,format=rgba[${outputLabel}]`,
	];
}
