import { Hono } from "hono";
import { cors } from "hono/cors";
import { licenseRoutes } from "./routes/license";
import { usageRoutes } from "./routes/usage";
import { stripeRoutes } from "./routes/stripe";

const app = new Hono();

app.use("/*", cors({
  origin: ["https://donghaozhang.github.io", "http://localhost:3000", "app://qcut"],
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

app.get("/", (c) => c.json({ status: "ok", service: "qcut-license-server" }));
app.get("/health", (c) => c.json({ status: "healthy", timestamp: new Date().toISOString() }));

app.route("/api/license", licenseRoutes);
app.route("/api/usage", usageRoutes);
app.route("/api/stripe", stripeRoutes);

export default app;
