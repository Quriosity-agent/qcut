import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { getLicenseByUserId } from "../services/license-service";
import {
	checkUsageLimit,
	getUsage,
	trackUsage,
} from "../services/usage-service";

const usageRoutes = new Hono();

usageRoutes.use("/*", authMiddleware);

usageRoutes.get("/", async (c) => {
	try {
		const userId = c.get("userId") as string;
		const license = await getLicenseByUserId({ userId });
		const usage = await getUsage({ licenseId: license.id });
		return c.json({ usage });
	} catch (error) {
		return c.json(
			{
				error: error instanceof Error ? error.message : "Failed to read usage",
			},
			500
		);
	}
});

usageRoutes.post("/track", async (c) => {
	try {
		const userId = c.get("userId") as string;
		const payload = await c.req.json();
		const type = typeof payload?.type === "string" ? payload.type.trim() : "";

		if (!type || !["ai_generation", "export", "render"].includes(type)) {
			return c.json({ error: "Invalid usage type" }, 400);
		}

		const license = await getLicenseByUserId({ userId });
		const withinLimit = await checkUsageLimit({ licenseId: license.id, type });
		if (!withinLimit) {
			return c.json(
				{ error: "Usage limit reached", upgradeRequired: true },
				403
			);
		}

		await trackUsage({
			licenseId: license.id,
			type: type as "ai_generation" | "export" | "render",
		});
		return c.json({ success: true });
	} catch (error) {
		return c.json(
			{
				error: error instanceof Error ? error.message : "Failed to track usage",
			},
			500
		);
	}
});

export { usageRoutes };
