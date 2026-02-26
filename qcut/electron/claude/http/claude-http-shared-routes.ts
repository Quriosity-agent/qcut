/**
 * Shared HTTP Route Definitions
 *
 * Extracts common route registration logic used by both:
 * - claude-http-server.ts (main process, direct BrowserWindow access)
 * - utility-http-server.ts (utility process, proxied BrowserWindow access)
 *
 * The only difference is how each server provides:
 * - getWindow(): returns a BrowserWindow (or proxy with webContents.send)
 * - requestTimeline(): fetches timeline from renderer
 * - requestSelection(): fetches selection from renderer
 * - requestSplit(): splits an element via renderer
 * - getProjectStatsImpl(): gets project stats
 * - getAppVersion(): returns app version string
 */

import * as path from "node:path";
import type { ParsedRequest, Router } from "../utils/http-router.js";
import { HttpError } from "../utils/http-router.js";
import { isValidSourcePath } from "../utils/helpers.js";
import {
	claudeCorrelationTracker,
	toCommandLifecycle,
} from "../handlers/claude-correlation.js";
import type { CommandRecord, CorrelationId } from "../../types/claude-api.js";

import {
	listMediaFiles,
	getMediaInfo,
	importMediaFile,
	deleteMediaFile,
	renameMediaFile,
	importMediaFromUrl,
	batchImportMedia,
	extractFrame,
} from "../handlers/claude-media-handler.js";
import {
	timelineToMarkdown,
	markdownToTimeline,
	validateTimeline,
} from "../handlers/claude-timeline-handler.js";
import {
	getProjectSettings,
	updateProjectSettings,
	getEmptyStats,
} from "../handlers/claude-project-handler.js";
import {
	getExportPresets,
	getExportRecommendation,
	startExportJob,
	getExportJobStatus,
	listExportJobs,
} from "../handlers/claude-export-handler.js";
import { analyzeError } from "../handlers/claude-diagnostics-handler.js";
import {
	generateProjectSummary,
	generatePipelineReport,
} from "../handlers/claude-summary-handler.js";
import {
	logOperation,
	getOperationLog,
	clearOperationLog,
} from "../claude-operation-log.js";
import { generatePersonaPlex } from "../handlers/claude-personaplex-handler.js";
import { registerAnalysisRoutes } from "./claude-http-analysis-routes.js";
import { registerGenerateRoutes } from "./claude-http-generate-routes.js";
import {
	getApiVersion,
	getApiVersionInfo,
	getCapabilities,
	getCapabilityManifest,
	getCapabilitySupport,
} from "../handlers/claude-capability-handler.js";
import { getClaudeCommandRegistry } from "../handlers/claude-command-registry.js";

const COMMAND_WAIT_TIMEOUT_MS = 29_000;

function shouldSkipCorrelationTracking({
	pathname,
}: {
	pathname: string;
}): boolean {
	try {
		if (pathname.startsWith("/api/claude/commands")) {
			return true;
		}
		return pathname === "/api/claude/health";
	} catch {
		return false;
	}
}

function buildTrackedCommandParams({
	req,
}: {
	req: ParsedRequest;
}): Record<string, unknown> {
	try {
		const params: Record<string, unknown> = {};
		if (Object.keys(req.params).length > 0) {
			params.params = req.params;
		}
		if (Object.keys(req.query).length > 0) {
			params.query = req.query;
		}
		if (req.body !== undefined) {
			params.body = req.body;
		}
		return params;
	} catch {
		return {};
	}
}

function setRequestCommandMeta({
	req,
	record,
}: {
	req: ParsedRequest;
	record: CommandRecord | null;
}): void {
	try {
		if (!req.responseMeta || !record) return;
		req.responseMeta.correlationId = record.correlationId;
		req.responseMeta.lifecycle = toCommandLifecycle({ record });
	} catch {
		// no-op
	}
}

