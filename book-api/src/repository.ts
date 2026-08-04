import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ApiError } from "./errors";
import type { Book, BookPatch, ListQuery, ListResult, MutableBookFields, RepositoryPaths, SimilarBook } from "./types";
import { queryBooks } from "./query";
import { validateBook, validateCatalog, validateMutationInput } from "./validation";

const clone = <T>(value: T): T => structuredClone(value);

export class BookRepository {
  private tail: Promise<void> = Promise.resolve();

  private constructor(private readonly paths: RepositoryPaths, private catalog: Book[]) {}

  static async load(paths: RepositoryPaths): Promise<BookRepository> {
    const raw = JSON.parse(await readFile(paths.dataPath, "utf8")) as unknown;
    return new BookRepository(paths, validateCatalog(raw));
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async persist(candidate: Book[]): Promise<void> {
    const temporaryPath = join(dirname(this.paths.dataPath), `.books-${process.pid}-${crypto.randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, JSON.stringify(candidate));
      await rename(temporaryPath, this.paths.dataPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  list(query: ListQuery): ListResult {
    return queryBooks(this.catalog, query);
  }

  findById(id: string): Book | undefined {
    const book = this.catalog.find((candidate) => candidate.id === id);
    return book ? clone(book) : undefined;
  }

  async create(raw: unknown): Promise<Book> {
    const input = validateMutationInput(raw, "create") as MutableBookFields;
    return this.enqueue(async () => {
      if (this.catalog.some((book) => book.isbn === input.isbn)) {
        throw new ApiError(409, "CONFLICT", `ISBN '${input.isbn}' already exists`);
      }
      const highestId = this.catalog.reduce((highest, book) => Math.max(highest, Number(book.id.slice(5))), 0);
      const timestamp = new Date().toISOString();
      const book = validateBook({
        ...clone(input),
        id: `book-${String(highestId + 1).padStart(6, "0")}`,
        availability: input.stock > 0 ? "in_stock" : "out_of_stock",
        createdAt: timestamp,
        updatedAt: timestamp
      });
      const candidate = [...this.catalog, book];
      await this.persist(candidate);
      this.catalog = candidate;
      return clone(book);
    });
  }

  async put(id: string, raw: unknown): Promise<Book> {
    const input = validateMutationInput(raw, "put") as MutableBookFields;
    return this.replace(id, input);
  }

  async patch(id: string, raw: unknown): Promise<Book> {
    const patch = validateMutationInput(raw, "patch") as BookPatch;
    return this.enqueue(async () => {
      const current = this.catalog.find((book) => book.id === id);
      if (!current) throw new ApiError(404, "NOT_FOUND", `Book '${id}' was not found`);
      const mutable = { ...current, ...clone(patch) };
      const updated = validateBook({
        ...mutable,
        id: current.id,
        availability: mutable.stock > 0 ? "in_stock" : "out_of_stock",
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString()
      });
      this.ensureUniqueIsbn(updated.isbn, id);
      return this.commitReplacement(id, updated);
    });
  }

  private replace(id: string, input: MutableBookFields): Promise<Book> {
    return this.enqueue(async () => {
      const current = this.catalog.find((book) => book.id === id);
      if (!current) throw new ApiError(404, "NOT_FOUND", `Book '${id}' was not found`);
      this.ensureUniqueIsbn(input.isbn, id);
      const updated = validateBook({
        ...clone(input), id, availability: input.stock > 0 ? "in_stock" : "out_of_stock",
        createdAt: current.createdAt, updatedAt: new Date().toISOString()
      });
      return this.commitReplacement(id, updated);
    });
  }

  private ensureUniqueIsbn(isbn: string, exceptId: string): void {
    if (this.catalog.some((book) => book.id !== exceptId && book.isbn === isbn)) {
      throw new ApiError(409, "CONFLICT", `ISBN '${isbn}' already exists`);
    }
  }

  private async commitReplacement(id: string, updated: Book): Promise<Book> {
    const candidate = this.catalog.map((book) => book.id === id ? updated : book);
    await this.persist(candidate);
    this.catalog = candidate;
    return clone(updated);
  }

  async delete(id: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.catalog.some((book) => book.id === id)) {
        throw new ApiError(404, "NOT_FOUND", `Book '${id}' was not found`);
      }
      const candidate = this.catalog.filter((book) => book.id !== id);
      await this.persist(candidate);
      this.catalog = candidate;
    });
  }

  async reset(): Promise<{ restored: number }> {
    return this.enqueue(async () => {
      const seed = validateCatalog(JSON.parse(await readFile(this.paths.seedPath, "utf8")) as unknown);
      await this.persist(seed);
      this.catalog = seed;
      return { restored: seed.length };
    });
  }

  statistics() {
    const categoryCounts: Record<string, number> = {};
    const languageCounts: Record<string, number> = {};
    let totalStock = 0;
    let priceTotal = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const book of this.catalog) {
      totalStock += book.stock;
      priceTotal += book.price;
      min = Math.min(min, book.price);
      max = Math.max(max, book.price);
      for (const category of book.categories) categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
      languageCounts[book.language] = (languageCounts[book.language] ?? 0) + 1;
    }
    const ordered = (counts: Record<string, number>) => Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
    return {
      totalBooks: this.catalog.length,
      totalStock,
      availableBooks: this.catalog.filter((book) => book.stock > 0).length,
      outOfStockBooks: this.catalog.filter((book) => book.stock === 0).length,
      price: this.catalog.length === 0 ? { min: null, max: null, average: null } : {
        min, max, average: Number((priceTotal / this.catalog.length).toFixed(2))
      },
      categories: ordered(categoryCounts),
      languages: ordered(languageCounts)
    };
  }

  facets() {
    const values = (selector: (book: Book) => string[]) =>
      [...new Set(this.catalog.flatMap(selector))].sort((a, b) => a.localeCompare(b));
    return {
      categories: values((book) => book.categories),
      authors: values((book) => book.authors),
      publishers: values((book) => [book.publisher]),
      languages: values((book) => [book.language]),
      formats: values((book) => [book.format])
    };
  }

  similar(id: string, limit: number): { source: Book; items: SimilarBook[] } {
    const source = this.catalog.find((book) => book.id === id);
    if (!source) throw new ApiError(404, "NOT_FOUND", `Book '${id}' was not found`);
    const overlap = (left: string[], right: string[]) => left.filter((value) => right.includes(value));
    const items = this.catalog
      .filter((book) => book.id !== id)
      .map((book): SimilarBook => {
        const authors = overlap(source.authors, book.authors);
        const categories = overlap(source.categories, book.categories);
        const tags = overlap(source.tags, book.tags);
        const reasons = [
          ...authors.map((value) => `same author: ${value}`),
          ...categories.map((value) => `shared category: ${value}`),
          ...tags.map((value) => `shared tag: ${value}`)
        ];
        return { book: clone(book), score: authors.length * 4 + categories.length * 3 + tags.length * 2, reasons };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.book.id.localeCompare(b.book.id))
      .slice(0, limit);
    return { source: clone(source), items };
  }
}
