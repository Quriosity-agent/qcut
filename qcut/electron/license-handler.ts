import { ipcMain, safeStorage, app, IpcMainInvokeEvent } from "electron";
import path from "path";
import fs from "fs";

const LICENSE_SERVER_URL = "https://qcut-license-server.workers.dev"; // TODO: update with real URL
const CACHE_FILE = "license-cache.enc";
const OFFLINE_GRACE_DAYS = 7;

interface LicenseInfo {
	plan: "free" | "pro" | "team";
	status: "active" | "past_due" | "cancelled" | "expired";
	currentPeriodEnd?: string;
	aiGenerationsUsed: number;
	aiGenerationsLimit: number;
	cachedAt?: number;
}

function getAuthToken(): string {
	// TODO: Get from BetterAuth session
	return "";
}

function getCachePath(): string {
	try {
		return path.join(app.getPath("userData"), CACHE_FILE);
	} catch {
		return path.join(process.cwd(), CACHE_FILE);
	}
}

function cacheLicense(license: LicenseInfo): void {
	try {
		const data = JSON.stringify({ ...license, cachedAt: Date.now() });
		const cachePath = getCachePath();
		if (safeStorage.isEncryptionAvailable()) {
			const encrypted = safeStorage.encryptString(data);
			fs.writeFileSync(cachePath, encrypted);
		} else {
			fs.writeFileSync(cachePath, data, { mode: 0o600 });
		}
	} catch (error) {
		console.error("[License] Failed to cache license:", error);
	}
}

function getCachedLicense(): LicenseInfo {
	const fallback: LicenseInfo = {
		plan: "free",
		status: "active",
		aiGenerationsUsed: 0,
		aiGenerationsLimit: 5,
	};
	const cachePath = getCachePath();
	if (!fs.existsSync(cachePath)) return fallback;

	try {
		const raw = fs.readFileSync(cachePath);
		let decrypted: string;

		if (safeStorage.isEncryptionAvailable()) {
			decrypted = safeStorage.decryptString(raw);
		} else {
			decrypted = raw.toString("utf-8");
		}

		const cached = JSON.parse(decrypted) as LicenseInfo;

		// Check if cache is too old
		const daysSinceCached =
			(Date.now() - (cached.cachedAt || 0)) / (1000 * 60 * 60 * 24);
		if (daysSinceCached > OFFLINE_GRACE_DAYS) {
			return fallback; // Downgrade to free
		}

		return cached;
	} catch {
		return fallback;
	}
}

function clearCachedLicense(): void {
	const cachePath = getCachePath();
	if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
}

export function setupLicenseIPC(): void {
	// license:check — validate license online, fallback to encrypted cache
	ipcMain.handle("license:check", async (): Promise<LicenseInfo> => {
		try {
			const response = await fetch(`${LICENSE_SERVER_URL}/api/license`, {
				headers: { Authorization: `Bearer ${getAuthToken()}` },
			});
			if (response.ok) {
				const data = await response.json();
				const license = data.license as LicenseInfo;
				cacheLicense(license);
				return license;
			}
		} catch {
			// Offline — use cache
		}
		return getCachedLicense();
	});

	// license:activate — handle qcut://activate?token=xxx
	ipcMain.handle(
		"license:activate",
		async (_event: IpcMainInvokeEvent, token: string): Promise<boolean> => {
			try {
				const response = await fetch(
					`${LICENSE_SERVER_URL}/api/license/activate`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${token}`,
						},
						body: JSON.stringify({
							deviceFingerprint: getDeviceFingerprint(),
							deviceName: getDeviceName(),
						}),
					}
				);
				if (response.ok) {
					const data = await response.json();
					cacheLicense(data.license);
					return true;
				}
			} catch {
				// Activation failed
			}
			return false;
		}
	);

	// license:track-usage
	ipcMain.handle(
		"license:track-usage",
		async (_event: IpcMainInvokeEvent, type: string): Promise<void> => {
			try {
				await fetch(`${LICENSE_SERVER_URL}/api/usage/track`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${getAuthToken()}`,
					},
					body: JSON.stringify({ type }),
				});
			} catch {
				// Queue for later if offline — TODO: implement offline queue
			}
		}
	);

	// license:deactivate
	ipcMain.handle("license:deactivate", async (): Promise<boolean> => {
		clearCachedLicense();
		return true;
	});
}

function getDeviceFingerprint(): string {
	// TODO: Generate a stable device fingerprint
	return `${process.platform}-${require("os").hostname()}`;
}

function getDeviceName(): string {
	return require("os").hostname();
}

module.exports = { setupLicenseIPC };
export type { LicenseInfo };
