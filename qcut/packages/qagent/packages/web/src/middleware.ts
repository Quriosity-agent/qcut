import { NextResponse, type NextRequest } from "next/server";

/**
 * Redirect bare numeric paths (e.g. /13) to /issue/13
 * so users can navigate by issue number directly.
 */
export function middleware(request: NextRequest) {
	const { pathname } = request.nextUrl;

	// Match bare numeric paths like /13, /123, etc.
	if (/^\/\d+$/.test(pathname)) {
		const url = request.nextUrl.clone();
		url.pathname = `/issue${pathname}`;
		return NextResponse.redirect(url);
	}

	return NextResponse.next();
}

export const config = {
	// Only run middleware on paths that could be issue numbers
	// Exclude API routes, static files, _next, etc.
	matcher: ["/((?!api|_next|favicon\\.ico|.*\\.).*)"],
};
