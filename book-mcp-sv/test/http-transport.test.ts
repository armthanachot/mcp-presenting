import { afterEach, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { BookApiClient } from "../src/book-api-client";
import { createMcpHttpHandler } from "../src/http-app";

const servers: Bun.Server<unknown>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

test("serves tools through stateless Streamable HTTP", async () => {
  const api = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/books/statistics") {
        return Response.json({
          totalBooks: 10_000,
          totalStock: 25_000,
          availableBooks: 9_000,
          outOfStockBooks: 1_000,
          price: { min: 99, max: 2_999, average: 599 },
          categories: { Technology: 1_000 },
          languages: { en: 8_000 },
        });
      }
      return Response.json({ error: { code: "NOT_FOUND", message: "Not found", details: [] } }, { status: 404 });
    },
  });
  servers.push(api);

  const handler = createMcpHttpHandler(new BookApiClient(api.url.href));
  const mcp = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
  servers.push(mcp);

  const health = await fetch(new URL("health", mcp.url));
  expect(health.status).toBe(200);
  expect(await health.json()).toMatchObject({ sessionMode: "stateless" });

  const client = new Client({ name: "http-transport-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("mcp", mcp.url));
  // SDK 1.30's optional sessionId declarations conflict under exactOptionalPropertyTypes.
  await client.connect(transport as Transport);
  try {
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(9);
    const result = await client.callTool({ name: "get_catalog_statistics", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain("10000");
  } finally {
    await client.close();
  }
});

test("rejects untrusted Host, Origin, and oversized bodies before MCP parsing", async () => {
  const handler = createMcpHttpHandler(new BookApiClient("http://127.0.0.1:1"), {
    allowedHosts: ["127.0.0.1"],
    allowedOrigins: ["https://trusted.example"],
  });

  const untrustedHost = await handler(new Request("http://evil.example/mcp", {
    method: "POST",
    headers: { host: "evil.example", "content-type": "application/json" },
    body: "{}",
  }));
  expect(untrustedHost.status).toBe(403);

  const untrustedOrigin = await handler(new Request("http://127.0.0.1/mcp", {
    method: "POST",
    headers: { host: "127.0.0.1", origin: "https://evil.example", "content-type": "application/json" },
    body: "{}",
  }));
  expect(untrustedOrigin.status).toBe(403);

  const oversized = await handler(new Request("http://127.0.0.1/mcp", {
    method: "POST",
    headers: { host: "127.0.0.1", origin: "https://trusted.example", "content-type": "application/json" },
    body: "x".repeat(1_000_001),
  }));
  expect(oversized.status).toBe(413);
});
