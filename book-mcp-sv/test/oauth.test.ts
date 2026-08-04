import { expect, test } from "bun:test";

import { BookApiClient } from "../src/book-api-client";
import { getDemoOAuthConfig } from "../src/config";
import { DemoOAuthServer } from "../src/demo-oauth";
import { createMcpHttpHandler } from "../src/http-app";

const publicMcpUrl = "https://mcp.example.test/mcp";
const redirectUri = "https://claude.example.test/oauth/callback";
const loginCode = "fixed-demo-code";

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString("base64url");
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(new URL(path, "https://mcp.example.test"), {
    ...init,
    headers: { host: "mcp.example.test", ...init.headers },
  });
}

test("serves RFC 8615 OAuth discovery and completes DCR authorization-code PKCE flow", async () => {
  const oauth = new DemoOAuthServer({ publicMcpUrl, loginCode, accessTokenTtlSeconds: 3_600 });
  const handler = createMcpHttpHandler(new BookApiClient("http://127.0.0.1:1"), {
    allowedHosts: ["mcp.example.test"],
    allowedOrigins: ["https://mcp.example.test"],
    oauth,
  });

  const protectedMetadata = await handler(request("/.well-known/oauth-protected-resource/mcp"));
  expect(protectedMetadata.status).toBe(200);
  expect(await protectedMetadata.json()).toEqual({
    resource: publicMcpUrl,
    authorization_servers: ["https://mcp.example.test"],
    scopes_supported: ["books:access"],
    bearer_methods_supported: ["header"],
  });

  const fallbackMetadata = await handler(request("/.well-known/oauth-protected-resource"));
  expect(fallbackMetadata.status).toBe(200);

  const authorizationMetadata = await handler(request("/.well-known/oauth-authorization-server"));
  expect(authorizationMetadata.status).toBe(200);
  expect(await authorizationMetadata.json()).toMatchObject({
    issuer: "https://mcp.example.test",
    authorization_endpoint: "https://mcp.example.test/authorize",
    token_endpoint: "https://mcp.example.test/token",
    registration_endpoint: "https://mcp.example.test/register",
    code_challenge_methods_supported: ["S256"],
  });

  const unauthorized = await handler(request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }));
  expect(unauthorized.status).toBe(401);
  expect(unauthorized.headers.get("www-authenticate")).toContain("/.well-known/oauth-protected-resource/mcp");

  const registration = await handler(request("/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude test client",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  }));
  expect(registration.status).toBe(201);
  const registered = await registration.json() as { client_id: string };
  expect(registered.client_id).toStartWith("mcp_demo_");

  const verifier = "a".repeat(64);
  const challenge = await pkceChallenge(verifier);
  const authorizationParams = new URLSearchParams({
    response_type: "code",
    client_id: registered.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "claude-state",
    scope: "books:access",
    resource: publicMcpUrl,
  });
  const authorizationPage = await handler(request(`/authorize?${authorizationParams}`));
  expect(authorizationPage.status).toBe(200);
  expect(await authorizationPage.text()).toContain("Authorize Book MCP");

  const approvalForm = new URLSearchParams(authorizationParams);
  approvalForm.set("login_code", loginCode);
  const approval = await handler(request("/authorize", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://mcp.example.test",
    },
    body: approvalForm,
  }));
  expect(approval.status).toBe(302);
  const callback = new URL(approval.headers.get("location")!);
  expect(callback.origin + callback.pathname).toBe(redirectUri);
  expect(callback.searchParams.get("state")).toBe("claude-state");
  const code = callback.searchParams.get("code")!;

  const tokenForm = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: registered.client_id,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource: publicMcpUrl,
  });
  const tokenResponse = await handler(request("/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: tokenForm,
  }));
  expect(tokenResponse.status).toBe(200);
  const tokens = await tokenResponse.json() as { access_token: string; refresh_token: string };
  expect(tokens.access_token.length).toBeGreaterThan(30);

  const initialize = await handler(request("/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokens.access_token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "oauth-test", version: "1.0.0" },
      },
    }),
  }));
  expect(initialize.status).toBe(200);
  expect(await initialize.text()).toContain("book-mcp-sv");

  const replay = await handler(request("/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: tokenForm,
  }));
  expect(replay.status).toBe(400);
  expect(await replay.json()).toMatchObject({ error: "invalid_grant" });

  const refreshResponse = await handler(request("/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: registered.client_id,
      resource: publicMcpUrl,
    }),
  }));
  expect(refreshResponse.status).toBe(200);
});

test("demo OAuth configuration is opt-in and validates required settings", () => {
  expect(getDemoOAuthConfig({})).toBeUndefined();
  expect(() => getDemoOAuthConfig({ MCP_AUTH_ENABLED: "true" })).toThrow("MCP_PUBLIC_URL is required");
  expect(getDemoOAuthConfig({
    MCP_AUTH_ENABLED: "true",
    MCP_PUBLIC_URL: publicMcpUrl,
    MCP_DEMO_LOGIN_CODE: loginCode,
    MCP_ACCESS_TOKEN_TTL_SECONDS: "900",
  })).toEqual({ publicMcpUrl, loginCode, accessTokenTtlSeconds: 900 });
});
