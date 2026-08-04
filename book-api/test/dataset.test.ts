import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Book } from "../src/types";
import { validateCatalog } from "../src/validation";

describe("checked-in deterministic dataset", () => {
  test("contains exactly 10,000 valid books with unique IDs and ISBNs", async () => {
    const dataDirectory = join(import.meta.dir, "..", "data");
    const seed = JSON.parse(await readFile(join(dataDirectory, "books.seed.json"), "utf8")) as Book[];
    const runtime = JSON.parse(await readFile(join(dataDirectory, "books.json"), "utf8")) as Book[];
    expect(seed).toEqual(runtime);
    expect(seed).toHaveLength(10_000);
    expect(new Set(seed.map((book) => book.id)).size).toBe(10_000);
    expect(new Set(seed.map((book) => book.isbn)).size).toBe(10_000);
    expect(seed.every((book) => book.blurb.length >= 6 && book.blurb.every((line) => line.trim().length > 0))).toBe(true);
    expect(() => validateCatalog(seed)).not.toThrow();
  });
});
