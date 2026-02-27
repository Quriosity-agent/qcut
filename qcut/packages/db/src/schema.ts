import { pgTable, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").default(false).notNull(),
	image: text("image"),
	createdAt: timestamp("created_at")
		.$defaultFn(() => /* @__PURE__ */ new Date())
		.notNull(),
	updatedAt: timestamp("updated_at")
		.$defaultFn(() => /* @__PURE__ */ new Date())
		.notNull(),
}).enableRLS();

export const sessions = pgTable("sessions", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expires_at").notNull(),
	token: text("token").notNull().unique(),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
}).enableRLS();

export const accounts = pgTable("accounts", {
	id: text("id").primaryKey(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at"),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
	scope: text("scope"),
	password: text("password"),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
}).enableRLS();

export const verifications = pgTable("verifications", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at").notNull(),
	createdAt: timestamp("created_at").$defaultFn(
		() => /* @__PURE__ */ new Date()
	),
	updatedAt: timestamp("updated_at").$defaultFn(
		() => /* @__PURE__ */ new Date()
	),
}).enableRLS();

export const waitlist = pgTable("waitlist", {
	id: text("id").primaryKey(),
	email: text("email").notNull().unique(),
	createdAt: timestamp("created_at")
		.$defaultFn(() => /* @__PURE__ */ new Date())
		.notNull(),
}).enableRLS();

// License & Payment tables

export const licenses = pgTable("licenses", {
	id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
	userId: text("user_id").notNull(),
	plan: text("plan", { enum: ["free", "pro", "team"] }).notNull().default("free"),
	status: text("status", { enum: ["active", "past_due", "cancelled", "expired"] }).notNull().default("active"),
	stripeCustomerId: text("stripe_customer_id"),
	stripeSubscriptionId: text("stripe_subscription_id"),
	currentPeriodEnd: timestamp("current_period_end"),
	maxDevices: integer("max_devices").notNull().default(1),
	createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
	updatedAt: timestamp("updated_at").$defaultFn(() => new Date()).notNull(),
}).enableRLS();

export const deviceActivations = pgTable("device_activations", {
	id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
	licenseId: text("license_id").notNull(),
	deviceFingerprint: text("device_fingerprint").notNull(),
	deviceName: text("device_name").notNull(),
	lastSeenAt: timestamp("last_seen_at").$defaultFn(() => new Date()).notNull(),
	isActive: boolean("is_active").notNull().default(true),
}).enableRLS();

export const usageRecords = pgTable("usage_records", {
	id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
	licenseId: text("license_id").notNull(),
	type: text("type", { enum: ["ai_generation", "export", "render"] }).notNull(),
	count: integer("count").notNull().default(0),
	periodStart: timestamp("period_start").notNull(),
	periodEnd: timestamp("period_end").notNull(),
}).enableRLS();
