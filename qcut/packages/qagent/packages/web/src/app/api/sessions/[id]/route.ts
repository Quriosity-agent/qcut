import { listTmuxSessions } from "@composio/ao-core";
import { NextResponse, type NextRequest } from "next/server";
import { getServices, getSCM } from "@/lib/services";
import {
	sessionToDashboard,
	resolveProject,
	enrichSessionPR,
	enrichSessionsMetadata,
} from "@/lib/serialize";

export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params;
		const { config, registry, sessionManager } = await getServices();

		const coreSession = await sessionManager.get(id);
		if (!coreSession) {
			// Check if this is an unmanaged tmux session
			try {
				const tmuxSessions = await listTmuxSessions();
				const tmuxMatch = tmuxSessions.find((t) => t.name === id);
				if (tmuxMatch) {
					const now = new Date().toISOString();
					return NextResponse.json({
						id: tmuxMatch.name,
						projectId: "",
						status: "working",
						activity: null,
						branch: null,
						issueId: null,
						issueUrl: null,
						issueLabel: null,
						issueTitle: null,
						summary: null,
						summaryIsFallback: false,
						createdAt: tmuxMatch.created || now,
						lastActivityAt: tmuxMatch.created || now,
						pr: null,
						metadata: {
							windows: String(tmuxMatch.windows),
							attached: tmuxMatch.attached ? "true" : "false",
						},
						managed: false,
					});
				}
			} catch {
				// tmux unavailable - fall through to 404
			}
			return NextResponse.json({ error: "Session not found" }, { status: 404 });
		}

		const dashboardSession = sessionToDashboard(coreSession);

		// Enrich metadata (issue labels, agent summaries, issue titles)
		await enrichSessionsMetadata(
			[coreSession],
			[dashboardSession],
			config,
			registry
		);

		// Enrich PR — serve cache immediately, refresh in background if stale
		if (coreSession.pr) {
			const project = resolveProject(coreSession, config.projects);
			const scm = getSCM(registry, project);
			if (scm) {
				const cached = await enrichSessionPR(
					dashboardSession,
					scm,
					coreSession.pr,
					{ cacheOnly: true }
				);
				if (!cached) {
					// Nothing cached yet — block once to populate, then future calls use cache
					await enrichSessionPR(dashboardSession, scm, coreSession.pr);
				}
			}
		}

		return NextResponse.json(dashboardSession);
	} catch (error) {
		console.error("Failed to fetch session:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 }
		);
	}
}
