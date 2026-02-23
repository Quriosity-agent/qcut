/**
 * Claude HTTP Server for Utility Process
 *
 * This is the HTTP server that runs inside the utility process.
 * Instead of directly accessing BrowserWindow, it uses requestFromMain()
 * to proxy renderer-dependent operations through the main process.
 */

import * as path from "node:path";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { createRouter, HttpError } from "../claude/utils/http-router.js";
import { claudeLog } from "../claude/utils/logger.js";
import { isValidSourcePath } from "../claude/utils/helpers.js";

// Handlers that work purely with filesystem (no BrowserWindow needed)
import {
	listMediaFiles,
	getMediaInfo,
	importMediaFile,
	deleteMediaFile,
	renameMediaFile,
	importMediaFromUrl,
	batchImportMedia,
	extractFrame,
} from "../claude/handlers/claude-media-handler.js";
import {
	batchAddElements,
	batchUpdateElements,
	batchDeleteElements,
	arrangeTimeline,
	timelineToMarkdown,
	markdownToTimeline,
	validateTimeline,
} from "../claude/handlers/claude-timeline-handler.js";
import {
	getProjectSettings,
	updateProjectSettings,
	getEmptyStats,
} from "../claude/handlers/claude-project-handler.js";
import {
	getExportPresets,
	getExportRecommendation,
	startExportJob,
	getExportJobStatus,
	listExportJobs,
} from "../claude/handlers/claude-export-handler.js";
import { analyzeError } from "../claude/handlers/claude-diagnostics-handler.js";
import {
	generateProjectSummary,
	generatePipelineReport,
} from "../claude/handlers/claude-summary-handler.js";
import {
	logOperation,
	getOperationLog,
	clearOperationLog,
} from "../claude/claude-operation-log.js";
import { generatePersonaPlex } from "../claude/handlers/claude-personaplex-handler.js";
import { registerAnalysisRoutes } from "../claude/http/claude-http-analysis-routes.js";
import { registerGenerateRoutes } from "../claude/http/claude-http-generate-routes.js";

let server: Server | null = null;

// Type for the requestFromMain function passed in from the utility process entry
type RequestFromMainFn = (channel: string, data: any) => Promise<any>;

/** Fake BrowserWindow-like object that proxies calls through main process */
function createWindowProxy(requestFromMain: RequestFromMainFn): any {
	return {
		webContents: {
			send(channel: string, ...args: any[]) {
				// Fire-and-forget to main process
				requestFromMain("webcontents-send", { channel, args }).catch(
					(err: Error) => {
						claudeLog.warn(
							"HTTP",
							`Failed to send to renderer: ${err.message}`
						);
					}
				);
			},
		},
	};
}

interface UtilityHttpConfig {
	port: number;
	appVersion: string;
	requestFromMain: RequestFromMainFn;
}

