import { validationError } from "./errors";
import { SORT_FIELDS, type Book, type ListQuery, type ListResult, type SortField } from "./types";

const optionalParameters = [
  "category", "author", "publisher", "language", "format", "tags", "minPrice", "maxPrice",
  "minRating", "availableOnly", "publishedFrom", "publishedTo", "sortBy", "sortOrder"
] as const;
const allowedParameters = new Set(["offset", "limit", "search", "nolimit", ...optionalParameters]);

const single = (query: Record<string, unknown>, name: string): string | undefined => {
  const value = query[name];
  return typeof value === "string" ? value : undefined;
};

const integer = (raw: string | undefined, name: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (raw === undefined || !/^\d+$/.test(raw)) throw validationError([`${name} must be an integer`]);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw validationError([`${name} must be from ${minimum} through ${maximum}`]);
  }
  return value;
};

const numberValue = (raw: string | undefined, name: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number | undefined => {
  if (raw === undefined) return undefined;
  if (raw.trim() === "" || !Number.isFinite(Number(raw))) throw validationError([`${name} must be a finite number`]);
  const value = Number(raw);
  if (value < minimum || value > maximum) throw validationError([`${name} must be from ${minimum} through ${maximum}`]);
  return value;
};

const booleanValue = (raw: string | undefined, name: string): boolean | undefined => {
  if (raw === undefined) return undefined;
  if (raw !== "true" && raw !== "false") throw validationError([`${name} must be true or false`]);
  return raw === "true";
};

export const parseListQuery = (query: Record<string, unknown>): ListQuery => {
  const details: string[] = [];
  for (const key of Object.keys(query)) {
    if (!allowedParameters.has(key)) details.push(`unknown query parameter: ${key}`);
    if (typeof query[key] !== "string") details.push(`${key} must be supplied once`);
  }
  if (details.length > 0) throw validationError(details);

  const nolimit = booleanValue(single(query, "nolimit"), "nolimit") ?? false;
  const search = single(query, "search");
  if (search !== undefined && search.length > 200) {
    throw validationError(["search must be at most 200 characters"]);
  }
  if (nolimit) {
    const supplied = optionalParameters.filter((parameter) => parameter in query);
    if (supplied.length > 0) throw validationError(supplied.map((parameter) => `${parameter} is not allowed when nolimit=true`));
    const result: ListQuery = { offset: 0, limit: 0, nolimit: true };
    if (search !== undefined) result.search = search;
    return result;
  }

  for (const required of ["offset", "limit"]) {
    if (!(required in query)) details.push(`${required} is required`);
  }
  if (details.length > 0) throw validationError(details);

  const offset = integer(single(query, "offset"), "offset", 0);
  const limit = integer(single(query, "limit"), "limit", 1, 100);

  const sortByRaw = single(query, "sortBy");
  if (sortByRaw !== undefined && !SORT_FIELDS.includes(sortByRaw as (typeof SORT_FIELDS)[number])) {
    throw validationError([`sortBy must be one of: ${SORT_FIELDS.join(", ")}`]);
  }
  const sortOrderRaw = single(query, "sortOrder");
  if (sortOrderRaw !== undefined && sortOrderRaw !== "asc" && sortOrderRaw !== "desc") {
    throw validationError(["sortOrder must be asc or desc"]);
  }
  if (sortOrderRaw !== undefined && sortByRaw === undefined) throw validationError(["sortBy is required when sortOrder is supplied"]);

  const tagsRaw = single(query, "tags");
  const result: ListQuery = { offset, limit, nolimit: false };
  if (search !== undefined) result.search = search;
  for (const field of ["category", "author", "publisher", "language", "format"] as const) {
    const value = single(query, field);
    if (value !== undefined) {
      if (value.trim() === "") throw validationError([`${field} must not be empty`]);
      result[field] = value;
    }
  }
  if (tagsRaw !== undefined) {
    const tags = tagsRaw.split(",").map((tag) => tag.trim()).filter(Boolean);
    if (tags.length === 0) throw validationError(["tags must contain at least one value"]);
    result.tags = tags;
  }
  const minPrice = numberValue(single(query, "minPrice"), "minPrice", 0);
  const maxPrice = numberValue(single(query, "maxPrice"), "maxPrice", 0);
  const minRating = numberValue(single(query, "minRating"), "minRating", 0, 5);
  const publishedFromRaw = single(query, "publishedFrom");
  const publishedToRaw = single(query, "publishedTo");
  if (minPrice !== undefined) result.minPrice = minPrice;
  if (maxPrice !== undefined) result.maxPrice = maxPrice;
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) throw validationError(["minPrice must not exceed maxPrice"]);
  if (minRating !== undefined) result.minRating = minRating;
  if (publishedFromRaw !== undefined) result.publishedFrom = integer(publishedFromRaw, "publishedFrom", 1000, 2100);
  if (publishedToRaw !== undefined) result.publishedTo = integer(publishedToRaw, "publishedTo", 1000, 2100);
  if (result.publishedFrom !== undefined && result.publishedTo !== undefined && result.publishedFrom > result.publishedTo) {
    throw validationError(["publishedFrom must not exceed publishedTo"]);
  }
  const availableOnly = booleanValue(single(query, "availableOnly"), "availableOnly");
  if (availableOnly !== undefined) result.availableOnly = availableOnly;
  if (sortByRaw !== undefined) result.sortBy = sortByRaw as SortField;
  if (sortOrderRaw !== undefined) result.sortOrder = sortOrderRaw;
  return result;
};

