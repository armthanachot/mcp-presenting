import { BookApiClient } from "./book-api-client";
import { getBookApiBaseUrl, getDemoOAuthConfig, getHttpConfig } from "./config";
import { DemoOAuthServer } from "./demo-oauth";
import { createMcpHttpHandler } from "./http-app";

try {
  const client = new BookApiClient(getBookApiBaseUrl());
  const config = getHttpConfig();
  const oauthConfig = getDemoOAuthConfig();
  const oauth = oauthConfig ? new DemoOAuthServer(oauthConfig) : undefined;
  const server = Bun.serve({
    hostname: config.hostname,
    port: config.port,
    fetch: createMcpHttpHandler(client, {
      allowedHosts: config.allowedHosts,
      allowedOrigins: config.allowedOrigins,
      ...(oauth ? { oauth } : {}),
    }),
  });
  console.log(`book-mcp-sv Streamable HTTP listening on ${server.url.href}mcp`);
  if (oauth) console.log(`book-mcp-sv OAuth discovery issuer: ${oauth.issuer}`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown startup failure";
  console.error(`book-mcp-sv failed to start: ${message}`);
  process.exitCode = 1;
}
