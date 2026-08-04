import { afterEach, describe, expect, test } from "bun:test";

import {
  BookApiClient,
  BookApiError,
  validateBookApiBaseUrl,
} from "../src/book-api-client";

const servers: Bun.Server<unknown>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

function startServer(fetch: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch });
  servers.push(server);
  return server;
}

describe("BOOK_API_BASE_URL validation", () => {
  test("accepts HTTP(S) URLs and normalizes a trailing slash", () => {
    expect(validateBookApiBaseUrl("http://127.0.0.1:3000/api").href).toBe(
      "http://127.0.0.1:3000/api/",
    );
  });

  test.each(["", "ftp://example.com", "https://user:pass@example.com"])(
    "rejects unsafe base URL %p",
    (value) => expect(() => validateBookApiBaseUrl(value)).toThrow(),
  );
});

describe("BookApiClient", () => {
  test("uses URLSearchParams for bounded REST search", async () => {
    let receivedUrl = "";
    const server = startServer((request) => {
      receivedUrl = request.url;
      return Response.json({
        items: [],
        meta: {
          total: 0,
          offset: 0,
          limit: 12,
          returned: 0,
          hasMore: false,
          nolimit: false,
        },
      });
    });

    const client = new BookApiClient(server.url.href, { timeoutMs: 500 });
    await client.searchBooks({
      search: "AI & safety",
      offset: 0,
      limit: 12,
      category: "Technology",
    });

    const url = new URL(receivedUrl);
    expect(url.pathname).toBe("/books");
    expect(url.searchParams.get("search")).toBe("AI & safety");
    expect(url.searchParams.get("nolimit")).toBe("false");
    expect(url.searchParams.get("category")).toBe("Technology");
  });

  test("rejects successful non-JSON responses", async () => {
    const server = startServer(() => new Response("ok", { status: 200 }));
    const client = new BookApiClient(server.url.href, { timeoutMs: 500 });

    await expect(client.getBook("book-000001")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  test("times out downstream requests", async () => {
    const server = startServer(
      () => new Promise((resolve) => setTimeout(() => resolve(Response.json({})), 100)),
    );
    const client = new BookApiClient(server.url.href, { timeoutMs: 10 });

    await expect(client.getBook("book-000001")).rejects.toMatchObject({
      code: "UPSTREAM_TIMEOUT",
    });
  });

  test("does not expose upstream bodies or file paths", async () => {
    const server = startServer(
      () =>
        Response.json(
          { error: { message: "failed at /private/app/books.json", stack: "secret" } },
          { status: 500 },
        ),
    );
    const client = new BookApiClient(server.url.href, { timeoutMs: 500 });

    const error = await client.getBook("book-000001").catch((value) => value);
    expect(error).toBeInstanceOf(BookApiError);
    expect(String(error)).not.toContain("/private/app");
    expect(String(error)).not.toContain("secret");
    expect(error).toMatchObject({ code: "UPSTREAM_ERROR", status: 500 });
  });
});
