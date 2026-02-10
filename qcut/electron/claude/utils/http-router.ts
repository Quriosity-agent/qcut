/**
 * Lightweight HTTP Router for Claude API
 * Matches METHOD /path/:param patterns, parses JSON bodies, extracts query params.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { parse } from "node:url";

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export interface ParsedRequest {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
}

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: (req: ParsedRequest) => Promise<unknown>;
}

/** Convert a route path with :param placeholders into a RegExp and extract param names. */
function pathToRegex(path: string): { pattern: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const regexStr = path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${regexStr}$`), paramNames };
}

/** Parse the request body as JSON, enforcing a 1MB size limit. */
function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new HttpError(413, "Payload too large"));
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : undefined);
      } catch {
        reject(new HttpError(400, "Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

export interface Router {
  get(path: string, handler: (req: ParsedRequest) => Promise<unknown>): void;
  post(path: string, handler: (req: ParsedRequest) => Promise<unknown>): void;
  patch(path: string, handler: (req: ParsedRequest) => Promise<unknown>): void;
  delete(path: string, handler: (req: ParsedRequest) => Promise<unknown>): void;
  handle(req: IncomingMessage, res: ServerResponse): void;
}

/** Create a lightweight HTTP router that matches METHOD /path/:param patterns. */
export function createRouter(): Router {
  const routes: Route[] = [];

  function addRoute(
    method: string,
    path: string,
    handler: (req: ParsedRequest) => Promise<unknown>,
  ) {
    const { pattern, paramNames } = pathToRegex(path);
    routes.push({ method: method.toUpperCase(), pattern, paramNames, handler });
  }

  function sendJson(res: ServerResponse, status: number, data: unknown) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const method = (req.method || "GET").toUpperCase();
    const parsed = parse(req.url || "/", true);
    const pathname = parsed.pathname || "/";
    const query: Record<string, string> = {};
    for (const [key, val] of Object.entries(parsed.query)) {
      if (typeof val === "string") query[key] = val;
    }

    for (const route of routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.pattern);
      if (!match) continue;

      try {
        const params: Record<string, string> = {};
        for (let i = 0; i < route.paramNames.length; i++) {
          params[route.paramNames[i]] = decodeURIComponent(match[i + 1]);
        }

        let body: unknown;
        if (method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE") {
          body = await parseBody(req);
        }
        const result = await route.handler({ params, query, body });
        sendJson(res, 200, { success: true, data: result, timestamp: Date.now() });
      } catch (error: unknown) {
        if (error instanceof URIError) {
          sendJson(res, 400, {
            success: false,
            error: "Invalid URL encoding",
            timestamp: Date.now(),
          });
        } else if (error instanceof HttpError) {
          sendJson(res, error.status, {
            success: false,
            error: error.message,
            timestamp: Date.now(),
          });
        } else {
          const message = error instanceof Error ? error.message : "Internal server error";
          sendJson(res, 500, {
            success: false,
            error: message,
            timestamp: Date.now(),
          });
        }
      }
      return;
    }

    // No route matched
    sendJson(res, 404, {
      success: false,
      error: `Not found: ${method} ${pathname}`,
      timestamp: Date.now(),
    });
  }

  return {
    get: (path, handler) => addRoute("GET", path, handler),
    post: (path, handler) => addRoute("POST", path, handler),
    patch: (path, handler) => addRoute("PATCH", path, handler),
    delete: (path, handler) => addRoute("DELETE", path, handler),
    handle,
  };
}

// CommonJS export for compatibility
module.exports = { createRouter, HttpError };
