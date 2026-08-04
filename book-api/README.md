# Book API

A standalone Bun + Elysia REST API backed by a mutable JSON file. It is the system and data layer used by the separate MCP server project.

## Requirements

- Bun 1.3 or newer

## Setup and run

```bash
bun install --frozen-lockfile
bun run generate
bun run dev
```

The server binds to `127.0.0.1:3000` by default. Copy `.env.example` to `.env` to override runtime settings. `books.seed.json` is the immutable preset; normal mutations only write `books.json`. `POST /admin/reset-data` restores the runtime file from the seed.

## List books

`offset` and `limit` are required for paginated requests. Every other query parameter is optional:

```bash
curl 'http://127.0.0.1:3000/books?offset=0&limit=20&search=ai&nolimit=false'
```

- `offset`: integer at least 0
- `limit`: integer from 1 through 100
- `search`: optional case-insensitive substring, up to 200 characters; may be empty
- `nolimit`: optional `true` or `false`; defaults to `false`

`nolimit=true` returns the entire unfiltered catalog, ignores `offset` and `limit` (which may be omitted), and rejects filters and sorting. It exists only for the REST demonstration and should not be exposed to MCP clients.

```bash
curl 'http://127.0.0.1:3000/books?nolimit=true'
```

Optional filters are `category`, `author`, `publisher`, `language`, `format`, comma-separated `tags`, `minPrice`, `maxPrice`, `minRating`, `availableOnly`, `publishedFrom`, and `publishedTo`. Sorting accepts `sortBy=title|publishedYear|price|rating|reviewCount|stock|createdAt` and `sortOrder=asc|desc`.

## Endpoints

- `GET /health`
- `GET /books`
- `GET /books/statistics`
- `GET /books/facets`
- `GET /books/:id/similar?limit=5`
- `GET /books/:id`
- `POST /books`
- `PUT /books/:id`
- `PATCH /books/:id`
- `DELETE /books/:id`
- `POST /admin/reset-data`

Create and PUT accept all mutable book fields. PATCH accepts a non-empty subset. IDs, availability, and timestamps are server-owned. Error responses use `{ "error": { "code", "message", "details" } }` and never include stack traces or local paths.

## Verification

```bash
bun test
bun run typecheck
```

Tests create isolated temporary catalogs for mutations and never modify the checked-in 10,000-book files.