const normalize = (value: string) => value.toLocaleLowerCase();
const includes = (value: string, expected: string) => normalize(value).includes(normalize(expected));

export const queryBooks = (catalog: readonly Book[], query: ListQuery): ListResult => {
  if (query.nolimit) {
    const items = catalog.map((book) => structuredClone(book));
    return { items, meta: { total: items.length, offset: 0, limit: items.length, returned: items.length, hasMore: false, nolimit: true } };
  }

  const needle = query.search ? normalize(query.search) : undefined;
  let items = catalog.filter((book) => {
    if (needle) {
      const searchable = [
        book.title, book.subtitle ?? "", ...book.authors, book.isbn, book.publisher,
        ...book.categories, ...book.tags, ...book.blurb
      ];
      if (!searchable.some((value) => normalize(value).includes(needle))) return false;
    }
    if (query.category && !book.categories.some((value) => includes(value, query.category!))) return false;
    if (query.author && !book.authors.some((value) => includes(value, query.author!))) return false;
    if (query.publisher && !includes(book.publisher, query.publisher)) return false;
    if (query.language && normalize(book.language) !== normalize(query.language)) return false;
    if (query.format && normalize(book.format) !== normalize(query.format)) return false;
    if (query.tags && !query.tags.every((tag) => book.tags.some((value) => normalize(value) === normalize(tag)))) return false;
    if (query.minPrice !== undefined && book.price < query.minPrice) return false;
    if (query.maxPrice !== undefined && book.price > query.maxPrice) return false;
    if (query.minRating !== undefined && book.rating < query.minRating) return false;
    if (query.availableOnly === true && book.stock === 0) return false;
    if (query.publishedFrom !== undefined && book.publishedYear < query.publishedFrom) return false;
    if (query.publishedTo !== undefined && book.publishedYear > query.publishedTo) return false;
    return true;
  });

  const direction = query.sortOrder === "desc" ? -1 : 1;
  items = [...items].sort((left, right) => {
    if (query.sortBy) {
      const a = left[query.sortBy];
      const b = right[query.sortBy];
      const compared = typeof a === "string" && typeof b === "string"
        ? a.localeCompare(b)
        : (a as number) - (b as number);
      if (compared !== 0) return compared * direction;
    }
    return left.id.localeCompare(right.id);
  });
  const total = items.length;
  const page = items.slice(query.offset, query.offset + query.limit).map((book) => structuredClone(book));
  return {
    items: page,
    meta: {
      total, offset: query.offset, limit: query.limit, returned: page.length,
      hasMore: query.offset + page.length < total, nolimit: false
    }
  };
};