function getRequestCorrelationId({
	req,
}: {
	req: ParsedRequest;
}): CorrelationId | undefined {
	try {
		return req.responseMeta?.correlationId;
	} catch {
		return undefined;
	}
}

function isTerminalCommand({
	record,
}: {
	record: CommandRecord;
}): boolean {
	try {
		return record.state === "applied" || record.state === "failed";
	} catch {
		return false;
	}
}

function wrapRouterWithCorrelationTracking({
	router,
}: {
	router: Router;
}): void {
	try {
		const originalGet = router.get.bind(router);
		const originalPost = router.post.bind(router);
		const originalPatch = router.patch.bind(router);
		const originalDelete = router.delete.bind(router);

		const wrapHandler =
			({
				method,
				pathname,
				handler,
			}: {
				method: "GET" | "POST" | "PATCH" | "DELETE";
				pathname: string;
				handler: (req: ParsedRequest) => Promise<unknown>;
			}) =>
			async (req: ParsedRequest): Promise<unknown> => {
				if (shouldSkipCorrelationTracking({ pathname })) {
					return handler(req);
				}

				const started = claudeCorrelationTracker.startCommand({
					command: `${method} ${pathname}`,
					params: buildTrackedCommandParams({ req }),
				});
				setRequestCommandMeta({ req, record: started });

				const accepted = claudeCorrelationTracker.acceptCommand({
					correlationId: started.correlationId,
				});
				setRequestCommandMeta({ req, record: accepted });

				const applying = claudeCorrelationTracker.applyCommand({
					correlationId: started.correlationId,
					state: "applying",
				});
				setRequestCommandMeta({ req, record: applying });

				try {
					const result = await handler(req);
					const applied = claudeCorrelationTracker.applyCommand({
						correlationId: started.correlationId,
						state: "applied",
					});
					setRequestCommandMeta({ req, record: applied });
					return result;
				} catch (error) {
					const failed = claudeCorrelationTracker.failCommand({
						correlationId: started.correlationId,
						error:
							error instanceof Error ? error.message : "Unknown command failure",
					});
					setRequestCommandMeta({ req, record: failed });
					throw error;
				}
			};

		router.get = (pathname, handler) =>
			originalGet(pathname, wrapHandler({ method: "GET", pathname, handler }));
		router.post = (pathname, handler) =>
			originalPost(pathname, wrapHandler({ method: "POST", pathname, handler }));
		router.patch = (pathname, handler) =>
			originalPatch(pathname, wrapHandler({ method: "PATCH", pathname, handler }));
		router.delete = (pathname, handler) =>
			originalDelete(
				pathname,
				wrapHandler({ method: "DELETE", pathname, handler })
			);
	} catch {
		// no-op
	}
}

/** Abstraction over how the server accesses renderer-dependent features */
export interface WindowAccessor {
	/** Get a BrowserWindow or proxy with webContents.send capability */
	getWindow(): any;
	/** Request full timeline data from renderer */
	requestTimeline(): Promise<any>;
	/** Request current selection from renderer */
	requestSelection(): Promise<any>;
	/** Request an element split from renderer */
	requestSplit(
		elementId: string,
		splitTime: number,
		mode: string,
		correlationId?: string
	): Promise<any>;
	/** Get project stats (may need renderer) */
	getProjectStats(projectId: string): Promise<any>;
	/** Get the app version string */
	getAppVersion(): string;
	/** Batch add elements (may need BrowserWindow or proxy) */
	batchAddElements(
		projectId: string,
		elements: any[],
		correlationId?: string
	): Promise<any>;
	/** Batch update elements */
	batchUpdateElements(updates: any[], correlationId?: string): Promise<any>;
	/** Batch delete elements */
	batchDeleteElements(
		elements: any[],
		ripple: boolean,
		correlationId?: string
	): Promise<any>;
	/** Arrange timeline */
	arrangeTimeline(data: any, correlationId?: string): Promise<any>;
}

