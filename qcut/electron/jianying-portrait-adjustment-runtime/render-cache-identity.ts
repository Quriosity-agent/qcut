import { createHash } from "node:crypto";
import fs, { type BigIntStats } from "node:fs";
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
	const physicalFs =
		(process.getBuiltinModule?.("original-fs") as typeof fs | undefined) ?? fs;
	function signature({ info }: { info: BigIntStats }) {
		return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(
			":"
		);
	}
	async function optionalStat({ filePath }: { filePath: string }) {
		return physicalFs.promises
			.stat(filePath, { bigint: true })
			.catch((error) => {
				if (error.code === "ENOENT" || error.code === "ENOTDIR") return;
				throw error;
			});
	}
	async function findArchive({ filePath }: { filePath: string }) {
		const root = path.parse(filePath).root;
		const parts = filePath.slice(root.length).split(path.sep);
		return parts.reduce<
			Promise<{ archivePath: string; signature: string } | undefined>
		>(async (previous, part, index) => {
			const found = await previous;
			if (found || !part.toLowerCase().endsWith(".asar")) return found;
			const archivePath = path.join(root, ...parts.slice(0, index + 1));
			const info = await optionalStat({ filePath: archivePath });
			if (info?.isFile())
				return { archivePath, signature: signature({ info }) };
		}, Promise.resolve(undefined));
	}
	async function collectArchiveBackingFiles({
		filePath,
		archivePath,
		backingFiles,
		ancestors = new Set<string>(),
		signal,
	}: {
		filePath: string;
		archivePath: string;
		backingFiles: Set<string>;
		ancestors?: Set<string>;
		signal?: AbortSignal;
	}): Promise<void> {
		signal?.throwIfAborted();
		const resolved = await fs.promises.realpath(filePath);
		const info = await fs.promises.stat(resolved);
		if (info.isDirectory()) {
			if (ancestors.has(resolved))
				throw new Error("Native runtime contains a directory cycle");
			const next = new Set(ancestors).add(resolved);
			const children = (await fs.promises.readdir(resolved)).sort();
			await children.reduce(async (previous, name) => {
				await previous;
				await collectArchiveBackingFiles({
					filePath: path.join(resolved, name),
					archivePath,
					backingFiles,
					ancestors: next,
					signal,
				});
			}, Promise.resolve());
			return;
		}
		if (!info.isFile()) throw new Error("Unsupported native runtime entry");
		// Virtual stat succeeds for missing unpacked files; access checks their backing paths.
		await fs.promises.access(resolved, fs.constants.R_OK);
		const unpackedPath = path.join(
			`${archivePath}.unpacked`,
			path.relative(archivePath, resolved)
		);
		if (await optionalStat({ filePath: unpackedPath }))
			backingFiles.add(unpackedPath);
	}
	async function fingerprintPhysicalPath({
		filePath,
		ancestors = new Set<string>(),
		signal,
	}: {
		filePath: string;
		ancestors?: Set<string>;
		signal?: AbortSignal;
	}): Promise<string> {
		signal?.throwIfAborted();
		const resolved = await physicalFs.promises.realpath(filePath);
		const before = await physicalFs.promises.stat(resolved, { bigint: true });
		const hash = createHash("sha256")
			.update(filePath)
			.update("\0")
			.update(resolved);
		if (before.isDirectory()) {
			if (ancestors.has(resolved))
				throw new Error("Native runtime contains a directory cycle");
			const children = (await physicalFs.promises.readdir(resolved)).sort();
			const next = new Set(ancestors).add(resolved);
			// Stream model contents one file at a time; metadata is rechecked on every request.
			await children.reduce(async (previous, name) => {
				await previous;
				hash.update(
					await fingerprintPhysicalPath({
						filePath: path.join(resolved, name),
						ancestors: next,
						signal,
					})
				);
			}, Promise.resolve());
			return hash.digest("hex");
		}
		if (!before.isFile()) throw new Error("Unsupported native runtime entry");
		const beforeSignature = signature({ info: before });
		let cached = files.get(resolved);
		if (cached?.signature !== beforeSignature) {
			const content = createHash("sha256");
			for await (const chunk of physicalFs.createReadStream(resolved, {
				signal,
			}))
				content.update(chunk);
			const after = await physicalFs.promises.stat(resolved, { bigint: true });
			if (signature({ info: after }) !== beforeSignature)
				throw new Error("Native runtime changed while fingerprinting");
			cached = { signature: beforeSignature, digest: content.digest("hex") };
			files.set(resolved, cached);
		}
		hash.update(cached.digest);
		return hash.digest("hex");
	}
	async function fingerprintPath({
		filePath,
		signal,
	}: {
		filePath: string;
		signal?: AbortSignal;
	}) {
		signal?.throwIfAborted();
		if (physicalFs === fs) return fingerprintPhysicalPath({ filePath, signal });
		const resolved = await fs.promises.realpath(filePath);
		const archive = await findArchive({ filePath: resolved });
		if (!archive) return fingerprintPhysicalPath({ filePath, signal });
		const backingFiles = new Set<string>();
		await collectArchiveBackingFiles({
			filePath: resolved,
			archivePath: archive.archivePath,
			backingFiles,
			signal,
		});
		// ASAR stats use synthetic inodes; guard the real archive and unpacked bytes instead.
		const hash = createHash("sha256")
			.update(filePath)
			.update("\0")
			.update(resolved)
			.update(
				await fingerprintPhysicalPath({ filePath: archive.archivePath, signal })
			);
		await [...backingFiles].sort().reduce(async (previous, unpackedPath) => {
			await previous;
			hash.update(
				await fingerprintPhysicalPath({ filePath: unpackedPath, signal })
			);
		}, Promise.resolve());
		const after = await physicalFs.promises.stat(archive.archivePath, {
			bigint: true,
		});
		if (signature({ info: after }) !== archive.signature)
			throw new Error("Native runtime changed while fingerprinting");
		signal?.throwIfAborted();
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
