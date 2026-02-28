import { eq, or, type SQL } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "@qcut/db";
import { licenses } from "@qcut/db/schema";
import {
	addTopUpPackCreditsForUser,
	downgradeToFreeCreditsForUser,
	isTopUpPack,
	resetPlanCreditsForUser,
} from "./credit-service";
import { getLicenseByUserId, updateLicense } from "./license-service";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

const SUBSCRIPTION_PRICE_IDS: Record<string, string> = {
	pro_month: process.env.STRIPE_PRO_MONTHLY_PRICE_ID || "",
	pro_year: process.env.STRIPE_PRO_YEARLY_PRICE_ID || "",
	team_month: process.env.STRIPE_TEAM_MONTHLY_PRICE_ID || "",
	team_year: process.env.STRIPE_TEAM_YEARLY_PRICE_ID || "",
};

const TOP_UP_PRICE_IDS: Record<string, string> = {
	starter: process.env.STRIPE_TOPUP_STARTER_PRICE_ID || "",
	standard: process.env.STRIPE_TOPUP_STANDARD_PRICE_ID || "",
	pro: process.env.STRIPE_TOPUP_PRO_PRICE_ID || "",
	mega: process.env.STRIPE_TOPUP_MEGA_PRICE_ID || "",
};

const SUBSCRIPTION_PRICE_TO_PLAN: Record<string, "pro" | "team"> = {
	[SUBSCRIPTION_PRICE_IDS.pro_month]: "pro",
	[SUBSCRIPTION_PRICE_IDS.pro_year]: "pro",
	[SUBSCRIPTION_PRICE_IDS.team_month]: "team",
	[SUBSCRIPTION_PRICE_IDS.team_year]: "team",
};

const SUBSCRIPTION_STATUS_TO_LICENSE: Record<
	Stripe.Subscription.Status,
	"active" | "past_due" | "cancelled" | "expired"
> = {
	active: "active",
	trialing: "active",
	past_due: "past_due",
	canceled: "cancelled",
	incomplete: "past_due",
	incomplete_expired: "expired",
	unpaid: "past_due",
	paused: "past_due",
};

function resolveLicenseStatus({
	status,
}: {
	status: Stripe.Subscription.Status;
}): "active" | "past_due" | "cancelled" | "expired" {
	return SUBSCRIPTION_STATUS_TO_LICENSE[status] ?? "past_due";
}

function resolvePlanFromPriceId({
	priceId,
}: {
	priceId?: string | null;
}): "pro" | "team" | null {
	if (!priceId) {
		return null;
	}
	return SUBSCRIPTION_PRICE_TO_PLAN[priceId] ?? null;
}

function getMaxDevicesForPlan({
	plan,
}: {
	plan: "free" | "pro" | "team";
}): number {
	if (plan === "team") {
		return 10;
	}
	if (plan === "pro") {
		return 3;
	}
	return 1;
}

function assertConfiguredPriceId({
	priceId,
	errorMessage,
}: {
	priceId: string;
	errorMessage: string;
}): void {
	if (priceId.length === 0) {
		throw new Error(errorMessage);
	}
}