/**
 * Register all shared API routes onto the given router.
 * The WindowAccessor abstracts over direct vs proxied BrowserWindow access.
 */
export function registerSharedRoutes(
	router: Router,
	accessor: WindowAccessor
): void {
	wrapRouterWithCorrelationTracking({ router });

	// ==========================================================================
	// Health check
	// ==========================================================================
	router.get("/api/claude/health", async () => {
		try {
			const appVersion = accessor.getAppVersion();
			const electronVersion = process.versions.electron ?? "unknown";
			const apiVersionInfo = getApiVersionInfo({
				appVersion,
				electronVersion,
			});
			const capabilities = getCapabilities().map((capability) => ({
				name: capability.name,
				version: capability.version,
				category: capability.category,
				deprecated: capability.deprecated === true,
			}));

			return {
				status: "ok",
				version: appVersion,
				uptime: process.uptime(),
				apiVersion: getApiVersion(),
				protocolVersion: apiVersionInfo.protocolVersion,
				appVersion: apiVersionInfo.appVersion,
				electronVersion: apiVersionInfo.electronVersion,
				capabilities,
			};
		} catch (error) {
			throw new HttpError(
				500,
				error instanceof Error
					? error.message
					: "Failed to build health response"
			);
		}
	});

	router.get("/api/claude/capabilities", async () => {
		try {
			const appVersion = accessor.getAppVersion();
			const electronVersion = process.versions.electron ?? "unknown";
			const manifest = getCapabilityManifest();
			return {
				...manifest,
				appVersion,
				electronVersion,
			};
		} catch (error) {
			throw new HttpError(
				500,
				error instanceof Error
					? error.message
					: "Failed to build capability manifest"
			);
		}
	});

	router.get("/api/claude/capabilities/:name", async (req) => {
		try {
			const minVersion =
				typeof req.query.minVersion === "string" ? req.query.minVersion : undefined;
			return getCapabilitySupport({
				name: req.params.name,
				minVersion,
			});
		} catch (error) {
			throw new HttpError(
				500,
				error instanceof Error
					? error.message
					: "Failed to evaluate capability support"
			);
		}
	});

	router.get("/api/claude/commands/registry", async () => {
		try {
			const commands = getClaudeCommandRegistry();
			return {
				apiVersion: getApiVersion(),
				count: commands.length,
				commands,
			};
		} catch (error) {
			throw new HttpError(
				500,
				error instanceof Error ? error.message : "Failed to build command registry"
			);
		}
	});

	router.get("/api/claude/commands", async (req) => {
		try {
			const rawLimit = req.query.limit;
			const parsedLimit =
				typeof rawLimit === "string" ? Number.parseInt(rawLimit, 10) : undefined;
			const limit =
				typeof parsedLimit === "number" && Number.isFinite(parsedLimit)
					? parsedLimit
					: undefined;
			return {
				commands: claudeCorrelationTracker.listCommands({ limit }),
			};
		} catch (error) {
			throw new HttpError(
				500,
				error instanceof Error ? error.message : "Failed to list commands"
			);
		}
	});

	router.get("/api/claude/commands/:correlationId", async (req) => {
		try {
			const command = claudeCorrelationTracker.getCommand({
				correlationId: req.params.correlationId as CorrelationId,
			});
			if (!command) {
				throw new HttpError(404, `Command not found: ${req.params.correlationId}`);
			}
			return command;
		} catch (error) {
			if (error instanceof HttpError) throw error;
			throw new HttpError(
				500,
				error instanceof Error ? error.message : "Failed to get command"
			);
		}
	});

	router.get("/api/claude/commands/:correlationId/wait", async (req) => {
		try {
			const command = await claudeCorrelationTracker.waitForCommand({
				correlationId: req.params.correlationId as CorrelationId,
				timeoutMs: COMMAND_WAIT_TIMEOUT_MS,
			});
			if (!command) {
				throw new HttpError(404, `Command not found: ${req.params.correlationId}`);
			}
			return {
				command,
				timedOut: !isTerminalCommand({ record: command }),
			};
		} catch (error) {
			if (error instanceof HttpError) throw error;
			throw new HttpError(
				500,
				error instanceof Error ? error.message : "Failed to wait for command"
			);
		}
	});

	// ==========================================================================
	// Media routes (file-system based -- no renderer needed)
	// ==========================================================================
	router.get("/api/claude/media/:projectId", async (req) =>
		listMediaFiles(req.params.projectId)
	);

	router.get("/api/claude/media/:projectId/:mediaId", async (req) =>
		getMediaInfo(req.params.projectId, req.params.mediaId)
	);

	router.post("/api/claude/media/:projectId/import", async (req) => {
		if (!req.body?.source)
			throw new HttpError(400, "Missing 'source' in request body");
		const media = await importMediaFile(req.params.projectId, req.body.source);
		logOperation({
			stage: 1,
			action: "import",
			details: `Imported media from path: ${req.body.source}`,
			timestamp: Date.now(),
			projectId: req.params.projectId,
		});
		if (media) {
			try {
				const win = accessor.getWindow();
				win.webContents.send("claude:media:imported", {
					path: media.path,
					name: media.name,
					id: media.id,
					type: media.type,
					size: media.size,
				});
			} catch {
				/* non-fatal */
			}
		}
		return media;
	});

	router.delete("/api/claude/media/:projectId/:mediaId", async (req) =>
		deleteMediaFile(req.params.projectId, req.params.mediaId)
	);

	router.patch("/api/claude/media/:projectId/:mediaId/rename", async (req) => {
		if (!req.body?.newName)
			throw new HttpError(400, "Missing 'newName' in request body");
		return renameMediaFile(
			req.params.projectId,
			req.params.mediaId,
			req.body.newName
		);
	});

	router.post("/api/claude/media/:projectId/import-from-url", async (req) => {
		if (!req.body?.url)
			throw new HttpError(400, "Missing 'url' in request body");
		const result = await importMediaFromUrl(
			req.params.projectId,
			req.body.url,
			req.body.filename
		);
		logOperation({
			stage: 1,
			action: "import",
			details: `Imported media from URL: ${req.body.url}`,
			timestamp: Date.now(),
			projectId: req.params.projectId,
		});
		return result;
	});

	router.post("/api/claude/media/:projectId/batch-import", async (req) => {
		if (!Array.isArray(req.body?.items))
			throw new HttpError(400, "Missing 'items' array in request body");
		const result = await batchImportMedia(req.params.projectId, req.body.items);
		logOperation({
			stage: 1,
			action: "import",
			details: `Batch import processed ${req.body.items.length} item(s)`,
			timestamp: Date.now(),
			projectId: req.params.projectId,
		});
		return result;
	});

	router.post(
		"/api/claude/media/:projectId/:mediaId/extract-frame",
		async (req) => {
			if (typeof req.body?.timestamp !== "number")
				throw new HttpError(
					400,
					"Missing 'timestamp' (number) in request body"
				);
			return extractFrame(
				req.params.projectId,
				req.params.mediaId,
				req.body.timestamp,
				req.body.format
			);
		}
	);

	// ==========================================================================
	// Generate routes
	// ==========================================================================
	registerGenerateRoutes(router);

	// ==========================================================================
	// Timeline routes
	// ==========================================================================
	router.get("/api/claude/timeline/:projectId", async (req) => {
		const timeline = await Promise.race([
			accessor.requestTimeline(),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new HttpError(504, "Renderer timed out")), 5000)
			),
		]);
		const format = req.query.format || "json";
		if (format === "md") return timelineToMarkdown(timeline);
		return timeline;
	});

	router.post("/api/claude/timeline/:projectId/import", async (req) => {
		if (!req.body?.data)
			throw new HttpError(400, "Missing 'data' in request body");
		const format = req.body.format || "json";
		let timeline;
		if (format === "md") {
			try {
				timeline = markdownToTimeline(req.body.data);
			} catch (e) {
				throw new HttpError(
					400,
					e instanceof Error ? e.message : "Invalid markdown"
				);
			}
		} else {
			if (typeof req.body.data === "string") {
				try {
					timeline = JSON.parse(req.body.data);
				} catch {
					throw new HttpError(400, "Invalid JSON in 'data'");
				}
			} else {
				timeline = req.body.data;
			}
		}
		validateTimeline(timeline);
		const win = accessor.getWindow();
		win.webContents.send("claude:timeline:apply", {
			timeline,
			replace: req.body.replace === true,
		});
		return { imported: true };
	});

	router.post("/api/claude/timeline/:projectId/elements", async (req) => {
		if (!req.body)
			throw new HttpError(400, "Missing element data in request body");
		const win = accessor.getWindow();
		const elementId =
			req.body.id ||
			`element_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		win.webContents.send("claude:timeline:addElement", {
			...req.body,
			id: elementId,
		});
		return { elementId };
	});

	router.post("/api/claude/timeline/:projectId/elements/batch", async (req) => {
		if (!Array.isArray(req.body?.elements))
			throw new HttpError(400, "Missing 'elements' array in request body");
		try {
			return await accessor.batchAddElements(
				req.params.projectId,
				req.body.elements
			);
		} catch (error) {
			throw new HttpError(
				400,
				error instanceof Error ? error.message : "Batch add failed"
			);
		}
	});

	router.patch(
		"/api/claude/timeline/:projectId/elements/batch",
		async (req) => {
			if (!Array.isArray(req.body?.updates))
				throw new HttpError(400, "Missing 'updates' array in request body");
			try {
				return await accessor.batchUpdateElements(req.body.updates);
			} catch (error) {
				throw new HttpError(
					400,
					error instanceof Error ? error.message : "Batch update failed"
				);
			}
		}
	);

	router.patch(
		"/api/claude/timeline/:projectId/elements/:elementId",
		async (req) => {
			const win = accessor.getWindow();
			win.webContents.send("claude:timeline:updateElement", {
				elementId: req.params.elementId,
				changes: req.body || {},
			});
			return { updated: true };
		}
	);

	router.delete(
		"/api/claude/timeline/:projectId/elements/batch",
		async (req) => {
			if (!Array.isArray(req.body?.elements))
				throw new HttpError(400, "Missing 'elements' array in request body");
			try {
				return await accessor.batchDeleteElements(
					req.body.elements,
					Boolean(req.body.ripple)
				);
			} catch (error) {
				throw new HttpError(
					400,
					error instanceof Error ? error.message : "Batch delete failed"
				);
			}
		}
	);

	router.delete(
		"/api/claude/timeline/:projectId/elements/:elementId",
		async (req) => {
			const win = accessor.getWindow();
			win.webContents.send(
				"claude:timeline:removeElement",
				req.params.elementId
			);
			return { removed: true };
		}
	);

	router.post("/api/claude/timeline/:projectId/arrange", async (req) => {
		if (!req.body?.trackId || typeof req.body.trackId !== "string")
			throw new HttpError(400, "Missing 'trackId' in request body");
		if (!req.body?.mode || typeof req.body.mode !== "string")
			throw new HttpError(400, "Missing 'mode' in request body");
		if (!["sequential", "spaced", "manual"].includes(req.body.mode))
			throw new HttpError(
				400,
				"Invalid mode. Use sequential, spaced, or manual"
			);
		try {
			return await accessor.arrangeTimeline({
				trackId: req.body.trackId,
				mode: req.body.mode,
				gap: req.body.gap,
				order: req.body.order,
				startOffset: req.body.startOffset,
			});
		} catch (error) {
			throw new HttpError(
				400,
				error instanceof Error ? error.message : "Arrange request failed"
			);
		}
	});

	router.post(
		"/api/claude/timeline/:projectId/elements/:elementId/split",
		async (req) => {
			if (typeof req.body?.splitTime !== "number")
				throw new HttpError(
					400,
					"Missing 'splitTime' (number) in request body"
				);
			const mode = req.body.mode || "split";
			if (!["split", "keepLeft", "keepRight"].includes(mode))
				throw new HttpError(
					400,
					"Invalid mode. Use 'split', 'keepLeft', or 'keepRight'"
				);
			return accessor.requestSplit(
				req.params.elementId,
				req.body.splitTime,
				mode
			);
		}
	);

	router.post(
		"/api/claude/timeline/:projectId/elements/:elementId/move",
		async (req) => {
			if (!req.body?.toTrackId)
				throw new HttpError(400, "Missing 'toTrackId' in request body");
			const win = accessor.getWindow();
			win.webContents.send("claude:timeline:moveElement", {
				elementId: req.params.elementId,
				toTrackId: req.body.toTrackId,
				newStartTime: req.body.newStartTime,
			});
			return { moved: true };
		}
	);

	router.post("/api/claude/timeline/:projectId/selection", async (req) => {
		if (!Array.isArray(req.body?.elements))
			throw new HttpError(400, "Missing 'elements' array in request body");
		const win = accessor.getWindow();
		win.webContents.send("claude:timeline:selectElements", {
			elements: req.body.elements,
		});
		return { selected: req.body.elements.length };
	});

	router.get("/api/claude/timeline/:projectId/selection", async () => {
		const elements = await Promise.race([
			accessor.requestSelection(),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new HttpError(504, "Renderer timed out")), 5000)
			),
		]);
		return { elements };
	});

	router.delete("/api/claude/timeline/:projectId/selection", async () => {
		const win = accessor.getWindow();
		win.webContents.send("claude:timeline:clearSelection");
		return { cleared: true };
	});

	// ==========================================================================
	// Project routes
	// ==========================================================================
	router.get("/api/claude/project/:projectId/settings", async (req) =>
		getProjectSettings(req.params.projectId)
	);

	router.patch("/api/claude/project/:projectId/settings", async (req) => {
		if (!req.body) throw new HttpError(400, "Missing settings in request body");
		await updateProjectSettings(req.params.projectId, req.body);
		return { updated: true };
	});

	router.get("/api/claude/project/:projectId/stats", async (req) => {
		try {
			return await accessor.getProjectStats(req.params.projectId);
		} catch {
			return getEmptyStats();
		}
	});

	router.get("/api/claude/project/:projectId/summary", async (req) => {
		try {
			const timeline = await Promise.race([
				accessor.requestTimeline(),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new HttpError(504, "Renderer timed out")),
						5000
					)
				),
			]);
			const [mediaFiles, settings] = await Promise.all([
				listMediaFiles(req.params.projectId),
				getProjectSettings(req.params.projectId),
			]);
			const exportJobs = listExportJobs(req.params.projectId);
			return generateProjectSummary({
				timeline,
				mediaFiles,
				exportJobs,
				settings,
			});
		} catch (error) {
			if (error instanceof HttpError) throw error;
			const msg =
				error instanceof Error ? error.message : "Failed to generate summary";
			throw new HttpError(
				msg.includes("Failed to read project") ? 400 : 500,
				msg
			);
		}
	});

	router.post("/api/claude/project/:projectId/report", async (req) => {
		try {
			const timeline = await Promise.race([
				accessor.requestTimeline(),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new HttpError(504, "Renderer timed out")),
						5000
					)
				),
			]);
			const [mediaFiles, settings] = await Promise.all([
				listMediaFiles(req.params.projectId),
				getProjectSettings(req.params.projectId),
			]);
			const exportJobs = listExportJobs(req.params.projectId);
			const summary = generateProjectSummary({
				timeline,
				mediaFiles,
				exportJobs,
				settings,
			});
			const steps = getOperationLog({ projectId: req.params.projectId });
			let outputDir: string | undefined;
			if (typeof req.body?.outputDir === "string") {
				outputDir = req.body.outputDir;
			} else if (typeof req.body?.outputPath === "string") {
				outputDir = path.dirname(req.body.outputPath);
			}
			if (outputDir && !isValidSourcePath(outputDir))
				throw new HttpError(400, "Invalid output directory path");
			const saveToDisk =
				req.body?.saveToDisk === true || outputDir !== undefined;
			const report = await generatePipelineReport({
				steps,
				summary,
				saveToDisk,
				outputDir,
				projectId: req.params.projectId,
			});
			if (req.body?.clearLog === true)
				clearOperationLog({ projectId: req.params.projectId });
			return report;
		} catch (error) {
			if (error instanceof HttpError) throw error;
			throw new HttpError(
				500,
				error instanceof Error ? error.message : "Failed to generate report"
			);
		}
	});

	// ==========================================================================
	// Export routes
	// ==========================================================================
	router.get("/api/claude/export/presets", async () => getExportPresets());

	router.get("/api/claude/export/:projectId/recommend/:target", async (req) =>
		getExportRecommendation({ target: req.params.target })
	);

	router.post("/api/claude/export/:projectId/start", async (req) => {
		try {
			const timeline = await Promise.race([
				accessor.requestTimeline(),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new HttpError(504, "Renderer timed out")),
						5000
					)
				),
			]);
			const mediaFiles = await listMediaFiles(req.params.projectId);
			return await startExportJob({
				projectId: req.params.projectId,
				request: req.body || {},
				timeline,
				mediaFiles,
			});
		} catch (error) {
			if (error instanceof HttpError) throw error;
			throw new HttpError(
				500,
				error instanceof Error ? error.message : "Failed to start export"
			);
		}
	});

	router.get("/api/claude/export/:projectId/jobs/:jobId", async (req) => {
		const job = getExportJobStatus(req.params.jobId);
		if (!job || job.projectId !== req.params.projectId)
			throw new HttpError(404, `Job not found: ${req.params.jobId}`);
		return job;
	});

	router.get("/api/claude/export/:projectId/jobs", async (req) =>
		listExportJobs(req.params.projectId)
	);

	// ==========================================================================
	// Diagnostics
	// ==========================================================================
	router.post("/api/claude/diagnostics/analyze", async (req) => {
		if (!req.body?.message)
			throw new HttpError(400, "Missing 'message' in error report");
		return analyzeError(req.body);
	});

	// ==========================================================================
	// Analysis routes
	// ==========================================================================
	registerAnalysisRoutes(router, () => accessor.getWindow());

	// ==========================================================================
	// PersonaPlex
	// ==========================================================================
	router.post("/api/claude/personaplex/generate", async (req) =>
		generatePersonaPlex(req.body)
	);

	// ==========================================================================
	// MCP app preview forwarding
	// ==========================================================================
	router.post("/api/claude/mcp/app", async (req) => {
		if (!req.body || typeof req.body.html !== "string" || !req.body.html.trim())
			throw new HttpError(400, "Missing 'html' in request body");
		const toolName =
			typeof req.body.toolName === "string" ? req.body.toolName : "unknown";
		try {
			const win = accessor.getWindow();
			win.webContents.send("mcp:app-html", { html: req.body.html, toolName });
			return { forwarded: true };
		} catch (err) {
			return {
				forwarded: false,
				error: err instanceof Error ? err.message : "Unknown error",
			};
		}
	});

	// ── Moyin (Director) ───────────────────────────────────────────────
	router.post("/api/claude/moyin/parse-result", async (req) => {
		if (!req.body?.scriptData)
			throw new HttpError(400, "Missing 'scriptData' in request body");
		const win = accessor.getWindow();
		win.webContents.send("claude:moyin:parsed", req.body.scriptData);
		return { imported: true };
	});
}
