import { BookApiClient } from "./book-api-client";
import { getHttpConfig } from "./config";
import { createMcpHttpHandler } from "./http-app";

try {
  const client = new BookApiClient(process.env.BOOK_API_BASE_URL!);
  const config = getHttpConfig();
  const server = Bun.serve({
    hostname: config.hostname,
    port: config.port,
    fetch: createMcpHttpHandler(client,
      {
        allowedHosts: config.allowedHosts,
        allowedOrigins: config.allowedOrigins,
      }
    ),
  });
  console.log(`book-mcp-sv Streamable HTTP listening on ${server.url.href}mcp`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown startup failure";
  console.error(`book-mcp-sv failed to start: ${message}`);
  process.exitCode = 1;
}
