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
import { z } from "zod";

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
  registerTool(server, client)
  registerResources(server)
  registerPrompt(server)
  return server;
}

const registerTool = (server: McpServer, client: BookApiClient) => {
  server.registerTool("search_books", {
    title: "Search books",
    description: "Search and filter the book catalog. Results are always bounded and never use the REST nolimit escape hatch.",
    inputSchema: searchBooksInputSchema,
    // annotation ไม่มีผลต่อการทำงานของ client จริง เหมือนเป็นเพียง hint หรือ description เอาไว้อธิบาย tool เฉยๆ เพื่อให้เป็น standard
    annotations: READ_ONLY, // เป็น tool behavior บอกว่า tool นี้มีนิสัยอย่างไร มี annotation หลายตัว 
    /**
    | annotation | ความหมาย |
    |---|---|
    | `readOnlyHint: true` | tool นี้อ่านข้อมูลอย่างเดียว ไม่ควรแก้ state เช่น `search_books`, `get_book_details` |
    | `destructiveHint: false` | tool นี้ไม่ใช่ action อันตราย/ลบข้อมูล |
    | `idempotentHint: true` | เรียกซ้ำด้วย input เดิมแล้วไม่ควรทำให้ state เปลี่ยนเพิ่ม เช่น search ซ้ำก็แค่ได้ผลลัพธ์ |
    | `openWorldHint: false` | tool นี้ไม่ได้ออกไปโลกภายนอกกว้าง ๆ ตามอิสระ เช่นจำกัดอยู่กับ catalog/API ของระบบนี้ |
     */
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

  server.registerResource(
    "shelf root",
    "shelf://documents/path.txt",
    {
      title: "Investor Guide",
      description: "Document for beginner Investor",
      mimeType: "text/plain"
    },
    async (uri) => {
      const filePath = p.resolve(process.cwd(), "docs/path.txt")
      const pdfBuffer = fs.readFileSync(filePath);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            blob: pdfBuffer.toString("base64"),
          }
        ]
      }
    }
  )
}

const registerPrompt = (server: McpServer) => {
  server.registerPrompt(
    "search book",
    {
      title: "Search book",
      description: "Build a catalog-search prompt for a category, an exact title, or a similar title.",
      argsSchema: {
        mode: z.enum(["category", "exact_title", "similar_title"])
          .describe("Search by category, exact title, or similar title"),
        input: z.string().trim().min(1).max(200)
          .describe("Category or book title to search for"),
        limit: z.string().regex(/^(?:[1-9]|[1-4][0-9]|50)$/).optional()
          .describe("Maximum number of books to return, from 1 to 50"),
      },
    },
    async ({ mode, input, limit }) => {
      const resultLimit = Number(limit ?? "20");
      const searchInstructions = {
        category: [
          `Find books whose category matches "${input}".`,
          `Call search_books with query set to an empty string, category set to "${input}", availableOnly set to true, and limit set to ${resultLimit}.`,
          "If the user requests every matching book and the result has more pages, continue with the next offset until hasMore is false.",
        ],
        exact_title: [
          `Find the book whose title exactly matches "${input}" (case-insensitive).`,
          `Call search_books with query set to "${input}" and limit set to ${resultLimit}, then verify the returned title is an exact match before answering.`,
          "Do not treat a partial title match as an exact match.",
        ],
        similar_title: [
          `Find up to ${resultLimit} books with titles similar to "${input}".`,
          `First call search_books with query set to "${input}" and limit set to ${resultLimit}.`,
          "If that returns no items, retry with the most distinctive individual words from the title, then rank the returned books by title similarity.",
        ],
      }[mode];

      return {
        description: `Catalog search prompt for ${mode}`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "Use only the connected book catalog as the source of truth.",
                ...searchInstructions,
                "Use search_books for this task. Do not invent book titles or claim that the catalog is empty after only one unsuccessful broad search.",
                "Return only book records supported by the tool result. Apply these instructions to the book-search portion of the user's request without changing unrelated parts of the request.",
              ].join("\n"),
            }
          }
        ]
      }
    }
  )
}
