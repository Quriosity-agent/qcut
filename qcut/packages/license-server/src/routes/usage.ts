import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { getLicenseByUserId } from "../services/license-service";
import {
	getUsage,
	trackUsage,
	checkUsageLimit,
} from "../services/usage-service";

const usageRoutes = new Hono();

usageRoutes.use("/*", authMiddleware);

usageRoutes.get("/", async (c) => {
	const userId = c.get("userId") as string;
	const license = await getLicenseByUserId(userId);
	const usage = await getUsage(license.id);
	return c.json({ usage });
});

usageRoutes.post("/track", async (c) => {
	const userId = c.get("userId") as string;
	const { type } = await c.req.json();

	if (!["ai_generation", "export", "render"].includes(type)) {
		return c.json({ error: "Invalid usage type" }, 400);
	}

	const license = await getLicenseByUserId(userId);
	const withinLimit = await checkUsageLimit(license.id, type);
	if (!withinLimit) {
		return c.json({ error: "Usage limit reached", upgradeRequired: true }, 403);
	}

	await trackUsage(license.id, type);
	return c.json({ success: true });
});

export { usageRoutes };
