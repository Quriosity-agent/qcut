import { desc, eq } from "drizzle-orm";
import { db } from "@qcut/db";
import { creditBalances, creditTransactions, licenses } from "@qcut/db/schema";

const PLAN_CREDITS: Record<"free" | "pro" | "team", number> = {
	free: 50,
	pro: 500,
	team: 2000,
};

const TOP_UP_PACK_CREDITS: Record<
	"starter" | "standard" | "pro" | "mega",
	number
> = {
	starter: 50,
	standard: 120,
	pro: 350,
	mega: 800,
};

type Plan = keyof typeof PLAN_CREDITS;
type TopUpPack = keyof typeof TOP_UP_PACK_CREDITS;

type CreditBalanceRow = typeof creditBalances.$inferSelect;

type CreditTransactionType =
	| "plan_grant"
	| "top_up"
	| "deduction"
	| "refund"
	| "expiry";

export interface CreditBalanceInfo {
	planCredits: number;
	topUpCredits: number;
	totalCredits: number;
	planCreditsResetAt: string;
}

export interface CreditHistoryItem {
	id: string;
	type: CreditTransactionType;
	amount: number;
	balanceAfter: number;
	description: string | null;
	modelKey: string | null;
	stripePaymentId: string | null;
	createdAt: string;
}

function buildCreditBalanceInfo({
	balance,
}: {
	balance: Pick<
		CreditBalanceRow,
		"planCredits" | "topUpCredits" | "planCreditsResetAt"
	>;
}): CreditBalanceInfo {
	const planCredits = balance.planCredits;
	const topUpCredits = balance.topUpCredits;
	return {
		planCredits,
		topUpCredits,
		totalCredits: planCredits + topUpCredits,
		planCreditsResetAt: balance.planCreditsResetAt.toISOString(),
	};
}

function getNextResetAt({ now }: { now: Date }): Date {
	const nextResetAt = new Date(now);
	nextResetAt.setMonth(nextResetAt.getMonth() + 1);
	return nextResetAt;
}

function parsePlan({ plan }: { plan: string | null | undefined }): Plan {
	if (plan === "pro" || plan === "team") {
		return plan;
	}
	return "free";
}

