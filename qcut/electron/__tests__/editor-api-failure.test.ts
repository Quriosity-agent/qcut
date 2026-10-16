import { describe, expect, it } from "vitest";
import { describeRequestFailure } from "../native-pipeline/editor/editor-api-failure.js";

/** The message for a request that never got an answer, by what went wrong. */
describe("describeRequestFailure", () => {
	const baseUrl = "http://127.0.0.1:8765";
	const url = `${baseUrl}/api/claude/mix/p/loudness`;
	const fetchFailed = (code: string) =>
		Object.assign(new Error("fetch failed"), {
			cause: Object.assign(new Error(code), { code }),
		});

	it("says QCut is not listening only when the connection is refused", () => {
		expect(
			describeRequestFailure({
				error: fetchFailed("ECONNREFUSED"),
				url,
				baseUrl,
			})
		).toBe(`Cannot connect to QCut at ${baseUrl}`);
	});

	it("says the connection dropped when QCut closed it mid-request", () => {
		expect(
			describeRequestFailure({ error: fetchFailed("ECONNRESET"), url, baseUrl })
		).toBe(
			`QCut closed the connection to ${url} before answering (ECONNRESET); the work may still be running in the app`
		);
		expect(
			describeRequestFailure({
				error: fetchFailed("UND_ERR_SOCKET"),
				url,
				baseUrl,
			})
		).toContain("closed the connection");
	});

	it("treats a connection that never opened as not reachable, not as dropped", () => {
		expect(
			describeRequestFailure({
				error: fetchFailed("UND_ERR_CONNECT_TIMEOUT"),
				url,
				baseUrl,
			})
		).toBe(`Cannot connect to QCut at ${baseUrl} (UND_ERR_CONNECT_TIMEOUT)`);
		expect(
			describeRequestFailure({
				error: fetchFailed("UND_ERR_HEADERS_TIMEOUT"),
				url,
				baseUrl,
			})
		).toContain("did not answer within the connection's timeout");
	});

	it("says the client gave up on its own timeout", () => {
		const timeout = Object.assign(new Error("The operation was aborted"), {
			name: "TimeoutError",
		});
		expect(describeRequestFailure({ error: timeout, url, baseUrl })).toBe(
			`QCut did not answer ${url} within the client timeout; the work may still be running in the app`
		);
	});

	it("leaves other errors to the caller", () => {
		expect(
			describeRequestFailure({ error: new Error("boom"), url, baseUrl })
		).toBeNull();
	});
});
