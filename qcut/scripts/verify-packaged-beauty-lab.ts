import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { inflateSync } from "node:zlib";

async function main() {
	const [appPath, ...extra] = process.argv.slice(2);
	if (!appPath || extra.length || process.env.ELECTRON_RUN_AS_NODE !== "1")
		throw new Error(
			"Usage: ELECTRON_RUN_AS_NODE=1 <packaged Electron> <compiled audit> <app>"
		);
	const app = await realpath(appPath);
	const executable = path.join(app, "Contents/MacOS/QCut AI Video Editor");
	if ((await realpath(process.execPath)) !== (await realpath(executable)))
		throw new Error("Audit requires the selected packaged Electron executable");
	const asar = path.join(app, "Contents/Resources/app.asar");
	const load = createRequire(path.join(asar, "package.json"));
	const research = load(
		path.join(asar, "electron/beauty-lab-research.js")
	) as typeof import("../electron/beauty-lab-research");
	if (typeof research.createBeautyLabResearchProvider !== "function")
		throw new Error("Missing packaged Beauty Lab research provider");
	const { decodeInput, WIDTH, HEIGHT, RGBA_BYTES } = load(
		path.join(asar, "electron/beauty-lab/beauty-lab-research-files.js")
	) as typeof import("../electron/beauty-lab/beauty-lab-research-files");
	const { createCanvas, ImageData } = load(
		"@napi-rs/canvas"
	) as typeof import("@napi-rs/canvas");
	const rgba = new Uint8Array(RGBA_BYTES);
	for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) {
		const x = pixel % WIDTH,
			y = Math.floor(pixel / WIDTH);
		rgba.set([x % 256, y % 256, (x + y) % 256, 255], pixel * 4);
	}
	rgba.fill(0, 0, 4);
	const canvas = createCanvas(WIDTH, HEIGHT);
	canvas
		.getContext("2d")
		.putImageData(
			new ImageData(new Uint8ClampedArray(rgba), WIDTH, HEIGHT),
			0,
			0
		);
	const encoded = canvas.toBuffer("image/png");
	const chunks: Buffer[] = [encoded.subarray(0, 8)],
		compressed: Buffer[] = [];
	let offset = 8;
	while (offset < encoded.length) {
		const end = offset + encoded.readUInt32BE(offset) + 12;
		const type = encoded.toString("ascii", offset + 4, offset + 8);
		if (["IHDR", "IDAT", "IEND"].includes(type))
			chunks.push(encoded.subarray(offset, end));
		if (type === "IDAT") compressed.push(encoded.subarray(offset + 8, end - 4));
		offset = end;
	}
	// The evidence decoder deliberately excludes ancillary color/profile chunks.
	const bytes = Buffer.concat(chunks);
	const inflated = inflateSync(Buffer.concat(compressed), {
		maxOutputLength: HEIGHT * (WIDTH * 4 + 1),
	});
	const usesFilteredRows = Array.from(
		{ length: HEIGHT },
		(_, row) => inflated[row * (WIDTH * 4 + 1)]
	).some((filter) => filter !== 0);
	if (!usesFilteredRows)
		throw new Error("Fixture must exercise the packaged PNG codec");
	const expected = createHash("sha256").update(rgba).digest("hex");
	const decoded = decodeInput({ bytes, expected });
	if (!Buffer.from(decoded).equals(Buffer.from(rgba)))
		throw new Error("Packaged RGBA mismatch");
	console.log(
		JSON.stringify(
			{
				app,
				executable,
				asar,
				researchModuleLoaded: true,
				filteredPngDecoded: true,
				transparentPixelPreserved: decoded[3] === 0,
				rgbaSha256: expected,
				packagedUIVerified: false,
			},
			null,
			2
		)
	);
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
