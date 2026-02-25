import { type NextRequest, NextResponse } from "next/server";
import { validateIdentifier } from "@/lib/validation";
import { getServices } from "@/lib/services";

/** POST /api/sessions/:id/kill — Kill a session */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idErr = validateIdentifier(id, "id");
  if (idErr) {
    return NextResponse.json({ error: idErr }, { status: 400 });
  }

  try {
    const { sessionManager } = await getServices();
    await sessionManager.kill(id);
    return NextResponse.json({ ok: true, sessionId: id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to kill session";
    const status = msg.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
