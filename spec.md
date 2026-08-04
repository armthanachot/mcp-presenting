# Book API and MCP Server Specification

## Product objective

Demonstrate how a conventional REST API remains the system and data layer while an MCP server exposes the same capabilities to AI clients through named, validated tools.

## Project boundaries

### `book-api`

- Runtime: Bun
- Framework: Elysia
- Owns book validation, querying, business rules, and JSON-file persistence.
- Must not depend on MCP packages.
- Binds to `127.0.0.1` by default.

### `book-mcp-sv`

- Runtime: Bun
- SDK: exact v1 release of `@modelcontextprotocol/sdk`, as explicitly requested.
- Uses only `BOOK_API_BASE_URL` to access books.
- Must never import `book-api` source code or read its JSON files.
- Supports stdio for local clients and stateless Streamable HTTP for remote demonstrations.

Each project has its own `package.json`, lockfile, TypeScript configuration, tests, README, and environment example.

## Book data contract

The immutable preset contains exactly 10,000 deterministic synthetic books. Every record contains:

- `id`: unique `book-NNNNNN` identifier
- `isbn`: unique ISBN-like identifier
- `title`, optional `subtitle`
- `authors`: one or more author names
- `publisher`, `publishedYear`, `language`
- `categories`, `tags`, `format`, `pages`
- `price`, `currency` (`THB`)
- `rating`, `reviewCount`, `stock`, derived `availability`
- `coverImageUrl`
- `blurb`: at least six non-empty strings
- `createdAt`, `updatedAt`

`books.seed.json` is immutable preset data. `books.json` is the mutable runtime copy. Reset restores the runtime copy from the seed. A deterministic local generator creates both files and requires no faker dependency.

## REST API contract

### Core endpoints

- `GET /health`
- `GET /books`
- `GET /books/statistics`
- `GET /books/facets`
- `GET /books/:id/similar`
- `GET /books/:id`
- `POST /books`
- `PUT /books/:id`
- `PATCH /books/:id`
- `DELETE /books/:id`
- `POST /admin/reset-data`

Static routes must be registered before parameterized `/:id` routes.

### List query

`GET /books` requires all four parameters:

- `offset`: integer greater than or equal to 0
- `limit`: integer from 1 through 100
- `search`: may be an empty string; maximum 200 characters
- `nolimit`: `true` or `false`

When `nolimit=false`, pagination, search, optional filters, and sorting apply. When `nolimit=true`, the endpoint returns the complete unfiltered catalog, ignores offset/limit/search, and rejects filter or sort parameters. `nolimit` is a deliberate demo-only escape hatch and is never exposed through MCP.

Optional filters:

- `category`, `author`, `publisher`, `language`, `format`, `tags`
- `minPrice`, `maxPrice`, `minRating`
- `availableOnly`
- `publishedFrom`, `publishedTo`

Supported sort fields are `title`, `publishedYear`, `price`, `rating`, `reviewCount`, `stock`, and `createdAt`. `sortOrder` is `asc` or `desc`. Sorting is deterministic with `id` as a tie-breaker.

Search is case-insensitive substring matching across title, subtitle, authors, ISBN, publisher, categories, tags, and blurb. It must support Unicode and must not build a regular expression from user input.

List response:

```json
{
  "items": [],
  "meta": {
    "total": 0,
    "offset": 0,
    "limit": 20,
    "returned": 0,
    "hasMore": false,
    "nolimit": false
  }
}
```

### Mutations

- Create returns `201`, generates `id` and timestamps, and rejects duplicate ISBN with `409`.
- PUT replaces mutable fields; PATCH updates only supplied fields. Both revalidate the complete result, preserve `id` and `createdAt`, and update `updatedAt`.
- Unknown or empty mutation fields are rejected with `400`.
- Delete returns `204`; an unknown ID returns `404`.
- All mutations persist across repository reload/restart.

### Derived endpoints

- Statistics returns totals, stock totals, min/max/average price, category counts, and language counts without `NaN` or `Infinity`.
- Similar books exclude the source, use deterministic category/tag/author overlap scoring, and return score plus match reasons.
- Facets return sorted categories, authors, publishers, languages, and formats.

### Error response

Errors use a stable shape and never expose stack traces or file paths:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable message",
    "details": []
  }
}
```

## File persistence contract

- Load and validate the catalog once at startup.
- Serialize mutations through a single in-process queue.
- Persist using a same-directory temporary file followed by atomic rename.
- Update the in-memory snapshot only after persistence succeeds.
- Tests use temporary files and never mutate checked-in preset data.
- The demo supports one API process only; cross-process locking and horizontal scaling are non-goals.

## MCP contract

Named tools:

- `search_books`
- `get_book_details`
- `recommend_books`
- `compare_books`
- `find_similar_books`
- `get_catalog_statistics`
- `create_book`
- `update_book`
- `delete_book`

MCP requirements:

- All tools use independent Zod schemas and bounded inputs.
- Read tools are annotated read-only; delete is annotated destructive.
- Search never requests `nolimit` and caps returned records.
- Compare caps the number of IDs and preserves requested order.
- Recommendation is deterministic ranking over REST results and does not invoke another LLM.
- Reset data is not exposed as a tool.
- Tool failures return sanitized `isError: true` results.
- Downstream requests use `URL`, `URLSearchParams`, a timeout, response status checks, and JSON content-type checks.
- The API base URL is validated once at startup and cannot come from tool input.
- Stdio writes protocol messages only to stdout; diagnostics go to stderr.

## Non-goals

- Database, user accounts, carts, orders, or payments
- Embeddings, vector search, fuzzy-search libraries, or model SDKs
- Authentication, OBO, DCR, RBAC, or tenant isolation in this phase
- Multi-process JSON writers, high availability, or horizontal scaling
- Production public deployment without an authenticated TLS reverse proxy

## Acceptance criteria

- Exactly 10,000 valid seed and runtime books; unique IDs and ISBNs; every blurb has at least six non-empty entries.
- CRUD, required list parameters, search, filters, sorting, statistics, similar books, facets, persistence, atomic concurrent mutations, and reset are covered by Bun tests.
- MCP tests prove tool discovery and calls through the REST boundary, including a sanitized API-down failure.
- Both projects pass `bun test` and `bun run typecheck`.

