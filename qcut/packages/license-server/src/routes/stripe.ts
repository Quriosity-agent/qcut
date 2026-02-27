import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { getLicenseByUserId } from "../services/license-service";
import {
  createCheckoutSession,
  createPortalSession,
  handleWebhook,
} from "../services/stripe-service";

const stripeRoutes = new Hono();

stripeRoutes.post("/checkout", authMiddleware, async (c) => {
  const userId = c.get("userId") as string;
  const { plan, interval } = await c.req.json();

  if (!["pro", "team"].includes(plan) || !["month", "year"].includes(interval)) {
    return c.json({ error: "Invalid plan or interval" }, 400);
  }

  const session = await createCheckoutSession(userId, plan, interval);
  return c.json({ url: session.url });
});

stripeRoutes.post("/portal", authMiddleware, async (c) => {
  const userId = c.get("userId") as string;
  const license = await getLicenseByUserId(userId);

  if (!license.stripeCustomerId) {
    return c.json({ error: "No Stripe customer found" }, 400);
  }

  const session = await createPortalSession(license.stripeCustomerId);
  return c.json({ url: session.url });
});

stripeRoutes.post("/webhook", async (c) => {
  const body = await c.req.text();
  const signature = c.req.header("stripe-signature");

  if (!signature) {
    return c.json({ error: "Missing stripe-signature header" }, 400);
  }

  try {
    const result = await handleWebhook(body, signature);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

export { stripeRoutes };
