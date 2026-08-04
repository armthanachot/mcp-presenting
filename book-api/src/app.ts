import { Elysia } from "elysia";
import { ApiError, errorBody, validationError } from "./errors";
import { parseListQuery } from "./query";
import { BookRepository } from "./repository";

const similarLimit = (raw: unknown): number => {
  if (raw === undefined) return 5;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) throw validationError(["limit must be an integer"]);
  const value = Number(raw);
  if (value < 1 || value > 20) throw validationError(["limit must be from 1 through 20"]);
  return value;
};

export const createApp = (repository: BookRepository) => new Elysia({ name: "book-api" })
  .onError(({ code, error, set }) => {
    if (error instanceof ApiError) {
      set.status = error.status;
      return errorBody(error);
    }
    if (code === "PARSE" || code === "VALIDATION") {
      set.status = 400;
      return errorBody(validationError(["request body must be valid JSON"]));
    }
    set.status = 500;
    return errorBody(new ApiError(500, "INTERNAL_ERROR", "An unexpected error occurred"));
  })
  .get("/health", () => ({ status: "ok" }))
  .get("/books", ({ query }) => repository.list(parseListQuery(query as Record<string, unknown>)))
  .get("/books/statistics", () => repository.statistics())
  .get("/books/facets", () => repository.facets())
  .get("/books/:id/similar", ({ params, query }) => repository.similar(params.id, similarLimit(query.limit)))
  .get("/books/:id", ({ params }) => {
    const book = repository.findById(params.id);
    if (!book) throw new ApiError(404, "NOT_FOUND", `Book '${params.id}' was not found`);
    return book;
  })
  .post("/books", async ({ body, set }) => {
    const created = await repository.create(body);
    set.status = 201;
    return created;
  })
  .put("/books/:id", ({ params, body }) => repository.put(params.id, body))
  .patch("/books/:id", ({ params, body }) => repository.patch(params.id, body))
  .delete("/books/:id", async ({ params, set }) => {
    await repository.delete(params.id);
    set.status = 204;
    return null;
  })
  .post("/admin/reset-data", () => repository.reset());
