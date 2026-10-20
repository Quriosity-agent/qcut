import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { createPortraitRenderDiskCache } from "../../jianying-portrait-adjustment-runtime/render-disk-cache.js";

const [directory, maxBytesText, keyPrefix, countText] = process.argv.slice(2);
const cache = createPortraitRenderDiskCache({
	directory,
	maxBytes: Number(maxBytesText),
});
const originalWrite = fs.writeFile;
let releaseWrite: (() => void) | null = null;
let begin: (() => void) | null = null;
const started = new Promise<void>((resolve) => {
	begin = resolve;
});

fs.writeFile = async (...args: Parameters<typeof fs.writeFile>) => {
	await originalWrite(...args);
	if (!String(args[0]).endsWith(".tmp")) return;
	await new Promise<void>((resolve) => {
		releaseWrite = resolve;
		process.send?.({ type: "temporary", file: String(args[0]) });
	});
};
process.on("message", (message: unknown) => {
	if (message === "start") begin?.();
	if (message === "release") {
		releaseWrite?.();
		releaseWrite = null;
	}
});

async function main() {
	process.send?.({ type: "ready" });
	await started;
	await Array.from({ length: Number(countText) }).reduce(
		async (previous, _, index) => {
			await previous;
			await cache.write({
				key: `${keyPrefix}${index.toString(16).padStart(63, "0")}`,
				result: {
					provider: "jianying-local-swing-v1",
					width: 32,
					height: 32,
					rgba: randomBytes(4096),
					activeGroups: ["body"],
				},
			});
		},
		Promise.resolve()
	);
	await cache.close();
	process.send?.({ type: "done" });
	process.disconnect();
}
main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
	process.disconnect();
});
