import type { BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { randomUUID } from "node:crypto";
import {
	BODY_PHOTO_PROVIDER,
	type BodyPhotoLabStatus,
} from "./body-photo-contract.js";
import {
	stageBodyPhotoSources,
	verifyStagedBodyPhotoSources,
} from "./body-photo-sources.js";
import {
	bodyPhotoEnvironment,
	readBodyPhotoSelection,
	resolveBodyPhotoRuntime,
	saveBodyPhotoSelection,
	type BodyPhotoRuntime,
} from "./body-photo-runtime.js";
import {
	startBodyPhotoProcess,
	type BodyPhotoProcess,
} from "./body-photo-process.js";
import { createBodyPhotoWindow } from "./body-photo-window.js";

const READINESS_MAX_AGE_MS = 30_000;

interface VerifiedRuntime {
	runtime: BodyPhotoRuntime;
	sources: Awaited<ReturnType<typeof stageBodyPhotoSources>>;
}

function checkServerIdentity({
	origin,
	instance,
}: {
	origin: string;
	instance: string;
}) {
	return new Promise<void>((resolve, reject) => {
		const request = http.get(
			`${origin}/api/catalog`,
			{ timeout: 10_000 },
			(response) => {
				response.resume();
				if (
					response.statusCode !== 200 ||
					response.headers["x-independent-body-instance"] !== instance
				) {
					reject(
						new Error(
							"Body-photo server identity did not match the owned process"
						)
					);
					return;
				}
				resolve();
			}
		);
		request.once("timeout", () =>
			request.destroy(new Error("Body-photo server did not become ready"))
		);
		request.once("error", reject);
	});
}

export function createBodyPhotoLabService({
	getMainWindow,
	sourceRoot,
	resourcesPath,
	userDataPath,
	isPackaged,
	environment = process.env,
	platform = process.platform,
	stageSources = stageBodyPhotoSources,
	verifySources = verifyStagedBodyPhotoSources,
	startProcess = startBodyPhotoProcess,
	createWindow = createBodyPhotoWindow,
	verifyServer = checkServerIdentity,
	show = true,
}: {
	getMainWindow: () => BrowserWindow | null;
	sourceRoot: string;
	resourcesPath: string;
	userDataPath: string;
	isPackaged: boolean;
	environment?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	stageSources?: typeof stageBodyPhotoSources;
	verifySources?: typeof verifyStagedBodyPhotoSources;
	startProcess?: typeof startBodyPhotoProcess;
	createWindow?: typeof createBodyPhotoWindow;
	verifyServer?: typeof checkServerIdentity;
	show?: boolean;
}) {
	const settingsPath = path.join(userDataPath, "body-photo-runtime.json");
	const processes = new Set<BodyPhotoProcess>();
	const hostCleanup = new Map<BodyPhotoProcess, Promise<void>>();
	let sessionRoot: string | undefined;
	let sourcePreparation:
		| Promise<Awaited<ReturnType<typeof stageBodyPhotoSources>>>
		| undefined;
	let window: BrowserWindow | undefined;
	let owner: BrowserWindow | undefined;
	let host: BodyPhotoProcess | undefined;
	let opening: Promise<{ opened: true }> | undefined;
	let closing: Promise<void> | undefined;
	let disposed = false;
	let generation = 0;
	let readinessContext: string | undefined;
	let readinessRevision = 0;
	let readiness: { key: string; expiresAt: number } | undefined;
	let pendingReadiness:
		| { key: string; generation: number; promise: Promise<VerifiedRuntime> }
		| undefined;

	function invalidateReadiness() {
		readiness = undefined;
		pendingReadiness = undefined;
		readinessRevision += 1;
	}

	function releaseOwner() {
		owner?.removeListener("closed", onOwnerClosed);
		owner = undefined;
	}

	function onOwnerClosed() {
		void close().catch(() => {});
	}

	function stopProcesses({ targets }: { targets: BodyPhotoProcess[] }) {
		const stopping = Promise.all([
			closing,
			...targets.map(async (process) => {
				await process.stop();
				await hostCleanup.get(process);
			}),
		]).then(() => {});
		closing = stopping;
		void stopping
			.finally(() => {
				if (closing === stopping) closing = undefined;
			})
			.catch(() => {});
		return stopping;
	}

	async function prepareSources() {
		if (disposed) throw new Error("Body-photo laboratory is shutting down");
		sourcePreparation ??= (async () => {
			sessionRoot = await fs.realpath(
				await fs.mkdtemp(path.join(os.tmpdir(), "qcut-body-photo-"))
			);
			if (isPackaged)
				return verifySources({ root: path.join(resourcesPath, "body-photo") });
			return stageSources({
				sourceRoot: path.join(sourceRoot, "research", "body-photo"),
				sharedEngineRoot: path.join(
					sourceRoot,
					"research",
					"independent-beauty",
					"research"
				),
				destinationRoot: path.join(sessionRoot, "source"),
			});
		})();
		return sourcePreparation;
	}

	function launch({
		runtime,
		bodyRoot,
		arguments: args,
		replyType,
	}: {
		runtime: BodyPhotoRuntime;
		bodyRoot: string;
		arguments: string[];
		replyType: "ready" | "verified";
	}) {
		const process = startProcess({
			python: runtime.python,
			arguments: [path.join(bodyRoot, "qcut_host.py"), ...args],
			environment: bodyPhotoEnvironment({
				environment,
				runtimeRoot: runtime.runtimeRoot,
			}),
			replyType,
			platform,
		});
		processes.add(process);
		void process.closed.finally(() => processes.delete(process));
		return process;
	}

	async function verifyRuntime({
		selection,
		reuseReadiness = false,
	}: {
		selection?: string;
		reuseReadiness?: boolean;
	} = {}): Promise<VerifiedRuntime> {
		const identity = generation;
		try {
			const chosen =
				selection ??
				environment.QCUT_BODY_PHOTO_RUNTIME ??
				(await readBodyPhotoSelection({ settingsPath })) ??
				path.join(userDataPath, "PrivateRuntimes", "BodyPhoto", "current");
			const runtime = await resolveBodyPhotoRuntime({
				selection: chosen,
				pythonOverride: environment.QCUT_BODY_PHOTO_PYTHON,
				platform,
			});
			const prepared = await prepareSources();
			const sources = verifySources({ root: prepared.root });
			const pythonTarget = await fs.realpath(runtime.python);
			const pythonStat = await fs.stat(pythonTarget);
			const key = JSON.stringify([
				runtime.bundleRoot,
				runtime.runtimeRoot,
				runtime.python,
				pythonTarget,
				pythonStat.size,
				pythonStat.mtimeMs,
				pythonStat.ctimeMs,
				sources.root,
				sources.manifestSha256,
			]);
			if (disposed || identity !== generation)
				throw new Error("Body-photo operation cancelled");
			if (readinessContext !== key) {
				invalidateReadiness();
				readinessContext = key;
			}
			// UI freshness never authorizes execution; open always performs its own verification.
			if (reuseReadiness) {
				if (readiness?.key === key && Date.now() < readiness.expiresAt)
					return { runtime, sources };
				if (
					pendingReadiness?.key === key &&
					pendingReadiness.generation === identity
				)
					return await pendingReadiness.promise;
			}
			const revision = readinessRevision;
			const promise = (async () => {
				const verification = launch({
					runtime,
					bodyRoot: sources.bodyRoot,
					arguments: ["--verify"],
					replyType: "verified",
				});
				try {
					const reply = await verification.reply;
					if (reply.onnxruntime !== "1.22.1" || reply.verified !== true)
						throw new Error(
							"Body-photo Python or model verification did not match the pinned CPU runtime"
						);
					await verification.closed;
					if (disposed || identity !== generation)
						throw new Error("Body-photo operation cancelled");
					if (revision === readinessRevision)
						readiness = { key, expiresAt: Date.now() + READINESS_MAX_AGE_MS };
					return { runtime, sources };
				} finally {
					await verification.stop();
				}
			})();
			pendingReadiness = { key, generation: identity, promise };
			try {
				return await promise;
			} finally {
				if (pendingReadiness?.promise === promise) pendingReadiness = undefined;
			}
		} catch (error) {
			invalidateReadiness();
			throw error;
		}
	}

	async function inspect(): Promise<BodyPhotoLabStatus> {
		try {
			const { sources } = await verifyRuntime({ reuseReadiness: true });
			return {
				available: true,
				provider: BODY_PHOTO_PROVIDER,
				message: "CPU 照片引擎和本地模型校验通过；21 项美体及局部编辑可用。",
				runtimeConfigured: true,
				windowOpen: Boolean(window && !window.isDestroyed()),
				sourceManifestSha256: sources.manifestSha256,
			};
		} catch (error) {
			return {
				available: false,
				provider: BODY_PHOTO_PROVIDER,
				message: error instanceof Error ? error.message : String(error),
				runtimeConfigured: false,
				windowOpen: Boolean(window && !window.isDestroyed()),
			};
		}
	}

	async function close(): Promise<{ closed: boolean }> {
		const wasOpen = Boolean(window || host || opening || processes.size);
		const closingHost = host;
		generation += 1;
		releaseOwner();
		if (window && !window.isDestroyed()) window.destroy();
		window = undefined;
		await stopProcesses({
			targets: [
				...new Set([...processes, ...(closingHost ? [closingHost] : [])]),
			],
		});
		if (host === closingHost) host = undefined;
		return { closed: wasOpen };
	}

	function open(): Promise<{ opened: true }> {
		if (disposed)
			return Promise.reject(
				new Error("Body-photo laboratory is shutting down")
			);
		if (window && !window.isDestroyed()) {
			if (show) {
				window.show();
				window.focus();
			}
			return Promise.resolve({ opened: true });
		}
		opening ??= (async () => {
			const identity = generation;
			const parent = getMainWindow();
			if (parent?.isDestroyed())
				throw new Error("Body-photo main-window owner is closed");
			owner = parent ?? undefined;
			owner?.once("closed", onOwnerClosed);
			if (closing) await closing;
			if (identity !== generation || disposed)
				throw new Error("Body-photo operation cancelled");
			const { runtime, sources } = await verifyRuntime();
			if (identity !== generation)
				throw new Error("Body-photo operation cancelled");
			const instance = randomUUID().replaceAll("-", "");
			const stateRoot = await fs.mkdtemp(
				path.join(sessionRoot as string, "state-")
			);
			if (identity !== generation || disposed) {
				await fs.rm(stateRoot, { recursive: true, force: true });
				throw new Error("Body-photo operation cancelled");
			}
			const process = launch({
				runtime,
				bodyRoot: sources.bodyRoot,
				arguments: [
					"--state",
					stateRoot,
					"--instance",
					instance,
					"--parent-pid",
					String(globalThis.process.pid),
				],
				replyType: "ready",
			});
			host = process;
			let hostExited = false;
			const cleanup = process.closed.then(() => {
				hostExited = true;
				return fs.rm(stateRoot, { recursive: true, force: true });
			});
			hostCleanup.set(process, cleanup);
			void cleanup.finally(() => hostCleanup.delete(process)).catch(() => {});
			try {
				const reply = await process.reply;
				if (
					reply.instance !== instance ||
					!Number.isInteger(reply.port) ||
					Number(reply.port) < 1 ||
					Number(reply.port) > 65535
				)
					throw new Error(
						"Body-photo process returned invalid readiness identity"
					);
				const origin = `http://127.0.0.1:${reply.port}`;
				await verifyServer({ origin, instance });
				if (identity !== generation || disposed)
					throw new Error("Body-photo operation cancelled");
				const opened = await createWindow({
					origin,
					parent,
					show,
					onClosed: () => {
						if (host !== process) return;
						window = undefined;
						host = undefined;
						releaseOwner();
						generation += 1;
						void stopProcesses({ targets: [process] }).catch(() => {});
					},
				});
				if (identity !== generation || disposed || hostExited) {
					if (!opened.isDestroyed()) opened.destroy();
					throw new Error("Body-photo operation cancelled");
				}
				window = opened;
				void process.closed.then(() => {
					if (host === process) {
						invalidateReadiness();
						host = undefined;
						releaseOwner();
						generation += 1;
						void stopProcesses({ targets: [process] }).catch(() => {});
					}
					if (window === opened) {
						window = undefined;
						if (!opened.isDestroyed()) opened.destroy();
					}
				});
				return { opened: true as const };
			} catch (error) {
				if (host === process) host = undefined;
				await stopProcesses({ targets: [process] });
				throw error;
			}
		})().catch((error) => {
			invalidateReadiness();
			throw error;
		});
		void opening
			.finally(() => {
				opening = undefined;
				if (!window) releaseOwner();
			})
			.catch(() => {});
		return opening;
	}

	async function selectRuntime({
		selection,
	}: {
		selection: string;
	}): Promise<BodyPhotoLabStatus> {
		if (
			environment.QCUT_BODY_PHOTO_RUNTIME ||
			environment.QCUT_BODY_PHOTO_PYTHON
		)
			throw new Error(
				"Clear the body-photo environment overrides before choosing a local runtime"
			);
		invalidateReadiness();
		await close();
		const { runtime } = await verifyRuntime({ selection });
		await saveBodyPhotoSelection({
			settingsPath,
			bundleRoot: runtime.bundleRoot,
		});
		return inspect();
	}

	async function dispose() {
		if (disposed) return;
		disposed = true;
		await close();
		await sourcePreparation?.catch(() => {});
		await opening?.catch(() => {});
		if (sessionRoot) await fs.rm(sessionRoot, { recursive: true, force: true });
	}
	return { inspect, open, close, selectRuntime, dispose };
}
