import type { AssetManifestFile } from "@qcut/editor-core";

/** Upper bound for a single cached resource unless a caller overrides it. */
export const DEFAULT_MAX_FILE_BYTES = 128 * 1024 * 1024;

function bytesToHex({ bytes }: { bytes: ArrayBuffer }): string {
	return Array.from(new Uint8Array(bytes), (value) =>
		value.toString(16).padStart(2, "0")
	).join("");
}

export function copyToArrayBuffer({
	bytes,
}: {
	bytes: Uint8Array;
}): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

export async function sha256({
	bytes,
}: {
	bytes: Uint8Array;
}): Promise<string> {
	if (!globalThis.crypto?.subtle) {
		throw new Error("SHA-256 verification is unavailable");
	}
	return bytesToHex({
		bytes: await globalThis.crypto.subtle.digest(
			"SHA-256",
			copyToArrayBuffer({ bytes })
		),
	});
}

function concatenateChunks({
	chunks,
	totalBytes,
}: {
	chunks: Uint8Array[];
	totalBytes: number;
}): Uint8Array {
	const result = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

async function readResponseChunks({
	chunks,
	loadedBytes,
	maxFileBytes,
	onProgress,
	reader,
	totalBytes,
}: {
	chunks: Uint8Array[];
	loadedBytes: number;
	maxFileBytes: number;
	onProgress?: ({
		loadedBytes,
		totalBytes,
	}: {
		loadedBytes: number;
		totalBytes?: number;
	}) => void;
	reader: ReadableStreamDefaultReader<Uint8Array>;
	totalBytes?: number;
}): Promise<Uint8Array> {
	const { done, value } = await reader.read();
	if (done) return concatenateChunks({ chunks, totalBytes: loadedBytes });
	const nextLoadedBytes = loadedBytes + value.byteLength;
	if (nextLoadedBytes > maxFileBytes) {
		await reader.cancel();
		throw new Error(`Asset resource exceeds ${maxFileBytes} bytes`);
	}
	chunks.push(value);
	onProgress?.({ loadedBytes: nextLoadedBytes, totalBytes });
	return readResponseChunks({
		chunks,
		loadedBytes: nextLoadedBytes,
		maxFileBytes,
		onProgress,
		reader,
		totalBytes,
	});
}

function isAbortError({ error }: { error: unknown }): boolean {
	return (
		(error instanceof DOMException && error.name === "AbortError") ||
		(error instanceof Error && error.name === "AbortError")
	);
}

function retryableStatus({ status }: { status: number }): boolean {
	return status === 408 || status === 429 || status >= 500;
}

class AssetResourceHttpError extends Error {
	readonly retryable: boolean;

	constructor({ status, url }: { status: number; url: string }) {
		super(`Asset resource request failed (${status}): ${url}`);
		this.name = "AssetResourceHttpError";
		this.retryable = retryableStatus({ status });
	}
}

async function fetchResourceBytes({
	fetchImpl,
	file,
	maxFileBytes,
	onProgress,
	signal,
}: {
	fetchImpl: typeof fetch;
	file: AssetManifestFile;
	maxFileBytes: number;
	onProgress?: ({
		loadedBytes,
		totalBytes,
	}: {
		loadedBytes: number;
		totalBytes?: number;
	}) => void;
	signal?: AbortSignal;
}): Promise<{ bytes: Uint8Array; mimeType: string }> {
	const response = await fetchImpl(file.url, { signal });
	if (!response.ok) {
		throw new AssetResourceHttpError({
			status: response.status,
			url: file.url,
		});
	}
	const contentLengthHeader = response.headers.get("content-length");
	const contentLength = contentLengthHeader
		? Number.parseInt(contentLengthHeader, 10)
		: undefined;
	if (contentLength && contentLength > maxFileBytes) {
		throw new Error(`Asset resource exceeds ${maxFileBytes} bytes`);
	}
	const bytes = response.body
		? await readResponseChunks({
				chunks: [],
				loadedBytes: 0,
				maxFileBytes,
				onProgress,
				reader: response.body.getReader(),
				totalBytes: contentLength,
			})
		: new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength > maxFileBytes) {
		throw new Error(`Asset resource exceeds ${maxFileBytes} bytes`);
	}
	return {
		bytes,
		mimeType:
			response.headers.get("content-type") ??
			file.mimeType ??
			"application/octet-stream",
	};
}

export async function fetchResourceWithRetry({
	attempt,
	fetchImpl,
	file,
	maxFileBytes,
	onProgress,
	retryCount,
	signal,
}: {
	attempt: number;
	fetchImpl: typeof fetch;
	file: AssetManifestFile;
	maxFileBytes: number;
	onProgress?: ({
		loadedBytes,
		totalBytes,
	}: {
		loadedBytes: number;
		totalBytes?: number;
	}) => void;
	retryCount: number;
	signal?: AbortSignal;
}): Promise<{ bytes: Uint8Array; mimeType: string }> {
	try {
		return await fetchResourceBytes({
			fetchImpl,
			file,
			maxFileBytes,
			onProgress,
			signal,
		});
	} catch (error) {
		const retryable =
			!isAbortError({ error }) &&
			(!(error instanceof AssetResourceHttpError) || error.retryable);
		if (!retryable || attempt >= retryCount) throw error;
		return fetchResourceWithRetry({
			attempt: attempt + 1,
			fetchImpl,
			file,
			maxFileBytes,
			onProgress,
			retryCount,
			signal,
		});
	}
}
