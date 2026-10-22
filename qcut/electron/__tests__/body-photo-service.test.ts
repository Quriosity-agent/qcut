import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
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
	await Promise.all(services.splice(0).map((service) => service.dispose()));
	await fs.rm(root, { recursive: true, force: true });
});

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
								verified: verification,
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
	const service = createBodyPhotoLabService({
		getMainWindow: () => null,
		sourceRoot: root,
		resourcesPath: root,
		userDataPath: path.join(root, "userdata"),
		isPackaged: false,
		environment: environmentOverride
			? {
					QCUT_BODY_PHOTO_RUNTIME: missingRuntime
						? path.join(root, "missing")
						: root,
				}
			: {},
		platform: "darwin",
		stageSources,
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
});
