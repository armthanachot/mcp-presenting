import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/app";
import { BookRepository } from "../src/repository";
import type { Book } from "../src/types";

const makeBook = (index: number, overrides: Partial<Book> = {}): Book => ({
  id: `book-${String(index).padStart(6, "0")}`,
  isbn: `978616${String(index).padStart(7, "0")}`,
  title: `Book ${index}`,
  subtitle: `A practical guide ${index}`,
  authors: [`Author ${index % 2}`],
  publisher: `Publisher ${index % 3}`,
  publishedYear: 2020 + (index % 5),
  language: index % 2 === 0 ? "en" : "th",
  categories: [index % 2 === 0 ? "Technology" : "Business"],
  tags: [index % 2 === 0 ? "ai" : "finance", "beginner"],
  format: index % 2 === 0 ? "paperback" : "ebook",
  pages: 200 + index,
  price: 100 + index * 10,
  currency: "THB",
  rating: 3.5 + index / 10,
  reviewCount: index * 10,
  stock: index,
  availability: index > 0 ? "in_stock" : "out_of_stock",
  coverImageUrl: `https://example.com/covers/${index}.jpg`,
  blurb: Array.from({ length: 6 }, (_, line) => `Book ${index} description line ${line + 1}.`),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides
});

const request = (app: ReturnType<typeof createApp>, path: string, init?: RequestInit) =>
  app.handle(new Request(`http://localhost${path}`, init));

