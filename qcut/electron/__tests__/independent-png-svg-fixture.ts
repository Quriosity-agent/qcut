import { crc32 } from "node:zlib";

/** Valid PNG metadata reproduces the Buffer decoder's unrestricted SVG sniff. */
export function pngWithSvgMarker({ png }: { png: Buffer }) {
	const data = Buffer.from("Comment\0<svg", "utf8");
	const chunk = Buffer.alloc(data.length + 12);
	chunk.writeUInt32BE(data.length);
	chunk.write("tEXt", 4, "ascii");
	data.copy(chunk, 8);
	chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
	return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
}
