function parseInteger(value: string | undefined, fallback: number, name: string, min: number, max: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function parseList(value: string | undefined, fallback: string[], name: string): string[] {
  const items = (value === undefined ? fallback : value.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length === 0) throw new Error(`${name} must contain at least one value`);
  return [...new Set(items)];
}

function parseBoolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value === "") return fallback;
  if (value !== "true" && value !== "false") throw new Error(`${name} must be true or false`);
  return value === "true";
}

export function getHttpConfig(env: Record<string, string | undefined> = process.env) {
  const hostname = env.MCP_HTTP_HOST?.trim() || "127.0.0.1";
  if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "0.0.0.0") {
    throw new Error("MCP_HTTP_HOST must be 127.0.0.1, localhost, or 0.0.0.0");
  }
  const port = parseInteger(env.MCP_HTTP_PORT, 3100, "MCP_HTTP_PORT", 1, 65_535);
  const allowedHosts = parseList(env.MCP_ALLOWED_HOSTS, ["127.0.0.1", "localhost"], "MCP_ALLOWED_HOSTS");
  const allowedOrigins = parseList(
    env.MCP_ALLOWED_ORIGINS,
    [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
    "MCP_ALLOWED_ORIGINS",
  ).map((origin) => {
    const parsed = new URL(origin);
    if (parsed.origin !== origin) throw new Error("MCP_ALLOWED_ORIGINS must contain exact origins without paths");
    return parsed.origin;
  });
  return { hostname, port, allowedHosts, allowedOrigins };
}

export function getBookApiBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const value = env.BOOK_API_BASE_URL?.trim();
  if (!value) throw new Error("BOOK_API_BASE_URL is required");
  return value;
}

export function getDemoOAuthConfig(env: Record<string, string | undefined> = process.env) {
  if (!parseBoolean(env.MCP_AUTH_ENABLED, false, "MCP_AUTH_ENABLED")) return undefined;
  const publicMcpUrl = env.MCP_PUBLIC_URL?.trim();
  if (!publicMcpUrl) throw new Error("MCP_PUBLIC_URL is required when MCP_AUTH_ENABLED=true");
  const loginCode = env.MCP_DEMO_LOGIN_CODE ?? "";
  if (!loginCode) throw new Error("MCP_DEMO_LOGIN_CODE is required when MCP_AUTH_ENABLED=true");
  const accessTokenTtlSeconds = parseInteger(
    env.MCP_ACCESS_TOKEN_TTL_SECONDS,
    3_600,
    "MCP_ACCESS_TOKEN_TTL_SECONDS",
    300,
    86_400,
  );
  return { publicMcpUrl, loginCode, accessTokenTtlSeconds };
}
