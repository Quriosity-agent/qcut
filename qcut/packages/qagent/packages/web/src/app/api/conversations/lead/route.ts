import { NextResponse } from "next/server";
import { readLeadConversation } from "@/lib/conversations";

export const dynamic = "force-dynamic";

function parseLimit({
	value,
}: {
	value: string | null;
}): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed)) return undefined;
	return parsed;
}

/** GET /api/conversations/lead — Read latest lead inbox conversation stream. */
export async function GET(request: Request): Promise<NextResponse> {
	try {
		const { searchParams } = new URL(request.url);
		const teamId = searchParams.get("team")?.trim() || undefined;
		const rootDir = searchParams.get("root")?.trim() || undefined;
		const limit = parseLimit({ value: searchParams.get("limit") });
		const snapshot = await readLeadConversation({
			teamId,
			rootDir,
			limit,
		});
		return NextResponse.json(snapshot);
	} catch (error) {
		return NextResponse.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to load lead conversation",
			},
			{ status: 500 },
		);
	}
}