async function findLicenseByStripeIds({
	customerId,
	subscriptionId,
}: {
	customerId?: string;
	subscriptionId?: string;
}): Promise<typeof licenses.$inferSelect | null> {
	try {
		if (!customerId && !subscriptionId) {
			return null;
		}

		const predicates: SQL[] = [];
		if (customerId) {
			predicates.push(eq(licenses.stripeCustomerId, customerId));
		}
		if (subscriptionId) {
			predicates.push(eq(licenses.stripeSubscriptionId, subscriptionId));
		}

		if (predicates.length === 0) {
			return null;
		}

		const [license] = await db
			.select()
			.from(licenses)
			.where(or(...predicates))
			.limit(1);

		return license ?? null;
	} catch (error) {
		throw new Error(
			`Failed to find license by Stripe IDs: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}

export async function createCheckoutSession({
	userId,
	plan,
	interval,
}: {
	userId: string;
	plan: "pro" | "team";
	interval: "month" | "year";
}): Promise<Stripe.Checkout.Session> {
	try {
		const priceId = SUBSCRIPTION_PRICE_IDS[`${plan}_${interval}`];
		assertConfiguredPriceId({
			priceId,
			errorMessage: `Missing Stripe price ID for ${plan}/${interval}`,
		});

		return await stripe.checkout.sessions.create({
			mode: "subscription",
			payment_method_types: ["card"],
			line_items: [{ price: priceId, quantity: 1 }],
			success_url:
				"https://donghaozhang.github.io/nexusai-website/account/success.html?session_id={CHECKOUT_SESSION_ID}",
			cancel_url:
				"https://donghaozhang.github.io/nexusai-website/account/pricing.html",
			metadata: {
				type: "subscription",
				userId,
				plan,
				interval,
			},
		});
	} catch (error) {
		throw new Error(
			`Failed to create subscription checkout session: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}

export async function createTopUpCheckoutSession({
	userId,
	pack,
}: {
	userId: string;
	pack: "starter" | "standard" | "pro" | "mega";
}): Promise<Stripe.Checkout.Session> {
	try {
		const priceId = TOP_UP_PRICE_IDS[pack];
		assertConfiguredPriceId({
			priceId,
			errorMessage: `Missing Stripe top-up price ID for pack ${pack}`,
		});

		return await stripe.checkout.sessions.create({
			mode: "payment",
			payment_method_types: ["card"],
			line_items: [{ price: priceId, quantity: 1 }],
			success_url:
				"https://donghaozhang.github.io/nexusai-website/account/success.html?session_id={CHECKOUT_SESSION_ID}&type=topup",
			cancel_url:
				"https://donghaozhang.github.io/nexusai-website/account/pricing.html#credits",
			metadata: {
				type: "topup",
				userId,
				pack,
			},
		});
	} catch (error) {
		throw new Error(
			`Failed to create top-up checkout session: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}

export async function createPortalSession({
	stripeCustomerId,
}: {
	stripeCustomerId: string;
}): Promise<Stripe.BillingPortal.Session> {
	try {
		return await stripe.billingPortal.sessions.create({
			customer: stripeCustomerId,
			return_url:
				"https://donghaozhang.github.io/nexusai-website/account/dashboard.html",
		});
	} catch (error) {
		throw new Error(
			`Failed to create portal session: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}

async function handleCheckoutCompleted({
	session,
}: {
	session: Stripe.Checkout.Session;
}): Promise<void> {
	try {
		const userId = session.metadata?.userId;
		const type = session.metadata?.type;
		if (!userId || !type) {
			return;
		}

		if (type === "topup") {
			const pack = session.metadata?.pack || "";
			if (!isTopUpPack(pack)) {
				throw new Error(`Invalid top-up pack metadata: ${pack}`);
			}
			await addTopUpPackCreditsForUser({
				userId,
				pack,
				stripePaymentId:
					typeof session.payment_intent === "string"
						? session.payment_intent
						: session.id,
			});
			return;
		}

		if (type === "subscription") {
			const plan = session.metadata?.plan;
			if (plan !== "pro" && plan !== "team") {
				throw new Error(`Invalid subscription plan metadata: ${plan}`);
			}

			const license = await getLicenseByUserId({ userId });
			await updateLicense({
				licenseId: license.id,
				updates: {
					plan,
					status: "active",
					stripeCustomerId:
						typeof session.customer === "string"
							? session.customer
							: license.stripeCustomerId,
					stripeSubscriptionId:
						typeof session.subscription === "string"
							? session.subscription
							: license.stripeSubscriptionId,
					maxDevices: getMaxDevicesForPlan({ plan }),
				},
			});

			await resetPlanCreditsForUser({
				userId,
				plan,
				stripePaymentId: session.id,
				description: `Subscription checkout completed (${plan})`,
			});
		}
	} catch (error) {
		throw new Error(
			`Failed to process checkout.session.completed webhook: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}

async function handleSubscriptionUpdated({
	subscription,
}: {
	subscription: Stripe.Subscription;
}): Promise<void> {
	try {
		const customerId =
			typeof subscription.customer === "string"
				? subscription.customer
				: undefined;
		const subscriptionId = subscription.id;
		const license = await findLicenseByStripeIds({
			customerId,
			subscriptionId,
		});
		if (!license) {
			return;
		}

		const priceId = subscription.items.data[0]?.price?.id;
		const inferredPlan = resolvePlanFromPriceId({ priceId }) ?? license.plan;
		const status = resolveLicenseStatus({ status: subscription.status });
		const currentPeriodEnd =
			typeof subscription.current_period_end === "number"
				? new Date(subscription.current_period_end * 1000)
				: license.currentPeriodEnd;

		await updateLicense({
			licenseId: license.id,
			updates: {
				plan: inferredPlan,
				status,
				currentPeriodEnd,
				maxDevices: getMaxDevicesForPlan({ plan: inferredPlan }),
				stripeCustomerId: customerId ?? license.stripeCustomerId,
				stripeSubscriptionId: subscriptionId,
			},
		});
	} catch (error) {
		throw new Error(
			`Failed to process customer.subscription.updated webhook: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}

async function handleSubscriptionDeleted({
	subscription,
}: {
	subscription: Stripe.Subscription;
}): Promise<void> {
	try {
		const customerId =
			typeof subscription.customer === "string"
				? subscription.customer
				: undefined;
		const license = await findLicenseByStripeIds({
			customerId,
			subscriptionId: subscription.id,
		});
		if (!license) {
			return;
		}

		await updateLicense({
			licenseId: license.id,
			updates: {
				plan: "free",
				status: "cancelled",
				maxDevices: 1,
				stripeSubscriptionId: null,
			},
		});

		await downgradeToFreeCreditsForUser({
			userId: license.userId,
			description: "Subscription cancelled - downgraded to free credits",
		});
	} catch (error) {
		throw new Error(
			`Failed to process customer.subscription.deleted webhook: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}

async function handleInvoicePaymentSucceeded({
	invoice,
}: {
	invoice: Stripe.Invoice;
}): Promise<void> {
	try {
		const subscriptionId =
			typeof invoice.subscription === "string"
				? invoice.subscription
				: undefined;
		const customerId =
			typeof invoice.customer === "string" ? invoice.customer : undefined;
		const license = await findLicenseByStripeIds({
			customerId,
			subscriptionId,
		});
		if (!license) {
			return;
		}

		await resetPlanCreditsForUser({
			userId: license.userId,
			plan: license.plan,
			stripePaymentId: invoice.id,
			description: "Monthly subscription renewal credits",
		});
	} catch (error) {
		throw new Error(
			`Failed to process invoice.payment_succeeded webhook: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}

async function handleInvoicePaymentFailed({
	invoice,
}: {
	invoice: Stripe.Invoice;
}): Promise<void> {
	try {
		const subscriptionId =
			typeof invoice.subscription === "string"
				? invoice.subscription
				: undefined;
		const customerId =
			typeof invoice.customer === "string" ? invoice.customer : undefined;
		const license = await findLicenseByStripeIds({
			customerId,
			subscriptionId,
		});
		if (!license) {
			return;
		}

		await updateLicense({
			licenseId: license.id,
			updates: { status: "past_due" },
		});
	} catch (error) {
		throw new Error(
			`Failed to process invoice.payment_failed webhook: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}

export async function handleWebhook({
	body,
	signature,
}: {
	body: string;
	signature: string;
}): Promise<{ received: true }> {
	try {
		const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
		if (!webhookSecret) {
			throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
		}

		const event = stripe.webhooks.constructEvent(
			body,
			signature,
			webhookSecret
		);

		switch (event.type) {
			case "checkout.session.completed":
				await handleCheckoutCompleted({
					session: event.data.object as Stripe.Checkout.Session,
				});
				break;
			case "customer.subscription.updated":
				await handleSubscriptionUpdated({
					subscription: event.data.object as Stripe.Subscription,
				});
				break;
			case "customer.subscription.deleted":
				await handleSubscriptionDeleted({
					subscription: event.data.object as Stripe.Subscription,
				});
				break;
			case "invoice.payment_succeeded":
				await handleInvoicePaymentSucceeded({
					invoice: event.data.object as Stripe.Invoice,
				});
				break;
			case "invoice.payment_failed":
				await handleInvoicePaymentFailed({
					invoice: event.data.object as Stripe.Invoice,
				});
				break;
			default:
				break;
		}

		return { received: true };
	} catch (error) {
		throw new Error(
			`Stripe webhook handling failed: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}