export function startUtilityHttpServer(config: UtilityHttpConfig): void {
	const { port, appVersion, requestFromMain } = config;

	if (server) {
		claudeLog.warn("HTTP", "Server already running in utility process");
		return;
	}

	const router = createRouter();

	// Helper: get a window proxy for routes that need renderer communication
	function getWindow(): any {
		return createWindowProxy(requestFromMain);
	}

	// Helper: request timeline from renderer via main process
	async function requestTimelineFromMain(): Promise<any> {
		return requestFromMain("get-timeline", {});
	}

	// Helper: request selection from renderer via main process
	async function requestSelectionFromMain(): Promise<any> {
		return requestFromMain("get-selection", {});
	}

	// Helper: request split from renderer via main process
	async function requestSplitFromMain(
		elementId: string,
		splitTime: number,
		mode: string
	): Promise<any> {
		return requestFromMain("split-element", { elementId, splitTime, mode });
	}

	// Helper: get project stats from renderer via main process
	async function getProjectStatsFromMain(projectId: string): Promise<any> {
		return requestFromMain("get-project-stats", { projectId });
	}

	// Auth check
	function checkAuth(req: any): boolean {
		const token = process.env.QCUT_API_TOKEN;
		if (!token) return true;
		return req.headers.authorization === `Bearer ${token}`;
	}

	// CORS
	function setCorsHeaders(res: any): void {
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader(
			"Access-Control-Allow-Methods",
			"GET, POST, PATCH, DELETE, OPTIONS"
		);
		res.setHeader(
			"Access-Control-Allow-Headers",
			"Content-Type, Authorization"
		);
	}

	// ==========================================================================
	// Health check
	// ==========================================================================
	router.get("/api/claude/health", async () => ({
		status: "ok",
		version: appVersion,
		uptime: process.uptime(),
		process: "utility",
	}));

	// ==========================================================================
	// Media routes (file-system based — no renderer needed)
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
		// Notify renderer via main process
		if (media) {
			requestFromMain("webcontents-send", {
				channel: "claude:media:imported",
				args: [
					{
						path: media.path,
						name: media.name,
						id: media.id,
						type: media.type,
						size: media.size,
					},
				],
			}).catch(() => {
				/* non-fatal */
			});
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
	// Timeline routes (renderer-dependent — proxied through main process)
	// ==========================================================================
	router.get("/api/claude/timeline/:projectId", async (req) => {
		const timeline = await Promise.race([
			requestTimelineFromMain(),
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
		const win = getWindow();
		win.webContents.send("claude:timeline:apply", {
			timeline,
			replace: req.body.replace === true,
		});
		return { imported: true };
	});

	router.post("/api/claude/timeline/:projectId/elements", async (req) => {
		if (!req.body)
			throw new HttpError(400, "Missing element data in request body");
		const win = getWindow();
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
		// batchAddElements needs a BrowserWindow — proxy through main
		try {
			return await requestFromMain("batch-add-elements", {
				projectId: req.params.projectId,
				elements: req.body.elements,
			});
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
				return await requestFromMain("batch-update-elements", {
					updates: req.body.updates,
				});
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
			const win = getWindow();
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
				return await requestFromMain("batch-delete-elements", {
					elements: req.body.elements,
					ripple: Boolean(req.body.ripple),
				});
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
			const win = getWindow();
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
			return await requestFromMain("arrange-timeline", {
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
			return requestSplitFromMain(
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
			const win = getWindow();
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
		const win = getWindow();
		win.webContents.send("claude:timeline:selectElements", {
			elements: req.body.elements,
		});
		return { selected: req.body.elements.length };
	});

	router.get("/api/claude/timeline/:projectId/selection", async () => {
		const elements = await Promise.race([
			requestSelectionFromMain(),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new HttpError(504, "Renderer timed out")), 5000)
			),
		]);
		return { elements };
	});

	router.delete("/api/claude/timeline/:projectId/selection", async () => {
		const win = getWindow();
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
			return await getProjectStatsFromMain(req.params.projectId);
		} catch {
			return getEmptyStats();
		}
	});

	router.get("/api/claude/project/:projectId/summary", async (req) => {
		try {
			const timeline = await Promise.race([
				requestTimelineFromMain(),
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
				requestTimelineFromMain(),
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
		getExportRecommendation(req.params.target)
	);

	router.post("/api/claude/export/:projectId/start", async (req) => {
		try {
			const timeline = await Promise.race([
				requestTimelineFromMain(),
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
				400,
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
	// Analysis routes — these need getWindow proxy
	// ==========================================================================
	registerAnalysisRoutes(router, getWindow);

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
			const win = getWindow();
			win.webContents.send("mcp:app-html", { html: req.body.html, toolName });
			return { forwarded: true };
		} catch (err) {
			return {
				forwarded: false,
				error: err instanceof Error ? err.message : "Unknown error",
			};
		}
	});

	// ==========================================================================
	// Create and start server
	// ==========================================================================
	server = createServer((req, res) => {
		setCorsHeaders(res);
		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}
		req.setTimeout(30_000, () => {
			res.writeHead(408, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					success: false,
					error: "Request timeout",
					timestamp: Date.now(),
				})
			);
		});
		if (!checkAuth(req)) {
			res.writeHead(401, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					success: false,
					error: "Unauthorized",
					timestamp: Date.now(),
				})
			);
			return;
		}
		router.handle(req, res);
	});

	server.listen(port, "127.0.0.1", () => {
		claudeLog.info(
			"HTTP",
			`Server started on http://127.0.0.1:${port} (utility process)`
		);
	});

	server.on("error", (err: NodeJS.ErrnoException) => {
		if (err.code === "EADDRINUSE") {
			claudeLog.warn("HTTP", `Port ${port} in use. Claude HTTP API disabled.`);
		} else {
			claudeLog.error("HTTP", `Server error: ${err.message}`);
		}
		server = null;
	});
}

export function stopUtilityHttpServer(): void {
	if (server) {
		server.close();
		server = null;
		claudeLog.info("HTTP", "Server stopped (utility process)");
	}
}
