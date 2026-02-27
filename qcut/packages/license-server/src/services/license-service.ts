import { eq, and } from "drizzle-orm";
import { db } from "@qcut/db";
import { licenses, deviceActivations } from "@qcut/db/schema";

export async function getLicenseByUserId(userId: string) {
  const [license] = await db
    .select()
    .from(licenses)
    .where(eq(licenses.userId, userId))
    .limit(1);

  if (!license) {
    return createLicense(userId, "free");
  }
  return license;
}

export async function createLicense(userId: string, plan: string) {
  const maxDevices = plan === "team" ? 10 : plan === "pro" ? 3 : 1;
  const [license] = await db
    .insert(licenses)
    .values({
      userId,
      plan: plan as "free" | "pro" | "team",
      status: "active",
      maxDevices,
    })
    .returning();
  return license;
}

export async function updateLicense(licenseId: string, updates: Partial<typeof licenses.$inferInsert>) {
  const [updated] = await db
    .update(licenses)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(licenses.id, licenseId))
    .returning();
  return updated;
}

export async function activateDevice(licenseId: string, fingerprint: string, name: string) {
  const canActivate = await checkDeviceLimit(licenseId);
  if (!canActivate) {
    throw new Error("Device limit reached");
  }

  // Check if device already exists
  const [existing] = await db
    .select()
    .from(deviceActivations)
    .where(
      and(
        eq(deviceActivations.licenseId, licenseId),
        eq(deviceActivations.deviceFingerprint, fingerprint)
      )
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(deviceActivations)
      .set({ isActive: true, lastSeenAt: new Date(), deviceName: name })
      .where(eq(deviceActivations.id, existing.id))
      .returning();
    return updated;
  }

  const [activation] = await db
    .insert(deviceActivations)
    .values({ licenseId, deviceFingerprint: fingerprint, deviceName: name })
    .returning();
  return activation;
}

export async function deactivateDevice(activationId: string) {
  const [updated] = await db
    .update(deviceActivations)
    .set({ isActive: false })
    .where(eq(deviceActivations.id, activationId))
    .returning();
  return updated;
}

export async function getActiveDevices(licenseId: string) {
  return db
    .select()
    .from(deviceActivations)
    .where(
      and(
        eq(deviceActivations.licenseId, licenseId),
        eq(deviceActivations.isActive, true)
      )
    );
}

export async function checkDeviceLimit(licenseId: string): Promise<boolean> {
  const [license] = await db
    .select()
    .from(licenses)
    .where(eq(licenses.id, licenseId))
    .limit(1);

  if (!license) return false;

  const activeDevices = await getActiveDevices(licenseId);
  return activeDevices.length < license.maxDevices;
}
