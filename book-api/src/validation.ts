import { validationError } from "./errors";
import type { Book, BookPatch, MutableBookFields } from "./types";

const MUTABLE_FIELDS = [
  "isbn", "title", "subtitle", "authors", "publisher", "publishedYear", "language",
  "categories", "tags", "format", "pages", "price", "currency", "rating",
  "reviewCount", "stock", "coverImageUrl", "blurb"
] as const;

const REQUIRED_MUTABLE_FIELDS = MUTABLE_FIELDS.filter((field) => field !== "subtitle");
const BOOK_FIELDS = ["id", ...MUTABLE_FIELDS, "availability", "createdAt", "updatedAt"] as const;
const mutableFieldSet = new Set<string>(MUTABLE_FIELDS);
const bookFieldSet = new Set<string>(BOOK_FIELDS);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isStringList = (value: unknown, minimum = 1): value is string[] =>
  Array.isArray(value) && value.length >= minimum && value.every(isNonEmptyString);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const validateFields = (value: Record<string, unknown>, includeSystemFields: boolean): string[] => {
  const details: string[] = [];
  const checkString = (field: string) => {
    if (!isNonEmptyString(value[field])) details.push(`${field} must be a non-empty string`);
  };
  const checkInteger = (field: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER) => {
    const candidate = value[field];
    if (!Number.isInteger(candidate) || (candidate as number) < minimum || (candidate as number) > maximum) {
      details.push(`${field} must be an integer from ${minimum} through ${maximum}`);
    }
  };
  const checkNumber = (field: string, minimum: number, maximum: number) => {
    const candidate = value[field];
    if (!isFiniteNumber(candidate) || candidate < minimum || candidate > maximum) {
      details.push(`${field} must be a finite number from ${minimum} through ${maximum}`);
    }
  };

  checkString("isbn");
  checkString("title");
  if (value.subtitle !== undefined && !isNonEmptyString(value.subtitle)) {
    details.push("subtitle must be a non-empty string when supplied");
  }
  if (!isStringList(value.authors)) details.push("authors must contain at least one non-empty string");
  checkString("publisher");
  checkInteger("publishedYear", 1000, 2100);
  checkString("language");
  if (!isStringList(value.categories)) details.push("categories must contain at least one non-empty string");
  if (!isStringList(value.tags)) details.push("tags must contain at least one non-empty string");
  checkString("format");
  checkInteger("pages", 1);
  checkNumber("price", 0, Number.MAX_SAFE_INTEGER);
  if (value.currency !== "THB") details.push("currency must be THB");
  checkNumber("rating", 0, 5);
  checkInteger("reviewCount", 0);
  checkInteger("stock", 0);
  checkString("coverImageUrl");
  if (isNonEmptyString(value.coverImageUrl)) {
    try {
      const url = new URL(value.coverImageUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") details.push("coverImageUrl must use http or https");
    } catch {
      details.push("coverImageUrl must be a valid URL");
    }
  }
  if (!isStringList(value.blurb, 6)) details.push("blurb must contain at least six non-empty strings");

  if (includeSystemFields) {
    if (!isNonEmptyString(value.id) || !/^book-\d{6,}$/.test(value.id)) {
      details.push("id must use the book-NNNNNN format");
    }
    const expectedAvailability = typeof value.stock === "number" && value.stock > 0 ? "in_stock" : "out_of_stock";
    if (value.availability !== expectedAvailability) details.push("availability must be derived from stock");
    for (const field of ["createdAt", "updatedAt"] as const) {
      if (!isNonEmptyString(value[field]) || Number.isNaN(Date.parse(value[field] as string))) {
        details.push(`${field} must be a valid ISO date-time string`);
      }
    }
  }
  return details;
};

export const validateMutationInput = (raw: unknown, mode: "create" | "put" | "patch"): MutableBookFields | BookPatch => {
  if (!isRecord(raw)) throw validationError(["body must be a JSON object"]);
  const keys = Object.keys(raw);
  if (keys.length === 0) throw validationError(["body must contain at least one mutable field"]);
  const unknown = keys.filter((key) => !mutableFieldSet.has(key));
  if (unknown.length > 0) throw validationError(unknown.map((field) => `unknown field: ${field}`));

  if (mode !== "patch") {
    const missing = REQUIRED_MUTABLE_FIELDS.filter((field) => !(field in raw));
    if (missing.length > 0) throw validationError(missing.map((field) => `${field} is required`));
  }

  if (mode === "patch") return { ...raw } as BookPatch;
  const details = validateFields(raw, false);
  if (details.length > 0) throw validationError(details);
  return { ...raw } as unknown as MutableBookFields;
};

export const validateBook = (raw: unknown): Book => {
  if (!isRecord(raw)) throw validationError(["book must be a JSON object"], "Catalog validation failed");
  const unknown = Object.keys(raw).filter((key) => !bookFieldSet.has(key));
  const missing = BOOK_FIELDS.filter((field) => field !== "subtitle" && !(field in raw));
  const details = [
    ...unknown.map((field) => `unknown book field: ${field}`),
    ...missing.map((field) => `missing book field: ${field}`),
    ...validateFields(raw, true)
  ];
  if (details.length > 0) throw validationError(details, "Catalog validation failed");
  return { ...raw } as unknown as Book;
};

export const validateCatalog = (raw: unknown): Book[] => {
  if (!Array.isArray(raw)) throw validationError(["catalog must be a JSON array"], "Catalog validation failed");
  const books = raw.map(validateBook);
  const ids = new Set<string>();
  const isbns = new Set<string>();
  for (const book of books) {
    if (ids.has(book.id)) throw validationError([`duplicate id: ${book.id}`], "Catalog validation failed");
    if (isbns.has(book.isbn)) throw validationError([`duplicate ISBN: ${book.isbn}`], "Catalog validation failed");
    ids.add(book.id);
    isbns.add(book.isbn);
  }
  return books;
};
