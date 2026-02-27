import { Context, Next } from "hono";

export async function authMiddleware(c: Context, next: Next) {
	const authHeader = c.req.header("Authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		return c.json({ error: "Unauthorized" }, 401);
	}

	const token = authHeader.slice(7);

	try {
		// TODO: Verify token with BetterAuth session endpoint
		// For now, decode JWT payload (not secure for production)
		const payload = JSON.parse(atob(token.split(".")[1]));
		c.set("userId", payload.sub || payload.userId);
		await next();
	} catch {
		return c.json({ error: "Invalid token" }, 401);
	}
}
