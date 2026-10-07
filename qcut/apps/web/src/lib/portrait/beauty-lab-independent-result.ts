import {
	BEAUTY_LAB_INDEPENDENT_PROVIDER,
	type BeautyLabIndependentResult,
} from "@/types/electron";
import {
	validateBeautyLabFrame,
	type BeautyLabFrame,
} from "./beauty-lab-difference";

export async function beautyLabPixelHash({ rgba }: { rgba: Uint8Array }) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new Uint8Array(rgba).buffer
	);
	return Array.from(new Uint8Array(digest), (value) =>
		value.toString(16).padStart(2, "0")
	).join("");
}

export async function validateIndependentBeautyResult({
	input,
	frame,
	result,
}: {
	input: BeautyLabFrame;
	frame: BeautyLabFrame;
	result: BeautyLabIndependentResult;
}) {
	validateBeautyLabFrame({ frame: input });
	validateBeautyLabFrame({ frame });
	if (
		!(result.png instanceof Uint8Array) ||
		result.png.length < 33 ||
		result.png.length > 16 * 1024 ** 2
	)
		throw new Error("Independent PNG invalid");
	const header = new DataView(
		result.png.buffer,
		result.png.byteOffset,
		result.png.byteLength
	);
	if (
		header.getUint32(0) !== 0x89504e47 ||
		header.getUint32(4) !== 0x0d0a1a0a ||
		header.getUint32(16) !== input.width ||
		header.getUint32(20) !== input.height
	)
		throw new Error("Independent PNG dimensions or signature invalid");
	const [inputHash, outputHash, pngHash] = await Promise.all([
		beautyLabPixelHash({ rgba: input.rgba }),
		beautyLabPixelHash({ rgba: frame.rgba }),
		beautyLabPixelHash({ rgba: result.png }),
	]);
	if (
		result.provider !== BEAUTY_LAB_INDEPENDENT_PROVIDER ||
		!result.requestId ||
		!result.sourceKey ||
		result.width !== input.width ||
		result.height !== input.height ||
		frame.width !== input.width ||
		frame.height !== input.height ||
		!(result.rgba instanceof Uint8Array) ||
		result.rgba.length !== frame.rgba.length ||
		frame.rgba.some((value, index) => value !== result.rgba[index]) ||
		result.inputSha256 !== inputHash ||
		result.outputSha256 !== outputHash ||
		result.report.outputPngSha256 !== pngHash ||
		result.report.passed !== true ||
		result.report.nativeInputsUsed !== false ||
		result.report.nativeFallbackUsed !== false ||
		result.report.nativeGeometryUsed !== false ||
		result.report.nativeProductParityVerified !== false
	) {
		throw new Error("Independent provenance does not match the current pixels");
	}
}
