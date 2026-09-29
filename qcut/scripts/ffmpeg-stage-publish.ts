import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

async function renameStage({
	source,
	destination,
	platform,
	attempt = 0,
}: {
	source: string;
	destination: string;
	platform: NodeJS.Platform;
	attempt?: number;
}): Promise<void> {
	try {
		await rename(source, destination);
	} catch (error: unknown) {
		const code = (error as NodeJS.ErrnoException)?.code;
		const retryable =
			platform === "win32" && ["EPERM", "EBUSY", "EACCES"].includes(code ?? "");
		if (!retryable || attempt >= 5) throw error;
		// Windows scanners can retain newly verified executables after exit.
		await delay(500 * (attempt + 1));
		return renameStage({ source, destination, platform, attempt: attempt + 1 });
	}
}

export async function publishFFmpegStage({
	source,
	destination,
	platform = process.platform,
}: {
	source: string;
	destination: string;
	platform?: NodeJS.Platform;
}): Promise<void> {
	await rm(destination, {
		recursive: true,
		force: true,
		maxRetries: platform === "win32" ? 5 : 0,
		retryDelay: 500,
	});
	await mkdir(dirname(destination), { recursive: true });
	await renameStage({ source, destination, platform });
}
