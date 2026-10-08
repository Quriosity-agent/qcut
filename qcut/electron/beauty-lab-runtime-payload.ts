import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import profile from "./beauty-lab-runtime-payload.json";

const profileSchema = z.object({
	schemaVersion: z.literal(1),
	profile: z.string().min(1),
	sourceManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
	files: z
		.array(
			z.object({
				path: z.string().min(1),
				bytes: z
					.number()
					.int()
					.nonnegative()
					.max(256 * 1024 * 1024),
				sha256: z.string().regex(/^[a-f0-9]{64}$/),
			})
		)
		.min(1)
		.max(4096),
});

function failureReason({ error }: { error: unknown }) {
	if (!(error instanceof Error)) return String(error);
	if ("code" in error) return String(error.code);
	return error.message;
}

export async function verifyIndependentBeautyRuntime({
	runtimeRoot,
	sourceManifestSha256,
	requirements = profile,
}: {
	runtimeRoot: string;
	sourceManifestSha256: string;
	requirements?: unknown;
}) {
	const parsed = profileSchema.parse(requirements);
	if (parsed.sourceManifestSha256 !== sourceManifestSha256)
		throw new Error("Independent runtime profile does not match engine source");
	const root = await realpath(runtimeRoot);
	const paths = new Set<string>();
	for (const file of parsed.files) {
		const segments = file.path.split("/");
		if (
			!["research", "Cache", "Models"].includes(segments[0]) ||
			segments.some(
				(segment) => !segment || segment === "." || segment === ".."
			) ||
			file.path.includes("\\") ||
			file.path.includes(":") ||
			paths.has(file.path)
		)
			throw new Error(`Invalid independent runtime profile path: ${file.path}`);
		paths.add(file.path);
	}
	const failures: string[] = [];
	let next = 0;
	async function verifyNext(): Promise<void> {
		const file = parsed.files[next++];
		if (!file) return;
		try {
			const filePath = path.join(root, file.path);
			if (!(await lstat(filePath)).isFile())
				throw new Error("regular payload file required");
			// Directory links support external installs; payload file links are rejected.
			const handle = await open(
				filePath,
				constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
			);
			try {
				const metadata = await handle.stat();
				if (!metadata.isFile() || metadata.size !== file.bytes)
					throw new Error("size or file type mismatch");
				const hash = createHash("sha256");
				if (file.bytes > 0)
					await new Promise<void>((resolve, reject) => {
						const stream = handle.createReadStream({
							autoClose: false,
							end: file.bytes - 1,
						});
						stream.on("data", (chunk) => hash.update(chunk));
						stream.once("error", reject);
						stream.once("end", resolve);
					});
				if (
					hash.digest("hex") !== file.sha256 ||
					(await handle.stat()).size !== file.bytes
				)
					throw new Error("SHA-256 or final size mismatch");
			} finally {
				await handle.close();
			}
		} catch (error) {
			failures.push(`${file.path}: ${failureReason({ error })}`);
		}
		return verifyNext();
	}
	await Promise.all(Array.from({ length: 4 }, () => verifyNext()));
	if (failures.length)
		throw new Error(
			`Independent runtime payload incomplete (${failures.length} files): ${failures.sort().slice(0, 8).join("; ")}`
		);
	return {
		profile: parsed.profile,
		verifiedFiles: parsed.files.length,
		verifiedBytes: parsed.files.reduce((sum, file) => sum + file.bytes, 0),
	};
}
