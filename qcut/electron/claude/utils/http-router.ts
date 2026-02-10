/**
 * Lightweight HTTP Router for Claude API
 * Matches METHOD /path/:param patterns, parses JSON bodies, extracts query params.
 */

import * as http from "http";
import * as url from "url";

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface ParsedRequest {
  params: Record<string, string>;
  query: Record<string, string>;
  body: any;
}

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: (req: ParsedRequest) => Promise<any>;
}

function pathToRegex(path: string): { pattern: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const regexStr = path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${regexStr}$`), paramNames };
}

function parseBody(req: http.IncomingMessage): Promise<any> {
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
  get(path: string, handler: (req: ParsedRequest) => Promise<any>): void;
  post(path: string, handler: (req: ParsedRequest) => Promise<any>): void;
  patch(path: string, handler: (req: ParsedRequest) => Promise<any>): void;
  delete(path: string, handler: (req: ParsedRequest) => Promise<any>): void;
  handle(req: http.IncomingMessage, res: http.ServerResponse): void;
}

export function createRouter(): Router {
  const routes: Route[] = [];

  function addRoute(
    method: string,
    path: string,
    handler: (req: ParsedRequest) => Promise<any>,
  ) {
    const { pattern, paramNames } = pathToRegex(path);
    routes.push({ method: method.toUpperCase(), pattern, paramNames, handler });
  }

  function sendJson(res: http.ServerResponse, status: number, data: any) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const method = (req.method || "GET").toUpperCase();
    const parsed = url.parse(req.url || "/", true);
    const pathname = parsed.pathname || "/";
    const query: Record<string, string> = {};
    for (const [key, val] of Object.entries(parsed.query)) {
      if (typeof val === "string") query[key] = val;
    }

    for (const route of routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      for (let i = 0; i < route.paramNames.length; i++) {
        params[route.paramNames[i]] = decodeURIComponent(match[i + 1]);
      }

      try {
        let body: any;
        if (method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE") {
          body = await parseBody(req);
        }
        const result = await route.handler({ params, query, body });
        sendJson(res, 200, { success: true, data: result, timestamp: Date.now() });
      } catch (error: any) {
        if (error instanceof HttpError) {
          sendJson(res, error.status, {
            success: false,
            error: error.message,
            timestamp: Date.now(),
          });
        } else {
          sendJson(res, 500, {
            success: false,
            error: error.message || "Internal server error",
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
