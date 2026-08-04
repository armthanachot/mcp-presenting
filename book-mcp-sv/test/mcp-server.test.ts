import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { BookApiClient } from "../src/book-api-client";
import { createBookMcpServer } from "../src/server";

const servers: Bun.Server<unknown>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

const book = (id: string, title = `Title ${id}`) => ({
  id,
  isbn: `978000${id.replace(/\D/g, "").padStart(6, "0")}`,
  title,
  authors: ["Ada Author"],
  publisher: "Demo Press",
  publishedYear: 2025,
  language: "en",
  categories: ["Technology"],
  tags: ["ai", "beginner"],
  format: "paperback",
  pages: 240,
  price: 499,
  currency: "THB",
  rating: 4.5,
  reviewCount: 100,
  stock: 5,
  availability: "in_stock",
  coverImageUrl: "https://example.com/cover.jpg",
  blurb: ["One", "Two", "Three", "Four", "Five", "Six"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

function startApi(options: { failDetails?: boolean } = {}) {
  const calls: Array<{ method: string; pathname: string; body?: unknown }> = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      const body = request.method === "GET" || request.method === "DELETE"
        ? undefined
        : await request.json();
      calls.push({ method: request.method, pathname: url.pathname, body });

      if (options.failDetails && url.pathname === "/books/book-000001") {
        return Response.json(
          { error: { message: "ENOENT /private/catalog/books.json", stack: "secret" } },
          { status: 500 },
        );
      }
      if (url.pathname === "/books/statistics") {
        return Response.json({ totalBooks: 2, totalStock: 10, availableBooks: 2, outOfStockBooks: 0, price: { min: 399, max: 499, average: 449 }, categories: { Technology: 2 }, languages: { en: 2 } });
      }
      if (url.pathname.endsWith("/similar")) {
        return Response.json({ source: book("book-000001"), items: [{ book: book("book-000002"), score: 3, reasons: ["category:Technology"] }] });
      }
      if (url.pathname === "/books" && request.method === "GET") {
        return Response.json({ items: [book("book-000001"), book("book-000002")], meta: { total: 2, offset: 0, limit: 10, returned: 2, hasMore: false, nolimit: false } });
      }
      if (url.pathname === "/books" && request.method === "POST") {
        return Response.json(book("book-010001", "Created"), { status: 201 });
      }
      if (request.method === "PATCH") return Response.json(book("book-000001", "Updated"));
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      const id = url.pathname.split("/").at(-1) ?? "book-000001";
      return Response.json(book(id));
    },
  });
  servers.push(server);
  return { server, calls };
}

async function connect(baseUrl: string) {
  const mcpServer = createBookMcpServer(new BookApiClient(baseUrl, { timeoutMs: 500 }));
  const client = new Client({ name: "book-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);
  return { client, mcpServer };
}

describe("book MCP tools", () => {
  test("discovers and calls every tool through the REST API", async () => {
    const { server, calls } = startApi();
    const { client, mcpServer } = await connect(server.url.href);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
        "compare_books",
        "create_book",
        "delete_book",
        "find_similar_books",
        "get_book_details",
        "get_catalog_statistics",
        "recommend_books",
        "search_books",
        "update_book",
      ]);
      expect(listed.tools.find((tool) => tool.name === "search_books")?.annotations?.readOnlyHint).toBe(true);
      expect(listed.tools.find((tool) => tool.name === "delete_book")?.annotations?.destructiveHint).toBe(true);

      const callsToMake = [
        ["search_books", { query: "AI", limit: 5 }],
        ["get_book_details", { bookId: "book-000001" }],
        ["recommend_books", { topic: "AI", limit: 2, maxBudget: 1000 }],
        ["compare_books", { bookIds: ["book-000002", "book-000001"] }],
        ["find_similar_books", { bookId: "book-000001", limit: 3 }],
        ["get_catalog_statistics", {}],
        ["create_book", { book: { isbn: "9789999999999", title: "Created", authors: ["Ada Author"], publisher: "Demo Press", publishedYear: 2026, language: "en", categories: ["Technology"], tags: ["ai"], format: "paperback", pages: 200, price: 450, currency: "THB", rating: 0, reviewCount: 0, stock: 3, coverImageUrl: "https://example.com/new.jpg", blurb: ["One", "Two", "Three", "Four", "Five", "Six"] } }],
        ["update_book", { bookId: "book-000001", changes: { title: "Updated" } }],
        ["delete_book", { bookId: "book-000002" }],
      ] as const;

      for (const [name, args] of callsToMake) {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).not.toBe(true);
      }

      const comparison = JSON.stringify(await client.callTool({
        name: "compare_books",
        arguments: { bookIds: ["book-000002", "book-000001"] },
      }));
      expect(comparison.indexOf("book-000002")).toBeLessThan(comparison.indexOf("book-000001"));

      expect(calls.some((call) => call.method === "POST" && call.pathname === "/books")).toBe(true);
      expect(calls.some((call) => call.method === "PATCH")).toBe(true);
      expect(calls.some((call) => call.method === "DELETE")).toBe(true);
    } finally {
      await client.close();
      await mcpServer.close();
    }
  });

  test("returns a sanitized tool error when the REST API fails", async () => {
    const { server } = startApi({ failDetails: true });
    const { client, mcpServer } = await connect(server.url.href);
    try {
      const result = await client.callTool({ name: "get_book_details", arguments: { bookId: "book-000001" } });
      expect(result.isError).toBe(true);
      const rendered = JSON.stringify(result);
      expect(rendered).not.toContain("/private/catalog");
      expect(rendered).not.toContain("secret");
    } finally {
      await client.close();
      await mcpServer.close();
    }
  });

  test("returns a sanitized isError result when the REST API is down", async () => {
    const { client, mcpServer } = await connect("http://127.0.0.1:1");
    try {
      const result = await client.callTool({ name: "get_book_details", arguments: { bookId: "book-000001" } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain("UPSTREAM_UNAVAILABLE");
      expect(JSON.stringify(result)).not.toContain("ECONNREFUSED");
    } finally {
      await client.close();
      await mcpServer.close();
    }
  });
});
