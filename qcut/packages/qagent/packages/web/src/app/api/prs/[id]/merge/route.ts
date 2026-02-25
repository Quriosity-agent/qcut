import { type NextRequest, NextResponse } from "next/server";
import { getServices, getSCM } from "@/lib/services";

/** POST /api/prs/:id/merge — Merge a PR */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Invalid PR number" }, { status: 400 });
  }
  const prNumber = Number(id);

  try {
    const { config, registry, sessionManager } = await getServices();
    const sessions = await sessionManager.list();

    const session = sessions.find((s) => s.pr?.number === prNumber);
    if (!session?.pr) {
      return NextResponse.json({ error: "PR not found" }, { status: 404 });
    }

    const project = config.projects[session.projectId];
    const scm = getSCM(registry, project);
    if (!scm) {
      return NextResponse.json(
        { error: "No SCM plugin configured for this project" },
        { status: 500 },
      );
    }

    // Validate PR is in a mergeable state
    const state = await scm.getPRState(session.pr);
    if (state !== "open") {
      return NextResponse.json({ error: `PR is ${state}, not open` }, { status: 409 });
    }

    const mergeability = await scm.getMergeability(session.pr);
    if (!mergeability.mergeable) {
      return NextResponse.json(
        { error: "PR is not mergeable", blockers: mergeability.blockers },
        { status: 422 },
      );
    }

    await scm.mergePR(session.pr, "squash");
    return NextResponse.json({ ok: true, prNumber, method: "squash" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to merge PR" },
      { status: 500 },
    );
  }
}
