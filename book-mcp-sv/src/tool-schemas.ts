import { z } from "zod";

const shortText = z.string().trim().min(1).max(200);
const stringList = z.array(shortText).min(1).max(20);
const bookId = z.string().regex(/^book-[A-Za-z0-9_-]{1,64}$/);

const bookWriteFields = {
  isbn: z.string().trim().min(10).max(20),
  title: shortText,
  subtitle: z.string().trim().min(1).max(300).optional(),
  authors: stringList,
  publisher: shortText,
  publishedYear: z.number().int().min(1000).max(2100),
  language: z.string().trim().min(2).max(20),
  categories: stringList,
  tags: z.array(shortText).max(30),
  format: z.enum(["hardcover", "paperback", "ebook", "audiobook"]),
  pages: z.number().int().min(1).max(20_000),
  price: z.number().finite().min(0).max(10_000_000),
  currency: z.literal("THB"),
  rating: z.number().finite().min(0).max(5),
  reviewCount: z.number().int().min(0).max(1_000_000_000),
  stock: z.number().int().min(0).max(1_000_000),
  coverImageUrl: z.string().url().max(2_000),
  blurb: z.array(z.string().trim().min(1).max(500)).min(6).max(20),
};

export const searchBooksInputSchema = z.object({
  query: z.string().max(200).default(""),
  offset: z.number().int().min(0).max(1_000_000).default(0),
  limit: z.number().int().min(1).max(50).default(20),
  category: shortText.optional(),
  author: shortText.optional(),
  publisher: shortText.optional(),
  language: z.string().trim().min(2).max(20).optional(),
  format: shortText.optional(),
  tags: shortText.optional(),
  minPrice: z.number().finite().min(0).max(10_000_000).optional(),
  maxPrice: z.number().finite().min(0).max(10_000_000).optional(),
  minRating: z.number().finite().min(0).max(5).optional(),
  availableOnly: z.boolean().optional(),
  publishedFrom: z.number().int().min(1000).max(2100).optional(),
  publishedTo: z.number().int().min(1000).max(2100).optional(),
  sortBy: z.enum(["title", "publishedYear", "price", "rating", "reviewCount", "stock", "createdAt"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
}).strict();

export const getBookDetailsInputSchema = z.object({ bookId }).strict();

export const recommendBooksInputSchema = z.object({
  topic: z.string().trim().min(1).max(200),
  category: shortText.optional(),
  language: z.string().trim().min(2).max(20).optional(),
  maxBudget: z.number().finite().min(0).max(10_000_000).optional(),
  minRating: z.number().finite().min(0).max(5).optional(),
  availableOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(10).default(5),
}).strict();

export const compareBooksInputSchema = z.object({
  bookIds: z.array(bookId).min(2).max(10),
}).strict();

export const findSimilarBooksInputSchema = z.object({
  bookId,
  limit: z.number().int().min(1).max(20).default(5),
}).strict();

export const getCatalogStatisticsInputSchema = z.object({}).strict();

export const createBookInputSchema = z.object({
  book: z.object(bookWriteFields).strict(),
}).strict();

export const updateBookInputSchema = z.object({
  bookId,
  changes: z.object(bookWriteFields).partial().strict().refine(
    (value) => Object.keys(value).length > 0,
    "At least one change is required",
  ),
}).strict();

export const deleteBookInputSchema = z.object({ bookId }).strict();

export type SearchBooksInput = z.infer<typeof searchBooksInputSchema>;
export type RecommendBooksInput = z.infer<typeof recommendBooksInputSchema>;
