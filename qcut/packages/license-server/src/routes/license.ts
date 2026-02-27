import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import {
	getLicenseByUserId,
	activateDevice,
	deactivateDevice,
	getActiveDevices,
} from "../services/license-service";

const licenseRoutes = new Hono();

licenseRoutes.use("/*", authMiddleware);

licenseRoutes.get("/", async (c) => {
	const userId = c.get("userId") as string;
	const license = await getLicenseByUserId(userId);
	const devices = await getActiveDevices(license.id);
	return c.json({ license, devices });
});

licenseRoutes.post("/activate", async (c) => {
	const userId = c.get("userId") as string;
	const { deviceFingerprint, deviceName } = await c.req.json();

	if (!deviceFingerprint || !deviceName) {
		return c.json({ error: "deviceFingerprint and deviceName required" }, 400);
	}

	const license = await getLicenseByUserId(userId);
	try {
		const activation = await activateDevice(
			license.id,
			deviceFingerprint,
			deviceName
		);
		return c.json({ activation });
	} catch (err: any) {
		return c.json({ error: err.message }, 403);
	}
});

licenseRoutes.delete("/deactivate", async (c) => {
	const { deviceId } = await c.req.json();
	if (!deviceId) {
		return c.json({ error: "deviceId required" }, 400);
	}

	const device = await deactivateDevice(deviceId);
	return c.json({ device });
});

export { licenseRoutes };
