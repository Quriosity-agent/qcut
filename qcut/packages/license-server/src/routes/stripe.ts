import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { getLicenseByUserId } from "../services/license-service";
import {
	createCheckoutSession,
	createPortalSession,
	createTopUpCheckoutSession,
	handleWebhook,
} from "../services/stripe-service";
import { isTopUpPack } from "../services/credit-service";

const stripeRoutes = new Hono();

stripeRoutes.post("/checkout", authMiddleware, async (c) => {
	try {
		const userId = c.get("userId") as string;
		const payload = await c.req.json();
		const plan = typeof payload?.plan === "string" ? payload.plan.trim() : "";
		const interval =
			typeof payload?.interval === "string" ? payload.interval.trim() : "";

		if (
			(plan !== "pro" && plan !== "team") ||
			(interval !== "month" && interval !== "year")
		) {
			return c.json({ error: "Invalid plan or interval" }, 400);
		}

		const session = await createCheckoutSession({
			userId,
			plan,
			interval,
		});
		return c.json({ url: session.url });
	} catch (error) {
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to create checkout session",
			},
			500
		);
	}
});

stripeRoutes.post("/topup", authMiddleware, async (c) => {
	try {
		const userId = c.get("userId") as string;
		const payload = await c.req.json();
		const pack = typeof payload?.pack === "string" ? payload.pack.trim() : "";

		if (!isTopUpPack(pack)) {
			return c.json({ error: "Invalid top-up pack" }, 400);
		}

		const session = await createTopUpCheckoutSession({ userId, pack });
		return c.json({ url: session.url });
	} catch (error) {
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to create top-up session",
			},
			500
		);
	}
});

stripeRoutes.post("/portal", authMiddleware, async (c) => {
	try {
		const userId = c.get("userId") as string;
		const license = await getLicenseByUserId({ userId });

		if (!license.stripeCustomerId) {
			return c.json({ error: "No Stripe customer found" }, 400);
		}

		const session = await createPortalSession({
			stripeCustomerId: license.stripeCustomerId,
		});
		return c.json({ url: session.url });
	} catch (error) {
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to create portal session",
			},
			500
		);
	}
});

stripeRoutes.post("/webhook", async (c) => {
	try {
		const body = await c.req.text();
		const signature = c.req.header("stripe-signature");

		if (!signature) {
			return c.json({ error: "Missing stripe-signature header" }, 400);
		}

		const result = await handleWebhook({ body, signature });
		return c.json(result);
	} catch (error) {
		return c.json(
			{
				error:
					error instanceof Error ? error.message : "Webhook processing failed",
			},
			400
		);
	}
});

export { stripeRoutes };
