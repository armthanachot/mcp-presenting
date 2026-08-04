# Book REST API + MCP Demo

This workspace contains two independent Bun projects that demonstrate how a conventional REST API and an MCP server can be used together.

```text
Claude / ChatGPT / MCP Client
              │
       MCP (stdio or HTTP)
              │
       book-mcp-sv
              │
           REST API
              │
          book-api
              │
        JSON book files
```

## Projects

- [`book-api`](./book-api): Bun + Elysia CRUD API backed by deterministic JSON files containing 10,000 books.
- [`book-mcp-sv`](./book-mcp-sv): MCP adapter using `@modelcontextprotocol/sdk@1.30.0`; all tools call `book-api` through HTTP.

## Run locally

Terminal 1:

```bash
cd book-api
bun install --frozen-lockfile
bun run start
```

Terminal 2, choose one MCP transport:

```bash
cd book-mcp-sv
bun install --frozen-lockfile
BOOK_API_BASE_URL=http://127.0.0.1:3000 bun run start
```

```bash
cd book-mcp-sv
BOOK_API_BASE_URL=http://127.0.0.1:3000 bun run start:http
```

Verify the HTTP transport from Terminal 3:

```bash
cd book-mcp-sv
MCP_URL=http://127.0.0.1:3100/mcp bun run smoke
```

See each project's README for the REST contract, MCP tools, and Claude/Codex/remote client configuration examples.

## Verification

```bash
cd book-api && bun test && bun run typecheck
cd book-mcp-sv && bun test && bun run typecheck
```

The demo intentionally excludes a database and authentication. Its JSON persistence is designed for one API process, and the HTTP MCP server must remain local unless placed behind an authenticated TLS reverse proxy.

