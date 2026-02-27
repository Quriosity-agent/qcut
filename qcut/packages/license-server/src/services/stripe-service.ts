import Stripe from "stripe";
import { getLicenseByUserId, updateLicense } from "./license-service";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const PRICE_IDS: Record<string, string> = {
	pro_month: process.env.STRIPE_PRO_MONTHLY_PRICE_ID!,
	pro_year: process.env.STRIPE_PRO_YEARLY_PRICE_ID!,
	team_month: process.env.STRIPE_TEAM_MONTHLY_PRICE_ID!,
	team_year: process.env.STRIPE_TEAM_YEARLY_PRICE_ID!,
};

export async function createCheckoutSession(
	userId: string,
	plan: "pro" | "team",
	interval: "month" | "year"
) {
	const priceId = PRICE_IDS[`${plan}_${interval}`];
	if (!priceId) throw new Error(`Invalid plan/interval: ${plan}/${interval}`);

	const session = await stripe.checkout.sessions.create({
		mode: "subscription",
		payment_method_types: ["card"],
		line_items: [{ price: priceId, quantity: 1 }],
		success_url:
			"https://donghaozhang.github.io/nexusai-website/account/success.html?session_id={CHECKOUT_SESSION_ID}",
		cancel_url:
			"https://donghaozhang.github.io/nexusai-website/account/pricing.html",
		metadata: { userId, plan },
	});

	return session;
}

export async function createPortalSession(stripeCustomerId: string) {
	const session = await stripe.billingPortal.sessions.create({
		customer: stripeCustomerId,
		return_url:
			"https://donghaozhang.github.io/nexusai-website/account/dashboard.html",
	});
	return session;
}

export async function handleWebhook(body: string, signature: string) {
	const event = stripe.webhooks.constructEvent(
		body,
		signature,
		process.env.STRIPE_WEBHOOK_SECRET!
	);

	switch (event.type) {
		case "checkout.session.completed": {
			const session = event.data.object as Stripe.Checkout.Session;
			const userId = session.metadata?.userId;
			const plan = session.metadata?.plan as "pro" | "team";
			if (!userId || !plan) break;

			const license = await getLicenseByUserId(userId);
			const maxDevices = plan === "team" ? 10 : 3;

			await updateLicense(license.id, {
				plan,
				status: "active",
				stripeCustomerId: session.customer as string,
				stripeSubscriptionId: session.subscription as string,
				maxDevices,
			});
			break;
		}

		case "customer.subscription.updated": {
			const subscription = event.data.object as Stripe.Subscription;
			const customerId = subscription.customer as string;
			// Find license by stripe customer ID and update period end
			// This is a simplified approach — production would use a DB lookup
			break;
		}

		case "customer.subscription.deleted": {
			const subscription = event.data.object as Stripe.Subscription;
			// Mark license as cancelled
			break;
		}

		case "invoice.payment_failed": {
			const invoice = event.data.object as Stripe.Invoice;
			// Mark license as past_due
			break;
		}
	}

	return { received: true };
}
