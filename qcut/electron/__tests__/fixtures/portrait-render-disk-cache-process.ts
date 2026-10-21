import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createPortraitRenderDiskCache } from "../../jianying-portrait-adjustment-runtime/render-disk-cache.js";
import { CacheLeaseUnavailableError } from "../../jianying-portrait-adjustment-runtime/render-disk-cache-lock.js";

const [
	directory,
	maxBytesText,
	keyPrefix,
	countText,
	retryBudgetText = "10000",
] = process.argv.slice(2);
const retryBudgetMs = Number(retryBudgetText);
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
	if (!Number.isFinite(retryBudgetMs) || retryBudgetMs < 0) {
		throw new Error("Invalid fixture retry budget");
	}
	process.send?.({ type: "ready" });
	await started;
	await Array.from({ length: Number(countText) }).reduce(
		async (previous, _, index) => {
			await previous;
			const request: Parameters<typeof cache.write>[0] = {
				key: `${keyPrefix}${index.toString(16).padStart(63, "0")}`,
				result: {
					provider: "jianying-local-swing-v1",
					width: 32,
					height: 32,
					rgba: randomBytes(4096),
					activeGroups: ["body"],
				},
			};
			const deadline = performance.now() + retryBudgetMs;
			const rgbaSha256 = createHash("sha256")
				.update(request.result.rgba)
				.digest("hex");
			async function write() {
				try {
					await cache.write(request);
				} catch (error) {
					if (
						!(error instanceof CacheLeaseUnavailableError) ||
						performance.now() >= deadline
					) {
						throw error;
					}
					// Parent-side disk inspection deliberately pauses the lease owner.
					process.send?.({ type: "retry", key: request.key, rgbaSha256 });
					await write();
				}
			}
			await write();
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
