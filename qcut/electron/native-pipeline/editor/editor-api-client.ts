/**
 * Editor API Client
 *
 * Shared HTTP client for proxying CLI commands to a running
 * QCut editor instance via its REST API at http://127.0.0.1:8765.
 *
 * @module electron/native-pipeline/editor-api-client
 */

import type { CLIRunOptions } from "../cli/cli-runner/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditorApiConfig {
	baseUrl: string;
	token?: string;
	timeout: number;
}

export class EditorApiError extends Error {
	statusCode?: number;
	apiError?: string;

	constructor(message: string, statusCode?: number, apiError?: string) {
		super(message);
		this.name = "EditorApiError";
		this.statusCode = statusCode;
		this.apiError = apiError;
	}
}

interface ApiEnvelope<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
	timestamp?: number;
}

interface JobStatus {
	status: "queued" | "running" | "completed" | "failed" | "cancelled";
	progress?: number;
	message?: string;
	result?: unknown;
	[key: string]: unknown;
}

export interface PollOptions {
	interval?: number;
	timeout?: number;
	onProgress?: (progress: {
		status: string;
		progress?: number;
		message?: string;
	}) => void;
	signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class EditorApiClient {
	private config: EditorApiConfig;

	constructor(config?: Partial<EditorApiConfig>) {
		this.config = {
			baseUrl: config?.baseUrl ?? "http://127.0.0.1:8765",
			token: config?.token,
			timeout: config?.timeout ?? 30_000,
		};
	}

	/** Check if the QCut editor HTTP server is reachable. */
	async checkHealth(): Promise<boolean> {
		try {
			await this.get("/api/claude/health");
			return true;
		} catch {
			return false;
		}
	}

	async get<T = unknown>(
		path: string,
		query?: Record<string, string>
	): Promise<T> {
		let url = `${this.config.baseUrl}${path}`;
		if (query) {
			const params = new URLSearchParams(query);
			url += `?${params.toString()}`;
		}
		return this.request<T>("GET", url);
	}

	async post<T = unknown>(path: string, body?: unknown): Promise<T> {
		return this.request<T>("POST", `${this.config.baseUrl}${path}`, body);
	}

	async patch<T = unknown>(path: string, body?: unknown): Promise<T> {
		return this.request<T>("PATCH", `${this.config.baseUrl}${path}`, body);
	}

	async delete<T = unknown>(path: string, body?: unknown): Promise<T> {
		return this.request<T>("DELETE", `${this.config.baseUrl}${path}`, body);
	}

	/**
	 * Poll an async job endpoint until it reaches a terminal status.
	 * Returns the full job object on completion.
	 */
	async pollJob<T = unknown>(
		statusPath: string,
		options: PollOptions = {}
	): Promise<T> {
		const interval = options.interval ?? 3_000;
		const timeout = options.timeout ?? 300_000;
		const start = Date.now();

		while (true) {
			if (options.signal?.aborted) {
				throw new EditorApiError("Polling cancelled");
			}

			const job = await this.get<JobStatus>(statusPath);

			if (options.onProgress) {
				options.onProgress({
					status: job.status,
					progress: job.progress,
					message: job.message,
				});
			}

			if (job.status === "completed") {
				return job as T;
			}
			if (job.status === "failed") {
				throw new EditorApiError(
					job.message ?? "Job failed",
					undefined,
					job.message
				);
			}
			if (job.status === "cancelled") {
				throw new EditorApiError("Job was cancelled");
			}

			if (Date.now() - start > timeout) {
				throw new EditorApiError(
					`Polling timed out after ${Math.round(timeout / 1000)}s`
				);
			}

			await sleep(interval);
		}
	}

	// -----------------------------------------------------------------------
	// Internal
	// -----------------------------------------------------------------------

	private async request<T>(
		method: string,
		url: string,
		body?: unknown
	): Promise<T> {
		const headers: Record<string, string> = {};
		if (this.config.token) {
			headers.Authorization = `Bearer ${this.config.token}`;
		}

		const init: RequestInit = {
			method,
			headers,
			signal: AbortSignal.timeout(this.config.timeout),
		};

		if (body !== undefined) {
			headers["Content-Type"] = "application/json";
			init.body = JSON.stringify(body);
		}

		let response: Response;
		try {
			response = await fetch(url, init);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
				throw new EditorApiError(
					`Cannot connect to QCut at ${this.config.baseUrl}`
				);
			}
			throw new EditorApiError(`HTTP request failed: ${msg}`);
		}

		let envelope: ApiEnvelope<T>;
		try {
			envelope = (await response.json()) as ApiEnvelope<T>;
		} catch {
			throw new EditorApiError(
				`Invalid JSON response (HTTP ${response.status})`,
				response.status
			);
		}

		if (!envelope.success) {
			throw new EditorApiError(
				envelope.error ?? `Request failed (HTTP ${response.status})`,
				response.status,
				envelope.error
			);
		}

		return envelope.data as T;
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create an EditorApiClient from CLI options + environment variables. */
export function createEditorClient(options: CLIRunOptions): EditorApiClient {
	const host = options.host ?? process.env.QCUT_API_HOST ?? "127.0.0.1";
	const port = options.port ?? process.env.QCUT_API_PORT ?? "8765";
	const token = options.token ?? process.env.QCUT_API_TOKEN ?? undefined;
	const timeout =
		options.timeout !== undefined ? Number(options.timeout) * 1000 : 30_000;

	return new EditorApiClient({
		baseUrl: `http://${host}:${port}`,
		token: token as string | undefined,
		timeout,
	});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
