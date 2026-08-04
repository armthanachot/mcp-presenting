import type {
  Book,
  BookChanges,
  BookListResponse,
  BookWriteInput,
  CatalogStatistics,
  SearchBooksQuery,
  SimilarBooksResponse,
} from "./types";

const DEFAULT_TIMEOUT_MS = 5_000;

export class BookApiError extends Error {
  constructor(
    readonly code:
      | "INVALID_RESPONSE"
      | "UPSTREAM_TIMEOUT"
      | "UPSTREAM_UNAVAILABLE"
      | "UPSTREAM_NOT_FOUND"
      | "UPSTREAM_CONFLICT"
      | "UPSTREAM_ERROR",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "BookApiError";
  }
}

export function validateBookApiBaseUrl(value: string | undefined): URL {
  if (!value?.trim()) throw new Error("BOOK_API_BASE_URL is required");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("BOOK_API_BASE_URL must be a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("BOOK_API_BASE_URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("BOOK_API_BASE_URL must not contain credentials");
  }
  if (url.search || url.hash) {
    throw new Error("BOOK_API_BASE_URL must not contain a query or fragment");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

export interface BookApiClientOptions {
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export class BookApiClient {
  readonly baseUrl: URL;
  readonly timeoutMs: number;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(baseUrl: string, options: BookApiClientOptions = {}) {
    this.baseUrl = validateBookApiBaseUrl(baseUrl);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000) {
      throw new Error("timeoutMs must be an integer between 1 and 60000");
    }
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  searchBooks(query: SearchBooksQuery): Promise<BookListResponse> {
    const params = new URLSearchParams({
      offset: String(query.offset ?? 0),
      limit: String(query.limit ?? 20),
      search: query.search,
      nolimit: "false",
    });
    const optional = {
      category: query.category,
      author: query.author,
      publisher: query.publisher,
      language: query.language,
      format: query.format,
      tags: query.tags,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      minRating: query.minRating,
      availableOnly: query.availableOnly,
      publishedFrom: query.publishedFrom,
      publishedTo: query.publishedTo,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    };
    for (const [key, value] of Object.entries(optional)) {
      if (value !== undefined) params.set(key, String(value));
    }
    return this.request<BookListResponse>("books", { params });
  }

  getBook(bookId: string): Promise<Book> {
    return this.request<Book>(`books/${encodeURIComponent(bookId)}`);
  }

  findSimilar(bookId: string, limit: number): Promise<SimilarBooksResponse> {
    return this.request<SimilarBooksResponse>(`books/${encodeURIComponent(bookId)}/similar`, {
      params: new URLSearchParams({ limit: String(limit) }),
    });
  }

  getStatistics(): Promise<CatalogStatistics> {
    return this.request<CatalogStatistics>("books/statistics");
  }

  createBook(book: BookWriteInput): Promise<Book> {
    return this.request<Book>("books", { method: "POST", body: book });
  }

  updateBook(bookId: string, changes: BookChanges): Promise<Book> {
    return this.request<Book>(`books/${encodeURIComponent(bookId)}`, {
      method: "PATCH",
      body: changes,
    });
  }

  async deleteBook(bookId: string): Promise<{ deleted: true; bookId: string }> {
    await this.request<void>(`books/${encodeURIComponent(bookId)}`, { method: "DELETE" });
    return { deleted: true, bookId };
  }

  private async request<T>(
    path: string,
    options: { method?: "GET" | "POST" | "PATCH" | "DELETE"; params?: URLSearchParams; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (options.params) url.search = options.params.toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers = new Headers({ Accept: "application/json" });
      if (options.body !== undefined) headers.set("Content-Type", "application/json");
      const response = await this.fetcher(url, {
        method: options.method ?? "GET",
        headers,
        signal: controller.signal,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });

      if (!response.ok) throw this.statusError(response.status);
      if (response.status === 204) return undefined as T;

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("application/json") && !/application\/[^;]+\+json/.test(contentType)) {
        throw new BookApiError("INVALID_RESPONSE", "Book API returned a non-JSON response");
      }
      try {
        return (await response.json()) as T;
      } catch {
        throw new BookApiError("INVALID_RESPONSE", "Book API returned invalid JSON");
      }
    } catch (error) {
      if (error instanceof BookApiError) throw error;
      if (controller.signal.aborted) {
        throw new BookApiError("UPSTREAM_TIMEOUT", "Book API request timed out");
      }
      throw new BookApiError("UPSTREAM_UNAVAILABLE", "Book API is unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }

  private statusError(status: number): BookApiError {
    if (status === 404) return new BookApiError("UPSTREAM_NOT_FOUND", "Book was not found", status);
    if (status === 409) return new BookApiError("UPSTREAM_CONFLICT", "Book API rejected a conflicting change", status);
    return new BookApiError("UPSTREAM_ERROR", `Book API request failed with status ${status}`, status);
  }
}