describe("book API", () => {
  let directory: string;
  let dataPath: string;
  let seedPath: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "book-api-test-"));
    dataPath = join(directory, "books.json");
    seedPath = join(directory, "books.seed.json");
    const books = Array.from({ length: 8 }, (_, index) => makeBook(index + 1));
    await writeFile(dataPath, JSON.stringify(books));
    await writeFile(seedPath, JSON.stringify(books));
    app = createApp(await BookRepository.load({ dataPath, seedPath }));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test("health and stable 404 errors", async () => {
    expect(await (await request(app, "/health")).json()).toEqual({ status: "ok" });
    const response = await request(app, "/books/missing");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Book 'missing' was not found", details: [] }
    });
  });

  test("requires only offset and limit for paginated requests", async () => {
    const response = await request(app, "/books?offset=0&limit=20");
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.items).toHaveLength(8);
    expect(body.meta).toEqual({ total: 8, offset: 0, limit: 20, returned: 8, hasMore: false, nolimit: false });

    const missing = await request(app, "/books?search=book");
    expect(missing.status).toBe(400);
    const missingBody = await missing.json() as any;
    expect(missingBody.error.details).toContain("offset is required");
    expect(missingBody.error.details).toContain("limit is required");
  });

  test("paginates, searches Unicode-safe substrings, filters, and deterministically sorts", async () => {
    const query = "/books?offset=0&limit=2&search=book&nolimit=false&category=Technology&minPrice=100&sortBy=price&sortOrder=desc";
    const response = await request(app, query);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.items.map((book: Book) => book.id)).toEqual(["book-000008", "book-000006"]);
    expect(body.meta).toEqual({ total: 4, offset: 0, limit: 2, returned: 2, hasMore: true, nolimit: false });

    const unicode = makeBook(9, { title: "คู่มือปัญญาประดิษฐ์" });
    await request(app, "/books", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...unicode, id: undefined, availability: undefined, createdAt: undefined, updatedAt: undefined }) });
    const unicodeResponse = await request(app, "/books?offset=0&limit=10&search=ปัญญา&nolimit=false");
    expect((await unicodeResponse.json() as any).meta.total).toBe(1);
  });

  test("nolimit returns the unfiltered catalog, ignores pagination, and rejects optional query controls", async () => {
    const response = await request(app, "/books?nolimit=true&offset=invalid&limit=0&search=missing");
    const body = await response.json() as any;
    expect(body.items).toHaveLength(8);
    expect(body.meta).toEqual({ total: 8, offset: 0, limit: 8, returned: 8, hasMore: false, nolimit: true });

    const invalid = await request(app, "/books?offset=0&limit=1&search=&nolimit=true&language=en");
    expect(invalid.status).toBe(400);
  });

  test("supports every documented filter and validates ranges", async () => {
    const filtered = await request(app,
      "/books?offset=0&limit=20&search=&nolimit=false&author=Author%200&publisher=Publisher%202&language=en&format=paperback&tags=ai,beginner&minPrice=100&maxPrice=200&minRating=3&availableOnly=true&publishedFrom=2020&publishedTo=2024"
    );
    expect(filtered.status).toBe(200);
    const body = await filtered.json() as any;
    expect(body.items.map((book: Book) => book.id)).toEqual(["book-000002", "book-000008"]);

    const falseMeansNoAvailabilityFilter = await request(app,
      "/books?offset=0&limit=20&search=&nolimit=false&availableOnly=false"
    );
    expect((await falseMeansNoAvailabilityFilter.json() as any).meta.total).toBe(8);

    for (const suffix of ["minPrice=50&maxPrice=10", "publishedFrom=2025&publishedTo=2020", "minRating=6"]) {
      expect((await request(app, `/books?offset=0&limit=20&search=&nolimit=false&${suffix}`)).status).toBe(400);
    }
  });

  test("creates, reads, replaces, patches, and deletes a book", async () => {
    const input = makeBook(20, { rating: 4.2 });
    const createBody = { ...input } as Record<string, unknown>;
    delete createBody.id;
    delete createBody.availability;
    delete createBody.createdAt;
    delete createBody.updatedAt;
    const createdResponse = await request(app, "/books", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(createBody)
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as Book;
    expect(created.id).toBe("book-000009");
    expect(created.availability).toBe("in_stock");

    const duplicate = await request(app, "/books", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(createBody)
    });
    expect(duplicate.status).toBe(409);

    const replacement = { ...createBody, title: "Replacement", stock: 0 };
    const put = await request(app, `/books/${created.id}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(replacement)
    });
    expect((await put.json() as Book).availability).toBe("out_of_stock");

    const patch = await request(app, `/books/${created.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ price: 777 })
    });
    expect((await patch.json() as Book).price).toBe(777);

    expect((await request(app, `/books/${created.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await request(app, `/books/${created.id}`)).status).toBe(404);
  });

  test("rejects invalid, unknown, and empty mutation fields", async () => {
    for (const body of [{}, { surprise: true }, { price: -1 }, { blurb: ["too short"] }]) {
      const response = await request(app, "/books/book-000001", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
      });
      expect(response.status).toBe(400);
      expect((await response.json() as any).error.code).toBe("VALIDATION_ERROR");
    }
  });

  test("returns statistics, sorted facets, and deterministic similar books", async () => {
    const statistics = await (await request(app, "/books/statistics")).json() as any;
    expect(statistics.totalBooks).toBe(8);
    expect(statistics.totalStock).toBe(36);
    expect(statistics.price).toEqual({ min: 110, max: 180, average: 145 });
    expect(statistics.categories).toEqual({ Business: 4, Technology: 4 });

    const facets = await (await request(app, "/books/facets")).json() as any;
    expect(facets.languages).toEqual(["en", "th"]);
    expect(facets.authors).toEqual(["Author 0", "Author 1"]);

    const similar = await (await request(app, "/books/book-000002/similar?limit=3")).json() as any;
    expect(similar.source.id).toBe("book-000002");
    expect(similar.items).toHaveLength(3);
    expect(similar.items[0].book.id).toBe("book-000004");
    expect(similar.items[0].score).toBeGreaterThan(0);
    expect(similar.items[0].reasons.length).toBeGreaterThan(0);
  });

  test("serializes concurrent writes, persists reloads, and atomically resets from seed", async () => {
    const repository = await BookRepository.load({ dataPath, seedPath });
    await Promise.all(Array.from({ length: 20 }, (_, index) => repository.patch("book-000001", { price: 200 + index })));
    const diskBooks = JSON.parse(await readFile(dataPath, "utf8")) as Book[];
    expect(diskBooks).toHaveLength(8);
    expect(diskBooks.find((book) => book.id === "book-000001")?.price).toBe(219);
    const reloaded = await BookRepository.load({ dataPath, seedPath });
    expect(reloaded.findById("book-000001")?.price).toBe(219);
    await reloaded.reset();
    expect(reloaded.findById("book-000001")?.price).toBe(110);
  });
});
