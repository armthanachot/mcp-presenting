# Book MCP Server

An MCP adapter for the separate `book-api` REST service. It never reads the API project's source or JSON data. All catalog operations cross the HTTP boundary through the fixed `BOOK_API_BASE_URL` configured at startup.

## Stack

- Bun
- `@modelcontextprotocol/sdk` exactly `1.30.0`
- Zod exactly `3.25.76`
- Stdio for local MCP clients
- Stateless Streamable HTTP for remote demonstrations

## Setup

```bash
bun install
cp .env.example .env
```

Start `book-api` on port 3000 first. Then run one transport:

```bash
# Local clients
bun --env-file=.env run start

# Remote/demo clients
bun --env-file=.env run start:http
```

The remote MCP endpoint is `http://127.0.0.1:3100/mcp`; its health endpoint is `http://127.0.0.1:3100/health`.
`MCP_ALLOWED_HOSTS` and `MCP_ALLOWED_ORIGINS` are explicit comma-separated allowlists used before MCP request parsing.

## Claude OAuth demo

The HTTP server includes an opt-in, self-contained OAuth demo for connecting a remote MCP server to Claude. It provides:

- RFC 8615 well-known discovery paths
- RFC 9728 protected resource metadata at `/.well-known/oauth-protected-resource/mcp` and the root fallback
- RFC 8414 authorization server metadata at `/.well-known/oauth-authorization-server`
- RFC 7591 dynamic client registration at `POST /register`
- Authorization Code flow with mandatory S256 PKCE at `/authorize` and `/token`
- Short-lived bearer access tokens and rotating refresh tokens

Configure the public HTTPS URL after starting a tunnel:

```env
MCP_AUTH_ENABLED=true
MCP_PUBLIC_URL=https://your-public-host.example/mcp
MCP_DEMO_LOGIN_CODE=replace-with-a-private-fixed-demo-code
MCP_ACCESS_TOKEN_TTL_SECONDS=3600
MCP_ALLOWED_HOSTS=127.0.0.1,localhost,your-public-host.example
MCP_ALLOWED_ORIGINS=http://127.0.0.1:3100,http://localhost:3100,https://your-public-host.example
```

Restart the MCP HTTP server, then add `https://your-public-host.example/mcp` as a custom connector in Claude. Claude discovers the OAuth endpoints, registers itself, opens `/authorize` in the browser, and asks the user to enter `MCP_DEMO_LOGIN_CODE`.

The login code is fixed for workshop convenience. The OAuth authorization code returned to Claude is intentionally random, single-use, expires after five minutes, and is bound to the registered client, redirect URI, resource, and PKCE challenge. A reusable fixed OAuth authorization code would enable replay attacks and is not MCP/OAuth compliant.

This implementation is for local workshops only. Clients, authorization codes, access tokens, and refresh tokens are stored in memory and are lost when `book-mcp-sv` restarts. Production deployments should use a real authorization server or identity provider, persistent client registration, user accounts and consent, audit logging, rate limiting, token revocation, and signed audience-bound access tokens.

With the HTTP transport running, verify the complete MCP connection and REST-backed tool calls:

```bash
MCP_URL=http://127.0.0.1:3100/mcp bun run smoke
```

## Tools

| Tool | Behavior |
|---|---|
| `search_books` | Bounded search, filters, and sorting; never requests `nolimit` |
| `get_book_details` | Fetch one complete book |
| `recommend_books` | Deterministically rank REST search results; no second LLM |
| `compare_books` | Fetch 2–10 books and preserve requested order |
| `find_similar_books` | Fetch deterministic REST similarity results |
| `get_catalog_statistics` | Fetch REST catalog aggregates |
| `create_book` | Create a validated book through REST |
| `update_book` | Patch one or more book fields through REST |
| `delete_book` | Permanently delete a book through REST |

All tool inputs are bounded by independent Zod schemas. API and transport errors are converted to sanitized MCP `isError: true` results.

## Claude Desktop (stdio)

Use an absolute path in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "books": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/book-mcp-sv/src/stdio.ts"],
      "env": {
        "BOOK_API_BASE_URL": "http://127.0.0.1:3000"
      }
    }
  }
}
```

## Codex (stdio)

Add this to `~/.codex/config.toml`, replacing the path:

```toml
[mcp_servers.books]
command = "bun"
args = ["run", "/absolute/path/to/book-mcp-sv/src/stdio.ts"]

[mcp_servers.books.env]
BOOK_API_BASE_URL = "http://127.0.0.1:3000"
```

## Claude and ChatGPT (remote demo)

Run the Streamable HTTP entrypoint and configure the MCP URL as:

```text
https://your-demo-host.example/mcp
```

Claude custom connectors and ChatGPT developer-mode connectors can use a remote Streamable HTTP MCP URL. The included server intentionally has no authentication and binds to `127.0.0.1` by default. Do not expose it publicly as-is. Any public demonstration must place it behind an authenticated TLS reverse proxy and configure `BOOK_API_BASE_URL` only on the server.

## Verification

```bash
bun test
bun run typecheck
```
