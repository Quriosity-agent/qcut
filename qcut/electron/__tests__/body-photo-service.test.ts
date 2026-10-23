import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBodyPhotoLabService } from "../body-photo/body-photo-service";
import type { BodyPhotoProcess } from "../body-photo/body-photo-process";
import { BODY_PHOTO_PROVIDER } from "../body-photo/body-photo-contract";

vi.mock("electron", () => ({ BrowserWindow: vi.fn(), session: {} }));

let root: string;
const services: ReturnType<typeof createBodyPhotoLabService>[] = [];
beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "body-photo-service-test-"));
	await Promise.all([
		fs.mkdir(path.join(root, "runtime", "body"), { recursive: true }),
		fs.mkdir(path.join(root, "runtime", "body-portable"), { recursive: true }),
		fs.mkdir(path.join(root, "body", ".venv", "bin"), { recursive: true }),
	]);
	await fs.writeFile(
		path.join(root, "body", ".venv", "bin", "python"),
		"fixture"
	);
});
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(services.splice(0).map((service) => service.dispose()));
	await fs.rm(root, { recursive: true, force: true });
});

function blockedVerification() {
	let reject = (_error: Error) => {};
	let exit = () => {};
	const closed = new Promise<void>((resolve) => {
		exit = resolve;
	});
	const reply = new Promise<Record<string, unknown>>(
		(_resolve, rejectReply) => {
			reject = rejectReply;
		}
	);
	const stop = vi.fn(async () => {
		reject(new Error("Body-photo operation cancelled"));
		exit();
	});
	return { reply, closed, stop, exit };
}

function fixture({
	invalidIdentity = false,
	verification = true,
	missingRuntime = false,
	environmentOverride = true,
	hostStopGate,
}: {
	invalidIdentity?: boolean;
	verification?: boolean;
	missingRuntime?: boolean;
	environmentOverride?: boolean;
	hostStopGate?: Promise<void>;
} = {}) {
	const hosts: Array<BodyPhotoProcess & { exit: () => void }> = [];
	const verificationResult = vi.fn(() => verification);
	const sourceManifest = { sha256: "a".repeat(64) };
	const verifySources = vi.fn(({ root: stagedRoot }: { root: string }) => ({
		root: stagedRoot,
		bodyRoot: path.join(stagedRoot, "body"),
		manifestSha256: sourceManifest.sha256,
		files: 107,
	}));
	const stageSources = vi.fn(
		({ destinationRoot }: { destinationRoot: string }) => ({
			root: destinationRoot,
			bodyRoot: path.join(destinationRoot, "body"),
			manifestSha256: "a".repeat(64),
			files: 107,
		})
	);
	const startProcess = vi.fn(
		({
			replyType,
			arguments: args,
		}: {
			replyType: "ready" | "verified";
			arguments: string[];
		}) => {
			let exit = () => {};
			const closed =
				replyType === "verified"
					? Promise.resolve()
					: new Promise<void>((resolve) => {
							exit = resolve;
						});
			const instance = args[args.indexOf("--instance") + 1];
			const process = {
				reply: Promise.resolve(
					replyType === "verified"
						? {
								type: "verified",
								verified: verificationResult(),
								onnxruntime: "1.22.1",
							}
						: {
								type: "ready",
								port: 54321,
								instance: invalidIdentity ? "foreign" : instance,
							}
				),
				closed,
				stop: vi.fn(async () => {
					if (replyType === "ready") await hostStopGate;
					exit();
				}),
				exit,
			};
			if (replyType === "ready") hosts.push(process);
			return process;
		}
	);
	const windows: Array<{
		isDestroyed: () => boolean;
		destroy: () => void;
		show: ReturnType<typeof vi.fn>;
		focus: ReturnType<typeof vi.fn>;
	}> = [];
	const createWindow = vi.fn(async ({ onClosed }: { onClosed: () => void }) => {
		let destroyed = false;
		const window = {
			isDestroyed: () => destroyed,
			show: vi.fn(),
			focus: vi.fn(),
			destroy: () => {
				if (destroyed) return;
				destroyed = true;
				onClosed();
			},
		};
		windows.push(window);
		return window as unknown as BrowserWindow;
	});
	const verifyServer = vi.fn(async () => {});
	const getMainWindow = vi.fn((): BrowserWindow | null => null);
	const environment: NodeJS.ProcessEnv = environmentOverride
		? {
				QCUT_BODY_PHOTO_RUNTIME: missingRuntime
					? path.join(root, "missing")
					: root,
			}
		: {};
	const service = createBodyPhotoLabService({
		getMainWindow,
		sourceRoot: root,
		resourcesPath: root,
		userDataPath: path.join(root, "userdata"),
		isPackaged: false,
		environment,
		platform: "darwin",
		stageSources,
		verifySources,
		startProcess,
		createWindow,
		verifyServer,
	});
	services.push(service);
	return {
		service,
		hosts,
		windows,
		createWindow,
		stageSources,
		startProcess,
		verifyServer,
		getMainWindow,
		environment,
		verificationResult,
		verifySources,
		sourceManifest,
	};
}

