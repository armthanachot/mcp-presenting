import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { BookApiClient } from "./book-api-client";
import { getBookApiBaseUrl } from "./config";
import { createBookMcpServer } from "./server";

async function main() {
  const client = new BookApiClient(getBookApiBaseUrl());
  const server = createBookMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("book-mcp-sv is connected over stdio");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup failure";
  console.error(`book-mcp-sv failed to start: ${message}`);
  process.exitCode = 1;
});
