import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import type { BookApiClient } from "./book-api-client";
import type { DemoOAuthServer } from "./demo-oauth";
import { createBookMcpServer } from "./server";

const MAX_REQUEST_BYTES = 1_000_000;

export interface McpHttpSecurityOptions {
  allowedHosts?: readonly string[];
  allowedOrigins?: readonly string[];
  oauth?: DemoOAuthServer;
}

function requestHostname(request: Request): string | undefined {
  const host = request.headers.get("host");
  if (!host) return undefined;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return undefined;
  }
}

async function withBoundedBody(request: Request): Promise<Request | Response> {
  if (request.body === null) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel().catch(() => undefined);
      return Response.json({ error: "Request body is too large" }, { status: 413 });
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request, { body });
}

export function createMcpHttpHandler(client: BookApiClient, options: McpHttpSecurityOptions = {}) {
  const allowedHosts = new Set(options.allowedHosts ?? ["127.0.0.1", "localhost"]);
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  return async function handle(request: Request): Promise<Response> {
    // const url = new URL(request.url);
    // if (url.pathname === "/health" && request.method === "GET") {
    //   return Response.json({
    //     status: "ok",
    //     transport: "streamable-http",
    //     sessionMode: "stateless",
    //     authentication: options.oauth ? "oauth" : "none",
    //   });
    // }

    // const hostname = requestHostname(request);
    // if (hostname === undefined || !allowedHosts.has(hostname)) {
    //   return Response.json({ error: "Host is not allowed" }, { status: 403 });
    // }
    // const origin = request.headers.get("origin");
    // if (origin !== null && !allowedOrigins.has(origin)) {
    //   return Response.json({ error: "Origin is not allowed" }, { status: 403 });
    // }

    // const contentLength = Number(request.headers.get("content-length") ?? "0");
    // if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    //   return Response.json({ error: "Request body is too large" }, { status: 413 });
    // }

    // if (url.pathname === "/mcp") {
    //   const unauthorized = options.oauth?.authorizeMcpRequest(request);
    //   if (unauthorized) return unauthorized;
    // }

    const bounded = await withBoundedBody(request);
    if (bounded instanceof Response) return bounded;

    // const oauthResponse = await options.oauth?.handleRoute(bounded);
    // if (oauthResponse) return oauthResponse;

    // if (url.pathname !== "/mcp") return Response.json({ error: "Not found" }, { status: 404 });

    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    const server = createBookMcpServer(client);
    try {
      await server.connect(transport);
      return await transport.handleRequest(bounded);
    } catch {
      return Response.json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal MCP transport error" },
        id: null,
      }, { status: 500 });
    } finally {
      await server.close().catch(() => undefined);
    }
  };
}
