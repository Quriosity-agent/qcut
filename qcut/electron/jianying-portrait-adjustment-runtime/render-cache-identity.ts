import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { JianyingPortraitAdjustmentRenderRequest } from "./jianying-portrait-adjustment-contract.js";
import { inspectJianyingFilterLocalRuntime } from "../jianying-filter-local-runtime/runtime-discovery.js";
import { resolveJianyingPortraitAdjustmentHost } from "./bridge-resolver.js";
import { resolveJianyingPortraitPackages } from "./package-resolver.js";
import { resolveJianyingPortraitMakeupCards } from "./makeup-resolver.js";
import { buildJianyingPortraitRenderStages } from "./stages.js";

const CACHE_REVISION = "native-source-window-v1";

export function resolvePortraitRenderRuntime({
	request,
}: {
	request: JianyingPortraitAdjustmentRenderRequest;
}) {
	return Promise.all([
		inspectJianyingFilterLocalRuntime(),
		resolveJianyingPortraitAdjustmentHost(),
		resolveJianyingPortraitPackages({
			skinToneResourceId: request.adjustments.skinToneResourceId ?? undefined,
		}),
		resolveJianyingPortraitMakeupCards(),
	]);
}

function stableJson({ value }: { value: unknown }): string {
	if (Array.isArray(value))
		return `[${value.map((entry) => stableJson({ value: entry })).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(
				([key, entry]) =>
					`${JSON.stringify(key)}:${stableJson({ value: entry })}`
			)
			.join(",")}}`;
	return JSON.stringify(value) ?? "null";
}

export function isCacheablePortraitSourceWindow({
	request,
}: {
	request: JianyingPortraitAdjustmentRenderRequest;
}) {
	return (
		request.freshTracking === true &&
		request.sourceKey?.startsWith("source-window-v1:") === true &&
		request.adjustments.enabled &&
		request.timestampSeconds !== undefined &&
		Number.isFinite(request.timestampSeconds) &&
		request.timestampSeconds >= 0 &&
		!request.adjustments.faces?.length &&
		request.adjustments.faceTarget?.mode !== "single" &&
		!request.adjustments.manualRetouch?.strokes.length
	);
}

export function portraitSourceWindowCacheKey({
	request,
	runtimeIdentity,
}: {
	request: JianyingPortraitAdjustmentRenderRequest;
	runtimeIdentity: string;
}) {
	const { rgba, sourcePreRoll, requestId: _requestId, ...parameters } = request;
	const hash = createHash("sha256")
		.update(CACHE_REVISION)
		.update(runtimeIdentity)
		.update(stableJson({ value: parameters }))
		.update(rgba);
	hash.update(
		stableJson({
			value: sourcePreRoll
				? {
						sourceKey: sourcePreRoll.sourceKey,
						timestamps: sourcePreRoll.frames.map(
							(frame) => frame.timestampSeconds
						),
					}
				: null,
		})
	);
	for (const frame of sourcePreRoll?.frames ?? []) hash.update(frame.rgba);
	return hash.digest("hex");
}

export function createPortraitRuntimeFingerprinter() {
	const files = new Map<string, { signature: string; digest: string }>();
	async function fingerprintPath({
		filePath,
		ancestors = new Set<string>(),
		signal,
	}: {
		filePath: string;
		ancestors?: Set<string>;
		signal?: AbortSignal;
	}): Promise<string> {
		signal?.throwIfAborted();
		const resolved = await realpath(filePath);
		const before = await stat(resolved, { bigint: true });
		const hash = createHash("sha256")
			.update(filePath)
			.update("\0")
			.update(resolved);
		if (before.isDirectory()) {
			if (ancestors.has(resolved))
				throw new Error("Native runtime contains a directory cycle");
			const children = (await readdir(resolved)).sort();
			const next = new Set(ancestors).add(resolved);
			// Stream model contents one file at a time; metadata is rechecked on every request.
			await children.reduce(async (previous, name) => {
				await previous;
				hash.update(
					await fingerprintPath({
						filePath: path.join(resolved, name),
						ancestors: next,
						signal,
					})
				);
			}, Promise.resolve());
			return hash.digest("hex");
		}
		if (!before.isFile()) throw new Error("Unsupported native runtime entry");
		const signature = [
			before.dev,
			before.ino,
			before.size,
			before.mtimeNs,
			before.ctimeNs,
		].join(":");
		let cached = files.get(resolved);
		if (cached?.signature !== signature) {
			const content = createHash("sha256");
			for await (const chunk of createReadStream(resolved, { signal }))
				content.update(chunk);
			const after = await stat(resolved, { bigint: true });
			if (
				[after.dev, after.ino, after.size, after.mtimeNs, after.ctimeNs].join(
					":"
				) !== signature
			)
				throw new Error("Native runtime changed while fingerprinting");
			cached = { signature, digest: content.digest("hex") };
			files.set(resolved, cached);
		}
		hash.update(cached.digest);
		return hash.digest("hex");
	}
	return {
		fingerprint: async ({
			paths,
			configuration,
			signal,
		}: {
			paths: string[];
			configuration: unknown;
			signal?: AbortSignal;
		}) => {
			const hash = createHash("sha256")
				.update(CACHE_REVISION)
				.update(stableJson({ value: configuration }));
			await [...new Set(paths)].sort().reduce(async (previous, filePath) => {
				await previous;
				hash.update(await fingerprintPath({ filePath, signal }));
			}, Promise.resolve());
			signal?.throwIfAborted();
			return hash.digest("hex");
		},
		clear: () => files.clear(),
	};
}

export function createPortraitRenderIdentity() {
	const fingerprinter = createPortraitRuntimeFingerprinter();
	return {
		resolve: async ({
			request,
			signal,
		}: {
			request: JianyingPortraitAdjustmentRenderRequest;
			signal?: AbortSignal;
		}) => {
			const [runtime, hostPath, packages, makeupCards] =
				await resolvePortraitRenderRuntime({ request });
			if (
				runtime.status.state !== "ready" ||
				!runtime.frameworkDirectory ||
				!runtime.modelDirectory ||
				!hostPath
			)
				throw new Error("Native runtime identity is unavailable");
			const stages = buildJianyingPortraitRenderStages({
				request,
				packages,
				makeupCards,
			});
			const environment = Object.fromEntries(
				Object.entries(process.env).filter(([key]) => !key.startsWith("DYLD_"))
			);
			return fingerprinter.fingerprint({
				paths: [
					__dirname,
					hostPath,
					runtime.frameworkDirectory,
					runtime.modelDirectory,
					...stages.map((stage) => stage.packagePath),
					...makeupCards.flatMap(({ card, packagePath }) =>
						packagePath &&
						request.adjustments.makeup?.[card.category]?.cardId === card.id
							? [packagePath]
							: []
					),
				],
				configuration: {
					stages,
					environment,
					platform: process.platform,
					arch: process.arch,
					release: os.release(),
					cpu: os.cpus()[0]?.model,
					versions: process.versions,
				},
				signal,
			});
		},
		clear: fingerprinter.clear,
	};
}