async function getPlanByUserId({ userId }: { userId: string }): Promise<Plan> {
	try {
		const [license] = await db
			.select({ plan: licenses.plan })
			.from(licenses)
			.where(eq(licenses.userId, userId))
			.limit(1);
		return parsePlan({ plan: license?.plan });
	} catch (error) {
		throw new Error(
			`Failed to get plan for user ${userId}: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}

async function createInitialBalance({
	userId,
	plan,
}: {
	userId: string;
	plan: Plan;
}): Promise<CreditBalanceRow> {
	try {
		const now = new Date();
		const [balance] = await db
			.insert(creditBalances)
			.values({
				id: crypto.randomUUID(),
				userId,
				planCredits: PLAN_CREDITS[plan],
				topUpCredits: 0,
				planCreditsResetAt: getNextResetAt({ now }),
				updatedAt: now,
			})
			.returning();

		if (!balance) {
			throw new Error("Insert returned no balance row");
		}

		await db.insert(creditTransactions).values({
			id: crypto.randomUUID(),
			userId,
			type: "plan_grant",
			amount: PLAN_CREDITS[plan],
			balanceAfter: PLAN_CREDITS[plan],
			description: `Initial ${plan} plan credits`,
		});

		return balance;
	} catch (error) {
		throw new Error(
			`Failed to create initial balance for user ${userId}: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}

async function ensureCreditBalance({
	userId,
}: {
	userId: string;
}): Promise<CreditBalanceRow> {
	try {
		const [existing] = await db
			.select()
			.from(creditBalances)
			.where(eq(creditBalances.userId, userId))
			.limit(1);

		if (existing) {
			return existing;
		}

		const plan = await getPlanByUserId({ userId });
		return await createInitialBalance({ userId, plan });
	} catch (error) {
		throw new Error(
			`Failed to ensure credit balance for user ${userId}: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}

async function resetPlanCreditsIfDue({
	userId,
	balance,
}: {
	userId: string;
	balance: CreditBalanceRow;
}): Promise<CreditBalanceRow> {
	try {
		const now = new Date();
		if (balance.planCreditsResetAt > now) {
			return balance;
		}

		const plan = await getPlanByUserId({ userId });
		const refreshedPlanCredits = PLAN_CREDITS[plan];
		const [updated] = await db
			.update(creditBalances)
			.set({
				planCredits: refreshedPlanCredits,
				planCreditsResetAt: getNextResetAt({ now }),
				updatedAt: now,
			})
			.where(eq(creditBalances.id, balance.id))
			.returning();

		if (!updated) {
			throw new Error("Plan credit reset update returned no row");
		}

		await db.insert(creditTransactions).values({
			id: crypto.randomUUID(),
			userId,
			type: "plan_grant",
			amount: refreshedPlanCredits,
			balanceAfter: updated.planCredits + updated.topUpCredits,
			description: `${plan} monthly credit reset`,
		});

		return updated;
	} catch (error) {
		throw new Error(
			`Failed to reset plan credits for user ${userId}: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}

function validatePositiveAmount({ amount }: { amount: number }): void {
	if (!Number.isFinite(amount) || amount <= 0) {
		throw new Error("Credit amount must be a positive number");
	}
}

function sanitizeHistoryLimit({ limit }: { limit?: number }): number {
	if (!limit || !Number.isInteger(limit)) {
		return 50;
	}
	if (limit < 1) {
		return 1;
	}
	if (limit > 200) {
		return 200;
	}
	return limit;
}

export async function getCreditBalanceByUserId({
	userId,
}: {
	userId: string;
}): Promise<CreditBalanceInfo> {
	try {
		const balance = await ensureCreditBalance({ userId });
		const refreshed = await resetPlanCreditsIfDue({ userId, balance });
		return buildCreditBalanceInfo({ balance: refreshed });
	} catch (error) {
		throw new Error(
			`Failed to get credit balance for user ${userId}: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}

export async function deductCreditsForUser({
	userId,
	amount,
	modelKey,
	description,
}: {
	userId: string;
	amount: number;
	modelKey: string;
	description: string;
}): Promise<{ success: boolean; balance: CreditBalanceInfo }> {
	try {
		validatePositiveAmount({ amount });
		const balance = await ensureCreditBalance({ userId });
		const refreshed = await resetPlanCreditsIfDue({ userId, balance });

		const totalAvailable = refreshed.planCredits + refreshed.topUpCredits;
		if (totalAvailable < amount) {
			return {
				success: false,
				balance: buildCreditBalanceInfo({ balance: refreshed }),
			};
		}

		const planDeduction = Math.min(refreshed.planCredits, amount);
		const topUpDeduction = amount - planDeduction;
		const nextPlanCredits = refreshed.planCredits - planDeduction;
		const nextTopUpCredits = refreshed.topUpCredits - topUpDeduction;
		const now = new Date();

		const [updated] = await db
			.update(creditBalances)
			.set({
				planCredits: nextPlanCredits,
				topUpCredits: nextTopUpCredits,
				updatedAt: now,
			})
			.where(eq(creditBalances.id, refreshed.id))
			.returning();

		if (!updated) {
			throw new Error("Credit deduction update returned no row");
		}

		await db.insert(creditTransactions).values({
			id: crypto.randomUUID(),
			userId,
			type: "deduction",
			amount: -amount,
			balanceAfter: nextPlanCredits + nextTopUpCredits,
			description,
			modelKey,
		});

		return {
			success: true,
			balance: buildCreditBalanceInfo({ balance: updated }),
		};
	} catch (error) {
		throw new Error(
			`Failed to deduct credits for user ${userId}: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}

export async function listCreditHistoryByUserId({
	userId,
	limit,
}: {
	userId: string;
	limit?: number;
}): Promise<CreditHistoryItem[]> {
	try {
		const cappedLimit = sanitizeHistoryLimit({ limit });
		const rows = await db
			.select()
			.from(creditTransactions)
			.where(eq(creditTransactions.userId, userId))
			.orderBy(desc(creditTransactions.createdAt))
			.limit(cappedLimit);

		return rows.map((row) => ({
			id: row.id,
			type: row.type,
			amount: row.amount,
			balanceAfter: row.balanceAfter,
			description: row.description,
			modelKey: row.modelKey,
			stripePaymentId: row.stripePaymentId,
			createdAt: row.createdAt.toISOString(),
		}));
	} catch (error) {
		throw new Error(
			`Failed to list credit history for user ${userId}: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}

export async function addTopUpCreditsForUser({
	userId,
	credits,
	stripePaymentId,
	description,
}: {
	userId: string;
	credits: number;
	stripePaymentId?: string;
	description?: string;
}): Promise<CreditBalanceInfo> {
	try {
		validatePositiveAmount({ amount: credits });
		const balance = await ensureCreditBalance({ userId });
		const refreshed = await resetPlanCreditsIfDue({ userId, balance });
		const now = new Date();

		const [updated] = await db
			.update(creditBalances)
			.set({
				topUpCredits: refreshed.topUpCredits + credits,
				updatedAt: now,
			})
			.where(eq(creditBalances.id, refreshed.id))
			.returning();

		if (!updated) {
			throw new Error("Top-up update returned no row");
		}

		await db.insert(creditTransactions).values({
			id: crypto.randomUUID(),
			userId,
			type: "top_up",
			amount: credits,
			balanceAfter: updated.planCredits + updated.topUpCredits,
			description: description ?? "Credit top-up",
			stripePaymentId,
		});

		return buildCreditBalanceInfo({ balance: updated });
	} catch (error) {
		throw new Error(
			`Failed to top up credits for user ${userId}: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}

export async function addTopUpPackCreditsForUser({
	userId,
	pack,
	stripePaymentId,
}: {
	userId: string;
	pack: TopUpPack;
	stripePaymentId?: string;
}): Promise<CreditBalanceInfo> {
	try {
		const credits = TOP_UP_PACK_CREDITS[pack];
		if (!credits) {
			throw new Error(`Invalid top-up pack: ${pack}`);
		}

		return await addTopUpCreditsForUser({
			userId,
			credits,
			stripePaymentId,
			description: `${pack} credit pack`,
		});
	} catch (error) {
		throw new Error(
			`Failed to apply top-up pack for user ${userId}: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}

export async function resetPlanCreditsForUser({
	userId,
	plan,
	stripePaymentId,
	description,
}: {
	userId: string;
	plan?: Plan;
	stripePaymentId?: string;
	description?: string;
}): Promise<CreditBalanceInfo> {
	try {
		const resolvedPlan = plan ?? (await getPlanByUserId({ userId }));
		const refreshedPlanCredits = PLAN_CREDITS[resolvedPlan];
		const balance = await ensureCreditBalance({ userId });
		const now = new Date();

		const [updated] = await db
			.update(creditBalances)
			.set({
				planCredits: refreshedPlanCredits,
				planCreditsResetAt: getNextResetAt({ now }),
				updatedAt: now,
			})
			.where(eq(creditBalances.id, balance.id))
			.returning();

		if (!updated) {
			throw new Error("Plan credit refresh update returned no row");
		}

		await db.insert(creditTransactions).values({
			id: crypto.randomUUID(),
			userId,
			type: "plan_grant",
			amount: refreshedPlanCredits,
			balanceAfter: updated.planCredits + updated.topUpCredits,
			description:
				description ?? `${resolvedPlan} plan credits granted for new period`,
			stripePaymentId,
		});

		return buildCreditBalanceInfo({ balance: updated });
	} catch (error) {
		throw new Error(
			`Failed to reset plan credits for user ${userId}: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}

export async function downgradeToFreeCreditsForUser({
	userId,
	description,
}: {
	userId: string;
	description?: string;
}): Promise<CreditBalanceInfo> {
	try {
		const freeCredits = PLAN_CREDITS.free;
		const balance = await ensureCreditBalance({ userId });
		const now = new Date();
		const [updated] = await db
			.update(creditBalances)
			.set({
				planCredits: freeCredits,
				planCreditsResetAt: getNextResetAt({ now }),
				updatedAt: now,
			})
			.where(eq(creditBalances.id, balance.id))
			.returning();

		if (!updated) {
			throw new Error("Free-plan downgrade update returned no row");
		}

		await db.insert(creditTransactions).values({
			id: crypto.randomUUID(),
			userId,
			type: "expiry",
			amount: 0,
			balanceAfter: updated.planCredits + updated.topUpCredits,
			description: description ?? "Downgraded to free plan credits",
		});

		return buildCreditBalanceInfo({ balance: updated });
	} catch (error) {
		throw new Error(
			`Failed to downgrade credits for user ${userId}: ${error instanceof Error ? error.message : "Unknown error"}`
		);
	}
}

export function getTopUpPackCredits({ pack }: { pack: TopUpPack }): number {
	return TOP_UP_PACK_CREDITS[pack];
}

export function isTopUpPack(pack: string): pack is TopUpPack {
	return pack in TOP_UP_PACK_CREDITS;
}
