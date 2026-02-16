import { request as httpRequest } from "node:http";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const MCP_TOOL_DEFINITIONS = {
  configureMedia: {
    name: "configure-media",
    description:
      "Open an interactive UI to configure aspect ratio, duration, and resolution.",
    htmlFile: "configure-media.html",
    summary:
      "Interactive media setup is ready. Choose ratio, duration, and resolution, then apply.",
  },
  exportSettings: {
    name: "show-export-settings",
    description:
      "Open an interactive UI to choose export preset, quality, and format.",
    htmlFile: "export-settings.html",
    summary:
      "Export preset picker is ready. Select a platform preset and apply it to the project.",
  },
  projectStats: {
    name: "preview-project-stats",
    description:
      "Open an interactive dashboard with current project metrics and refresh controls.",
    htmlFile: "project-stats.html",
    summary:
      "Project metrics dashboard is ready. It auto-refreshes and supports manual refresh.",
  },
  wanVideo: {
    name: "wan-reference-to-video",
    description:
      "Open an interactive UI to generate video using Wan v2.6 reference-to-video with fal.ai.",
    htmlFile: "wan-video.html",
    summary:
      "Wan v2.6 reference-to-video generator is ready. Enter a prompt, add reference media, and generate.",
  },
} as const;

const DEFAULT_RUNTIME_CONFIG = {
  projectId: process.env.QCUT_PROJECT_ID || "default",
  apiBaseUrl: process.env.QCUT_API_BASE_URL || "http://127.0.0.1:8765",
  projectRoot: process.env.QCUT_PROJECT_ROOT || process.cwd(),
};

interface McpTextContent {
  type: "text";
  text: string;
}

interface McpResourceContent {
  type: "resource";
  resource: {
    uri: string;
    mimeType: string;
    text: string;
  };
}

interface McpToolResponse {
  [key: string]: unknown;
  content: (McpTextContent | McpResourceContent)[];
}

function getHtmlSearchPaths({ fileName }: { fileName: string }): string[] {
  return [
    path.resolve(__dirname, "apps", fileName),
    path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "electron",
      "mcp",
      "apps",
      fileName
    ),
    path.resolve(process.cwd(), "electron", "mcp", "apps", fileName),
  ];
}

async function loadHtmlTemplate({
  fileName,
}: {
  fileName: string;
}): Promise<string> {
  const candidates = getHtmlSearchPaths({ fileName });

  const reads = candidates.map(async (candidatePath) => {
    try {
      const text = await fs.readFile(candidatePath, "utf-8");
      return { text };
    } catch {
      return null;
    }
  });

  const resolvedCandidates = await Promise.all(reads);
  const match = resolvedCandidates.find((candidate) => candidate !== null);

  if (!match) {
    throw new Error(`Failed to locate MCP app template: ${fileName}`);
  }

  return match.text;
}

function injectRuntimeConfig({
  html,
  runtimeConfig,
}: {
  html: string;
  runtimeConfig: {
    projectId: string;
    apiBaseUrl: string;
    projectRoot: string;
  };
}): string {
  const runtimeJson = JSON.stringify(runtimeConfig);
  return html.replace(/__QCUT_RUNTIME_CONFIG__/g, runtimeJson);
}

async function notifyPreviewPanel({
  html,
  toolName,
}: {
  html: string;
  toolName: string;
}): Promise<void> {
  const payload = JSON.stringify({ html, toolName });
  const endpointUrl = new URL(
    "/api/claude/mcp/app",
    DEFAULT_RUNTIME_CONFIG.apiBaseUrl
  );

  try {
    await new Promise<void>((resolve, reject) => {
      const request = httpRequest(
        {
          protocol: endpointUrl.protocol,
          hostname: endpointUrl.hostname,
          port: endpointUrl.port,
          path: endpointUrl.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
          timeout: 2000,
        },
        (response) => {
          response.on("data", () => {});
          response.on("end", () => {
            if (response.statusCode && response.statusCode >= 400) {
              reject(
                new Error(`MCP preview forward failed (${response.statusCode})`)
              );
              return;
            }
            resolve();
          });
        }
      );

      request.on("timeout", () => {
        request.destroy(new Error("MCP preview forward timed out"));
      });
      request.on("error", reject);
      request.write(payload);
      request.end();
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[QCut MCP] Preview forward failed: ${message}`);
  }
}

async function buildToolResponse({
  toolName,
  htmlFile,
  summary,
}: {
  toolName: string;
  htmlFile: string;
  summary: string;
}): Promise<McpToolResponse> {
  const template = await loadHtmlTemplate({ fileName: htmlFile });
  const html = injectRuntimeConfig({
    html: template,
    runtimeConfig: DEFAULT_RUNTIME_CONFIG,
  });

  await notifyPreviewPanel({ html, toolName });

  return {
    content: [
      { type: "text", text: summary },
      {
        type: "resource",
        resource: {
          uri: `ui://qcut/${htmlFile}`,
          mimeType: "text/html",
          text: html,
        },
      },
    ],
  };
}

function registerTools({ server }: { server: McpServer }): void {
  server.tool(
    MCP_TOOL_DEFINITIONS.configureMedia.name,
    MCP_TOOL_DEFINITIONS.configureMedia.description,
    {},
    async () => {
      try {
        return await buildToolResponse({
          toolName: MCP_TOOL_DEFINITIONS.configureMedia.name,
          htmlFile: MCP_TOOL_DEFINITIONS.configureMedia.htmlFile,
          summary: MCP_TOOL_DEFINITIONS.configureMedia.summary,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to build configure-media tool response";
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
        };
      }
    }
  );

  server.tool(
    MCP_TOOL_DEFINITIONS.exportSettings.name,
    MCP_TOOL_DEFINITIONS.exportSettings.description,
    {},
    async () => {
      try {
        return await buildToolResponse({
          toolName: MCP_TOOL_DEFINITIONS.exportSettings.name,
          htmlFile: MCP_TOOL_DEFINITIONS.exportSettings.htmlFile,
          summary: MCP_TOOL_DEFINITIONS.exportSettings.summary,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to build show-export-settings tool response";
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
        };
      }
    }
  );

  server.tool(
    MCP_TOOL_DEFINITIONS.projectStats.name,
    MCP_TOOL_DEFINITIONS.projectStats.description,
    {},
    async () => {
      try {
        return await buildToolResponse({
          toolName: MCP_TOOL_DEFINITIONS.projectStats.name,
          htmlFile: MCP_TOOL_DEFINITIONS.projectStats.htmlFile,
          summary: MCP_TOOL_DEFINITIONS.projectStats.summary,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to build preview-project-stats tool response";
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
        };
      }
    }
  );

  server.tool(
    MCP_TOOL_DEFINITIONS.wanVideo.name,
    MCP_TOOL_DEFINITIONS.wanVideo.description,
    {},
    async () => {
      try {
        return await buildToolResponse({
          toolName: MCP_TOOL_DEFINITIONS.wanVideo.name,
          htmlFile: MCP_TOOL_DEFINITIONS.wanVideo.htmlFile,
          summary: MCP_TOOL_DEFINITIONS.wanVideo.summary,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to build wan-reference-to-video tool response";
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
        };
      }
    }
  );
}

async function startServer(): Promise<void> {
  try {
    const server = new McpServer({ name: "qcut-mcp", version: "1.0.0" });
    registerTools({ server });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[QCut MCP] Server started on stdio transport");
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to start QCut MCP server";
    console.error(`[QCut MCP] Startup error: ${message}`);
    process.exit(1);
  }
}

startServer();
