import { eq, and, gte, lte } from "drizzle-orm";
import { db } from "@qcut/db";
import { usageRecords, licenses } from "@qcut/db/schema";

const USAGE_LIMITS: Record<string, Record<string, number>> = {
  free: { ai_generation: 5, render: 10, export: Infinity },
  pro: { ai_generation: Infinity, render: Infinity, export: Infinity },
  team: { ai_generation: Infinity, render: Infinity, export: Infinity },
};

function getCurrentPeriod() {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return { periodStart, periodEnd };
}

export async function getUsage(licenseId: string) {
  const { periodStart, periodEnd } = getCurrentPeriod();

  const records = await db
    .select()
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.licenseId, licenseId),
        gte(usageRecords.periodStart, periodStart),
        lte(usageRecords.periodEnd, periodEnd)
      )
    );

  const usage: Record<string, number> = {
    ai_generation: 0,
    export: 0,
    render: 0,
  };

  for (const record of records) {
    usage[record.type] = (usage[record.type] || 0) + record.count;
  }

  return usage;
}

export async function trackUsage(
  licenseId: string,
  type: "ai_generation" | "export" | "render"
) {
  const { periodStart, periodEnd } = getCurrentPeriod();

  // Find existing record for this period
  const [existing] = await db
    .select()
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.licenseId, licenseId),
        eq(usageRecords.type, type),
        gte(usageRecords.periodStart, periodStart),
        lte(usageRecords.periodEnd, periodEnd)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(usageRecords)
      .set({ count: existing.count + 1 })
      .where(eq(usageRecords.id, existing.id));
  } else {
    await db.insert(usageRecords).values({
      licenseId,
      type,
      count: 1,
      periodStart,
      periodEnd,
    });
  }
}

export async function checkUsageLimit(
  licenseId: string,
  type: string
): Promise<boolean> {
  const [license] = await db
    .select()
    .from(licenses)
    .where(eq(licenses.id, licenseId))
    .limit(1);

  if (!license) return false;

  const limits = USAGE_LIMITS[license.plan] || USAGE_LIMITS.free;
  const limit = limits[type];
  if (limit === Infinity) return true;

  const usage = await getUsage(licenseId);
  return (usage[type] || 0) < limit;
}
