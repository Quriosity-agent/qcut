import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRouter } from "../claude/utils/http-router.js";

function send({
	port,
	method,
	path,
	body,
}: {
	port: number;
	method: string;
	path: string;
	body: string;
}): Promise<{ status: number; json: Record<string, unknown> }> {
	return new Promise((resolve, reject) => {
		const req = httpRequest(
			{
				host: "127.0.0.1",
				port,
				method,
				path,
				headers: { "Content-Type": "application/json" },
			},
			(res) => {
				let text = "";
				res.on("data", (chunk) => {
					text += chunk;
				});
				res.on("end", () =>
					resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) })
				);
			}
		);
		req.on("error", reject);
		req.end(body);
	});
}

/**
 * `element filter` used to die with ECONNRESET: a LUT cube pushed a single
 * element's PATCH past the 1 MB cap and the server destroyed the socket
 * instead of answering.
 */
describe("request body cap", () => {
	const router = createRouter();
	let received: unknown;
	router.post("/api/claude/small/:id", async (req) => {
		received = req.body;
		return { ok: true };
	});
	router.patch(
		"/api/claude/timeline/:projectId/elements/:elementId",
		async (req) => {
			received = req.body;
			return { ok: true };
		}
	);
	const server = createServer((req, res) => router.handle(req, res));
	let port = 0;
	beforeAll(async () => {
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve)
		);
		port = (server.address() as AddressInfo).port;
	});
	afterAll(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("answers an oversize body with 413 instead of dropping the connection", async () => {
		const big = JSON.stringify({ blob: "x".repeat(1024 * 1024 + 10) });
		const response = await send({
			port,
			method: "POST",
			path: "/api/claude/small/1",
			body: big,
		});
		expect(response.status).toBe(413);
		expect(response.json.error).toBe("Payload too large");
	});

	it("lets one element's PATCH carry a filter stack the size of a LUT cube", async () => {
		// A 33³ cube with full-precision values is well past the 1 MB default cap.
		const cube = {
			values: Array.from(
				{ length: 33 * 33 * 33 * 3 },
				(_, i) => i / 1000 + 0.123456789
			),
		};
		const body = JSON.stringify({
			filterStack: { enabled: true, effects: [{ color: { lut: { cube } } }] },
		});
		expect(body.length).toBeGreaterThan(1024 * 1024);
		const response = await send({
			port,
			method: "PATCH",
			path: "/api/claude/timeline/p/elements/e",
			body,
		});
		expect(response.status).toBe(200);
		expect((received as { filterStack: unknown }).filterStack).toBeDefined();
	});
});
