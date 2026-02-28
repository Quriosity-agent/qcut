import { NextResponse, type NextRequest } from "next/server";
import { setLabel, getLabel } from "@/lib/session-labels";

/** PATCH /api/sessions/[id]/label — Set or clear a session label */
export async function PATCH(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params;
		const body = (await request.json()) as { label?: string | null };
		const label =
			typeof body.label === "string" && body.label.trim()
				? body.label.trim()
				: null;

		await setLabel(id, label);

		return NextResponse.json({ id, label });
	} catch (error) {
		return NextResponse.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to update label",
			},
			{ status: 500 }
		);
	}
}

/** GET /api/sessions/[id]/label — Get session label */
export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	return NextResponse.json({ id, label: await getLabel(id) });
}
