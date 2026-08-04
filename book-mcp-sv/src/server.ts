import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as p from "path"
import * as fs from 'fs'
import { BookApiClient, BookApiError } from "./book-api-client";
import {
  compareBooksInputSchema,
  createBookInputSchema,
  deleteBookInputSchema,
  findSimilarBooksInputSchema,
  getBookDetailsInputSchema,
  getCatalogStatisticsInputSchema,
  recommendBooksInputSchema,
  searchBooksInputSchema,
  updateBookInputSchema,
  type RecommendBooksInput,
} from "./tool-schemas";
import type { Book, SearchBooksQuery } from "./types";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const MUTATING = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

function success(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function failure(error: unknown) {
  const safe = error instanceof BookApiError
    ? { code: error.code, message: error.message, ...(error.status === undefined ? {} : { status: error.status }) }
    : { code: "TOOL_EXECUTION_ERROR", message: "The tool could not complete the request" };
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: safe }) }],
  };
}

async function safely<T>(operation: () => Promise<T>) {
  try {
    return success(await operation());
  } catch (error) {
    return failure(error);
  }
}

function recommendationScore(book: Book, input: RecommendBooksInput): { score: number; reasons: string[] } {
  const topic = input.topic.toLocaleLowerCase();
  const reasons: string[] = [];
  let score = Math.round(book.rating * 100) + Math.min(book.reviewCount, 10_000) / 100;
  if (book.title.toLocaleLowerCase().includes(topic)) {
    score += 1_000;
    reasons.push("topic appears in title");
  }
  if ([...book.categories, ...book.tags].some((value) => value.toLocaleLowerCase().includes(topic))) {
    score += 500;
    reasons.push("topic matches category or tag");
  }
  if (book.blurb.some((line) => line.toLocaleLowerCase().includes(topic))) {
    score += 200;
    reasons.push("topic appears in blurb");
  }
  if (book.stock > 0) reasons.push("currently in stock");
  reasons.push(`rated ${book.rating.toFixed(1)} from ${book.reviewCount} reviews`);
  return { score: Math.round(score * 100) / 100, reasons };
}

function toSearchQuery(input: Parameters<typeof searchBooksInputSchema.parse>[0]): SearchBooksQuery {
  const parsed = searchBooksInputSchema.parse(input);
  return {
    search: parsed.query,
    offset: parsed.offset,
    limit: parsed.limit,
    ...(parsed.category === undefined ? {} : { category: parsed.category }),
    ...(parsed.author === undefined ? {} : { author: parsed.author }),
    ...(parsed.publisher === undefined ? {} : { publisher: parsed.publisher }),
    ...(parsed.language === undefined ? {} : { language: parsed.language }),
    ...(parsed.format === undefined ? {} : { format: parsed.format }),
    ...(parsed.tags === undefined ? {} : { tags: parsed.tags }),
    ...(parsed.minPrice === undefined ? {} : { minPrice: parsed.minPrice }),
    ...(parsed.maxPrice === undefined ? {} : { maxPrice: parsed.maxPrice }),
    ...(parsed.minRating === undefined ? {} : { minRating: parsed.minRating }),
    ...(parsed.availableOnly === undefined ? {} : { availableOnly: parsed.availableOnly }),
    ...(parsed.publishedFrom === undefined ? {} : { publishedFrom: parsed.publishedFrom }),
    ...(parsed.publishedTo === undefined ? {} : { publishedTo: parsed.publishedTo }),
    ...(parsed.sortBy === undefined ? {} : { sortBy: parsed.sortBy }),
    ...(parsed.sortOrder === undefined ? {} : { sortOrder: parsed.sortOrder }),
  };
}

export function createBookMcpServer(client: BookApiClient): McpServer {
  const server = new McpServer({
    name: "book-mcp-sv",
    version: "0.1.0"
  });

  server.registerTool("search_books", {
    title: "Search books",
    description: "Search and filter the book catalog. Results are always bounded and never use the REST nolimit escape hatch.",
    inputSchema: searchBooksInputSchema,
    annotations: READ_ONLY,
  }, (input) => safely(() => client.searchBooks(toSearchQuery(input))));

  server.registerTool("get_book_details", {
    title: "Get book details",
    description: "Get the complete catalog record for one book.",
    inputSchema: getBookDetailsInputSchema,
    annotations: READ_ONLY,
  }, ({ bookId }) => safely(() => client.getBook(bookId)));

  server.registerTool("recommend_books", {
    title: "Recommend books",
    description: "Deterministically rank matching catalog books without invoking another language model.",
    inputSchema: recommendBooksInputSchema,
    annotations: READ_ONLY,
  }, (input) => safely(async () => {
    const response = await client.searchBooks({
      search: input.topic,
      offset: 0,
      limit: 50,
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(input.language === undefined ? {} : { language: input.language }),
      ...(input.maxBudget === undefined ? {} : { maxPrice: input.maxBudget }),
      ...(input.minRating === undefined ? {} : { minRating: input.minRating }),
      availableOnly: input.availableOnly,
    });
    const items = response.items
      .map((book) => ({ book, ...recommendationScore(book, input) }))
      .sort((left, right) => right.score - left.score || left.book.id.localeCompare(right.book.id))
      .slice(0, input.limit);
    return { criteria: input, items };
  }));

  server.registerTool("compare_books", {
    title: "Compare books",
    description: "Fetch two to ten books and return them in the exact order requested.",
    inputSchema: compareBooksInputSchema,
    annotations: READ_ONLY,
  }, ({ bookIds }) => safely(async () => ({
    items: await Promise.all(bookIds.map((bookId) => client.getBook(bookId))),
  })));

  server.registerTool("find_similar_books", {
    title: "Find similar books",
    description: "Find books with overlapping categories, tags, or authors.",
    inputSchema: findSimilarBooksInputSchema,
    annotations: READ_ONLY,
  }, ({ bookId, limit }) => safely(() => client.findSimilar(bookId, limit)));

  server.registerTool("get_catalog_statistics", {
    title: "Get catalog statistics",
    description: "Get aggregate book, stock, price, category, and language statistics.",
    inputSchema: getCatalogStatisticsInputSchema,
    annotations: READ_ONLY,
  }, () => safely(() => client.getStatistics()));

  server.registerTool("create_book", {
    title: "Create a book",
    description: "Create one validated catalog book through the REST API.",
    inputSchema: createBookInputSchema,
    annotations: MUTATING,
  }, ({ book }) => safely(() => client.createBook(book)));

  server.registerTool("update_book", {
    title: "Update a book",
    description: "Patch one or more mutable fields on an existing catalog book.",
    inputSchema: updateBookInputSchema,
    annotations: MUTATING,
  }, ({ bookId, changes }) => safely(() => client.updateBook(bookId, changes)));

  server.registerTool("delete_book", {
    title: "Delete a book",
    description: "Permanently delete a catalog book through the REST API.",
    inputSchema: deleteBookInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, ({ bookId }) => safely(() => client.deleteBook(bookId)));

  registerResources(server)

  return server;
}

const registerResources = (server: McpServer) => {

  server.registerResource(
    "investor guide",
    "investment://documents/investor_guide_book.pdf",
    {
      title: "Investor Guide",
      description: "Document for beginner Investor",
      mimeType: "application/pdf"
    },
    async (uri) => {
      const filePath = p.resolve(process.cwd(), "docs/investor_guide_book.pdf")
      const pdfBuffer = fs.readFileSync(filePath);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/pdf",
            blob: pdfBuffer.toString("base64"),
          }
        ]
      }
    }
  )
}