describe("body-photo dedicated service", () => {
	it("reports missing runtime without launching or borrowing the native/video provider", async () => {
		const { service, startProcess, createWindow } = fixture({
			missingRuntime: true,
		});
		expect(await service.inspect()).toMatchObject({
			available: false,
			runtimeConfigured: false,
			provider: BODY_PHOTO_PROVIDER,
		});
		expect(startProcess).not.toHaveBeenCalled();
		expect(createWindow).not.toHaveBeenCalled();
	});
	it("requires model/Python verification and does not open a window during inspection", async () => {
		const { service, createWindow, startProcess } = fixture();
		expect(await service.inspect()).toMatchObject({
			available: true,
			windowOpen: false,
			sourceManifestSha256: "a".repeat(64),
		});
		expect(createWindow).not.toHaveBeenCalled();
		expect(startProcess).toHaveBeenCalledWith(
			expect.objectContaining({
				replyType: "verified",
				arguments: expect.arrayContaining(["--verify"]),
			})
		);
	});
	it("uses only two verification processes across mount, focus, open and close status reads", async () => {
		const { service, startProcess, hosts, verifySources } = fixture();
		await Promise.all([
			service.inspect(),
			service.inspect(),
			service.inspect(),
		]);
		await service.inspect();
		expect(startProcess).toHaveBeenCalledTimes(1);
		await service.open();
		expect(await service.inspect()).toMatchObject({ windowOpen: true });
		await service.close();
		expect(await service.inspect()).toMatchObject({ windowOpen: false });
		expect(
			startProcess.mock.calls.filter(([call]) => call.replyType === "verified")
		).toHaveLength(2);
		expect(hosts).toHaveLength(1);
		expect(verifySources).toHaveBeenCalledTimes(7);
	});
	it("expires UI readiness without extending it on status reads", async () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
		const { service, startProcess } = fixture();
		await service.inspect();
		now.mockReturnValue(30_999);
		await service.inspect();
		expect(startProcess).toHaveBeenCalledTimes(1);
		now.mockReturnValue(31_000);
		await service.inspect();
		expect(startProcess).toHaveBeenCalledTimes(2);
	});
	it("keys UI readiness to the resolved runtime, interpreter and source manifest", async () => {
		const { service, environment, sourceManifest, startProcess } = fixture();
		await service.inspect();
		const other = path.join(root, "other");
		await Promise.all([
			fs.mkdir(path.join(other, "runtime", "body"), { recursive: true }),
			fs.mkdir(path.join(other, "runtime", "body-portable"), {
				recursive: true,
			}),
			fs.mkdir(path.join(other, "body", ".venv", "bin"), { recursive: true }),
		]);
		await fs.writeFile(
			path.join(other, "body", ".venv", "bin", "python"),
			"other"
		);
		environment.QCUT_BODY_PHOTO_RUNTIME = other;
		await service.inspect();
		expect(startProcess).toHaveBeenCalledTimes(2);
		const python = path.join(root, "alternate-python");
		await fs.writeFile(python, "python-v1");
		environment.QCUT_BODY_PHOTO_PYTHON = python;
		await service.inspect();
		expect(startProcess).toHaveBeenCalledTimes(3);
		await fs.writeFile(python, "replaced-python-v2");
		await service.inspect();
		expect(startProcess).toHaveBeenCalledTimes(4);
		sourceManifest.sha256 = "b".repeat(64);
		expect(await service.inspect()).toMatchObject({
			sourceManifestSha256: sourceManifest.sha256,
		});
		expect(startProcess).toHaveBeenCalledTimes(5);
	});
	it("retries failed checks and never uses UI readiness to authorize changed models", async () => {
		const { service, startProcess, verificationResult, hosts } = fixture({
			verification: false,
		});
		expect(await service.inspect()).toMatchObject({ available: false });
		verificationResult.mockReturnValue(true);
		expect(await service.inspect()).toMatchObject({ available: true });
		expect(startProcess).toHaveBeenCalledTimes(2);
		verificationResult.mockReturnValue(false);
		await expect(service.open()).rejects.toThrow("verification");
		expect(hosts).toHaveLength(0);
		expect(await service.inspect()).toMatchObject({ available: false });
		expect(startProcess).toHaveBeenCalledTimes(4);
	});
	it("rechecks staged source integrity before open despite cached readiness", async () => {
		const { service, verifySources, hosts, startProcess } = fixture();
		await service.inspect();
		verifySources.mockImplementationOnce(() => {
			throw new Error("Body photo source integrity failed");
		});
		await expect(service.open()).rejects.toThrow("source integrity");
		expect(hosts).toHaveLength(0);
		expect(startProcess).toHaveBeenCalledTimes(1);
		expect(await service.inspect()).toMatchObject({ available: true });
		expect(startProcess).toHaveBeenCalledTimes(2);
	});
	it("cancels an in-flight shared status verification and retries without stale readiness", async () => {
		const { service, startProcess } = fixture();
		const verification = blockedVerification();
		startProcess.mockReturnValueOnce(verification);
		const inspections = Promise.all([service.inspect(), service.inspect()]);
		await vi.waitFor(() => expect(startProcess).toHaveBeenCalledOnce());
		await service.close();
		expect(await inspections).toEqual([
			expect.objectContaining({
				available: false,
				message: expect.stringContaining("cancelled"),
			}),
			expect.objectContaining({
				available: false,
				message: expect.stringContaining("cancelled"),
			}),
		]);
		expect(verification.stop).toHaveBeenCalled();
		expect(await service.inspect()).toMatchObject({ available: true });
		expect(startProcess).toHaveBeenCalledTimes(2);
	});
	it("cancels the mandatory open verification even after a successful status check", async () => {
		const { service, startProcess, hosts, createWindow } = fixture();
		await service.inspect();
		const verification = blockedVerification();
		startProcess.mockReturnValueOnce(verification);
		const opening = service.open();
		const cancelled = expect(opening).rejects.toThrow("cancelled");
		await vi.waitFor(() => expect(startProcess).toHaveBeenCalledTimes(2));
		await service.close();
		await cancelled;
		expect(hosts).toHaveLength(0);
		expect(createWindow).not.toHaveBeenCalled();
		expect(await service.inspect()).toMatchObject({ available: true });
		expect(startProcess).toHaveBeenCalledTimes(3);
	});
	it("invalidates readiness when an interpreter symlink resolves to a different executable", async () => {
		const { service, environment, startProcess } = fixture();
		const linkedDirectory = path.join(root, "python-current");
		const otherDirectory = path.join(root, "other-interpreter");
		await fs.mkdir(otherDirectory);
		await fs.writeFile(
			path.join(otherDirectory, "python"),
			"other-interpreter"
		);
		const linkType = process.platform === "win32" ? "junction" : "dir";
		await fs.symlink(
			path.join(root, "body", ".venv", "bin"),
			linkedDirectory,
			linkType
		);
		environment.QCUT_BODY_PHOTO_PYTHON = path.join(linkedDirectory, "python");
		await service.inspect();
		await fs.unlink(linkedDirectory);
		await fs.symlink(otherDirectory, linkedDirectory, linkType);
		await service.inspect();
		expect(startProcess).toHaveBeenCalledTimes(2);
	});

	it("invalidates UI readiness after unexpected host exit or readiness failure", async () => {
		const { service, hosts, startProcess, verifyServer } = fixture();
		await service.open();
		await service.inspect();
		expect(startProcess).toHaveBeenCalledTimes(2);
		hosts[0].exit();
		await Promise.resolve();
		expect(await service.inspect()).toMatchObject({
			available: true,
			windowOpen: false,
		});
		expect(startProcess).toHaveBeenCalledTimes(3);
		verifyServer.mockRejectedValueOnce(new Error("identity failed"));
		await expect(service.open()).rejects.toThrow("identity failed");
		await service.inspect();
		expect(startProcess).toHaveBeenCalledTimes(6);
	});

	it("serializes simultaneous opens and reuses only its own live window", async () => {
		const { service, hosts, windows, createWindow, verifyServer } = fixture();
		await Promise.all([service.open(), service.open()]);
		await service.open();
		expect(hosts).toHaveLength(1);
		expect(createWindow).toHaveBeenCalledOnce();
		expect(verifyServer).toHaveBeenCalledWith({
			origin: "http://127.0.0.1:54321",
			instance: expect.stringMatching(/^[a-f0-9]{32}$/),
		});
		expect(windows[0].focus).toHaveBeenCalledOnce();
		await service.close();
		expect(windows[0].isDestroyed()).toBe(true);
		expect(hosts[0].stop).toHaveBeenCalled();
	});
	it("refuses an unverified runtime or a foreign readiness identity", async () => {
		const invalidRuntime = fixture({ verification: false });
		await expect(invalidRuntime.service.open()).rejects.toThrow("verification");
		expect(invalidRuntime.createWindow).not.toHaveBeenCalled();
		const invalidHost = fixture({ invalidIdentity: true });
		await expect(invalidHost.service.open()).rejects.toThrow(
			"readiness identity"
		);
		expect(invalidHost.createWindow).not.toHaveBeenCalled();
		expect(invalidHost.hosts[0].stop).toHaveBeenCalledOnce();
	});
	it("restarts after host death and removes only its own staged session on disposal", async () => {
		const { service, hosts, windows, stageSources } = fixture();
		await fs.writeFile(
			path.join(root, "preserved"),
			"external runtime is user owned"
		);
		await service.open();
		hosts[0].exit();
		await Promise.resolve();
		expect(windows[0].isDestroyed()).toBe(true);
		await service.open();
		expect(hosts).toHaveLength(2);
		const session = path.dirname(stageSources.mock.calls[0][0].destinationRoot);
		await service.dispose();
		await expect(fs.stat(session)).rejects.toThrow();
		expect(await fs.readFile(path.join(root, "preserved"), "utf8")).toBe(
			"external runtime is user owned"
		);
		await expect(service.open()).rejects.toThrow("shutting down");
	});
	it("cancels an opening operation before it can create a server or window", async () => {
		const { service, hosts, createWindow } = fixture();
		const opening = service.open();
		await service.close();
		await expect(opening).rejects.toThrow("cancelled");
		expect(hosts).toHaveLength(0);
		expect(createWindow).not.toHaveBeenCalled();
		await expect(service.open()).resolves.toEqual({ opened: true });
	});
	it("persists a verified local choice and does not persist an invalid one", async () => {
		const selected = fixture({ environmentOverride: false });
		expect(await selected.service.inspect()).toMatchObject({
			available: false,
		});
		expect(
			await selected.service.selectRuntime({ selection: root })
		).toMatchObject({ available: true });
		expect(selected.startProcess).toHaveBeenCalledOnce();
		await selected.service.selectRuntime({ selection: root });
		expect(selected.startProcess).toHaveBeenCalledTimes(2);
		const settings = path.join(root, "userdata", "body-photo-runtime.json");
		const original = await fs.readFile(settings, "utf8");
		expect(JSON.parse(original)).toMatchObject({
			bundleRoot: await fs.realpath(root),
		});
		const invalid = fixture({
			environmentOverride: false,
			verification: false,
		});
		await expect(
			invalid.service.selectRuntime({ selection: root })
		).rejects.toThrow("verification");
		expect(await fs.readFile(settings, "utf8")).toBe(original);
	});
	it.each([
		"window-close",
		"host-crash",
	] as const)("waits for old host cleanup before reopening after %s", async (trigger) => {
		let release = () => {};
		const hostStopGate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { service, hosts, windows, createWindow } = fixture({ hostStopGate });
		await service.open();
		if (trigger === "window-close") windows[0].destroy();
		else {
			hosts[0].exit();
			await Promise.resolve();
		}
		const reopening = service.open();
		const observed = await Promise.race([
			reopening.then(() => "opened"),
			new Promise<string>((resolve) =>
				setTimeout(() => resolve("waiting"), 30)
			),
		]);
		expect(observed).toBe("waiting");
		expect(hosts).toHaveLength(1);
		expect(createWindow).toHaveBeenCalledOnce();
		release();
		await expect(reopening).resolves.toEqual({ opened: true });
		expect(hosts).toHaveLength(2);
		await service.close();
	});
	it("cancels a reopen that is still waiting for previous host cleanup", async () => {
		let release = () => {};
		const hostStopGate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { service, hosts, windows } = fixture({ hostStopGate });
		await service.open();
		windows[0].destroy();
		const reopening = service.open();
		const cancelled = expect(reopening).rejects.toThrow("cancelled");
		const closing = service.close();
		release();
		await closing;
		await cancelled;
		expect(hosts).toHaveLength(1);
	});
	it("does not launch a host when cancelled while creating its state directory", async () => {
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const mkdtemp = fs.mkdtemp.bind(fs);
		let stateRoot: string | undefined;
		vi.spyOn(fs, "mkdtemp").mockImplementation(async (...args) => {
			const created = await mkdtemp(...args);
			if (String(args[0]).includes("state-")) {
				stateRoot = created as string;
				await gate;
			}
			return created;
		});
		const { service, hosts, createWindow } = fixture();
		const opening = service.open();
		const cancelled = expect(opening).rejects.toThrow("cancelled");
		await vi.waitFor(() => expect(stateRoot).toBeDefined());
		await service.close();
		release();
		await cancelled;
		expect(hosts).toHaveLength(0);
		expect(createWindow).not.toHaveBeenCalled();
		await expect(fs.stat(stateRoot as string)).rejects.toThrow();
	});
	it.each([
		"opening",
		"open",
	] as const)("closes an %s laboratory when its main-window owner closes", async (phase) => {
		let destroyed = false;
		const owner = Object.assign(new EventEmitter(), {
			isDestroyed: () => destroyed,
		});
		const { service, getMainWindow, hosts, windows, verifyServer } = fixture();
		getMainWindow.mockReturnValue(owner as unknown as BrowserWindow);
		let release = () => {};
		if (phase === "opening") {
			verifyServer.mockImplementationOnce(
				() =>
					new Promise<void>((resolve) => {
						release = resolve;
					})
			);
		}
		const opening = service.open();
		const outcome =
			phase === "opening"
				? expect(opening).rejects.toThrow("cancelled")
				: expect(opening).resolves.toEqual({ opened: true });
		await vi.waitFor(() => expect(verifyServer).toHaveBeenCalledOnce());
		if (phase === "open") await outcome;
		destroyed = true;
		getMainWindow.mockReturnValue(null);
		owner.emit("closed");
		release();
		await outcome;
		await vi.waitFor(() => expect(hosts[0].stop).toHaveBeenCalled());
		if (phase === "opening") expect(windows).toHaveLength(0);
		else expect(windows[0].isDestroyed()).toBe(true);
		expect(owner.listenerCount("closed")).toBe(0);
	});
});
