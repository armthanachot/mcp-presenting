const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_SCOPE = "books:access";
const MAX_REGISTERED_CLIENTS = 1_000;

interface RegisteredClient {
  clientId: string;
  redirectUris: string[];
  clientName?: string;
}

interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scope: string;
  resource: string;
}

interface AuthorizationCodeRecord extends AuthorizationRequest {
  expiresAt: number;
}

interface TokenRecord {
  clientId: string;
  resource: string;
  scope: string;
  expiresAt: number;
}

interface RefreshTokenRecord {
  clientId: string;
  resource: string;
  scope: string;
  expiresAt: number;
}

export interface DemoOAuthOptions {
  publicMcpUrl: string;
  loginCode: string;
  accessTokenTtlSeconds?: number;
  now?: () => number;
}

const jsonHeaders = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
} as const;

function oauthError(error: string, description: string, status = 400): Response {
  return Response.json({ error, error_description: description }, { status, headers: jsonHeaders });
}

function randomToken(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return Buffer.from(value).toString("base64url");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("base64url");
}

async function secretsMatch(actual: string, expected: string): Promise<boolean> {
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(actual)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected)),
  ]);
  const left = new Uint8Array(actualDigest);
  const right = new Uint8Array(expectedDigest);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return undefined;
  if (!value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 2_000)) return undefined;
  return [...new Set(value)];
}

function isSafeRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.hash || url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formValue(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}

export class DemoOAuthServer {
  readonly publicMcpUrl: string;
  readonly issuer: string;
  readonly protectedResourceMetadataUrl: string;
  readonly accessTokenTtlSeconds: number;

  private readonly loginCode: string;
  private readonly now: () => number;
  private readonly clients = new Map<string, RegisteredClient>();
  private readonly authorizationCodes = new Map<string, AuthorizationCodeRecord>();
  private readonly accessTokens = new Map<string, TokenRecord>();
  private readonly refreshTokens = new Map<string, RefreshTokenRecord>();

  constructor(options: DemoOAuthOptions) {
    const publicMcpUrl = new URL(options.publicMcpUrl);
    if (publicMcpUrl.protocol !== "https:" || publicMcpUrl.pathname !== "/mcp" || publicMcpUrl.search || publicMcpUrl.hash) {
      throw new Error("MCP_PUBLIC_URL must be an HTTPS URL whose path is exactly /mcp");
    }
    if (options.loginCode.length < 8 || options.loginCode.length > 200) {
      throw new Error("MCP_DEMO_LOGIN_CODE must contain between 8 and 200 characters");
    }
    this.publicMcpUrl = publicMcpUrl.href;
    this.issuer = publicMcpUrl.origin;
    this.protectedResourceMetadataUrl = `${this.issuer}/.well-known/oauth-protected-resource/mcp`;
    this.loginCode = options.loginCode;
    this.accessTokenTtlSeconds = options.accessTokenTtlSeconds ?? 3_600;
    this.now = options.now ?? Date.now;
  }

  async handleRoute(request: Request): Promise<Response | undefined> {
    this.pruneExpiredRecords();
    const url = new URL(request.url);

    if (request.method === "GET" && (
      url.pathname === "/.well-known/oauth-protected-resource/mcp"
      || url.pathname === "/.well-known/oauth-protected-resource"
    )) {
      return Response.json({
        resource: this.publicMcpUrl,
        authorization_servers: [this.issuer],
        scopes_supported: [DEFAULT_SCOPE],
        bearer_methods_supported: ["header"],
      }, { headers: jsonHeaders });
    }

    if (request.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
      return Response.json({
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        registration_endpoint: `${this.issuer}/register`,
        scopes_supported: [DEFAULT_SCOPE],
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
        protected_resources: [this.publicMcpUrl],
      }, { headers: jsonHeaders });
    }

    if (url.pathname === "/register" && request.method === "POST") return this.register(request);
    if (url.pathname === "/authorize" && request.method === "GET") return this.authorizePage(url.searchParams);
    if (url.pathname === "/authorize" && request.method === "POST") return this.authorize(request);
    if (url.pathname === "/token" && request.method === "POST") return this.token(request);

    return undefined;
  }

  authorizeMcpRequest(request: Request): Response | undefined {
    const header = request.headers.get("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;
    const record = token ? this.accessTokens.get(token) : undefined;
    if (record && record.expiresAt > this.now() && record.resource === this.publicMcpUrl) return undefined;
    if (token) this.accessTokens.delete(token);

    const challenge = [
      `Bearer resource_metadata="${this.protectedResourceMetadataUrl}"`,
      `scope="${DEFAULT_SCOPE}"`,
      ...(token ? ['error="invalid_token"'] : []),
    ].join(", ");
    return Response.json({ error: "unauthorized" }, {
      status: 401,
      headers: { "WWW-Authenticate": challenge, ...jsonHeaders },
    });
  }

  private async register(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return oauthError("invalid_client_metadata", "Registration body must be valid JSON");
    }
    if (!isObject(body)) return oauthError("invalid_client_metadata", "Registration body must be a JSON object");

    const redirectUris = stringArray(body.redirect_uris);
    if (!redirectUris || !redirectUris.every(isSafeRedirectUri)) {
      return oauthError("invalid_redirect_uri", "redirect_uris must contain HTTPS or localhost callback URLs");
    }
    const grantTypes = body.grant_types === undefined
      ? ["authorization_code", "refresh_token"]
      : stringArray(body.grant_types);
    if (!grantTypes || grantTypes.some((value) => value !== "authorization_code" && value !== "refresh_token")) {
      return oauthError("invalid_client_metadata", "Only authorization_code and refresh_token grant types are supported");
    }
    if (!grantTypes.includes("authorization_code")) {
      return oauthError("invalid_client_metadata", "The authorization_code grant type is required");
    }
    const responseTypes = body.response_types === undefined ? ["code"] : stringArray(body.response_types);
    if (!responseTypes || responseTypes.some((value) => value !== "code")) {
      return oauthError("invalid_client_metadata", "Only the code response type is supported");
    }
    if (!responseTypes.includes("code")) {
      return oauthError("invalid_client_metadata", "The code response type is required");
    }
    if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== "none") {
      return oauthError("invalid_client_metadata", "Only public clients using token_endpoint_auth_method=none are supported");
    }
    const clientName = typeof body.client_name === "string" && body.client_name.trim().length <= 200
      ? body.client_name.trim()
      : undefined;
    if (this.clients.size >= MAX_REGISTERED_CLIENTS) {
      return oauthError("temporarily_unavailable", "The demo client registry is full", 429);
    }
    const clientId = `mcp_demo_${randomToken(24)}`;
    this.clients.set(clientId, {
      clientId,
      redirectUris,
      ...(clientName ? { clientName } : {}),
    });

    return Response.json({
      client_id: clientId,
      client_id_issued_at: Math.floor(this.now() / 1_000),
      redirect_uris: redirectUris,
      grant_types: grantTypes,
      response_types: responseTypes,
      token_endpoint_auth_method: "none",
      ...(clientName ? { client_name: clientName } : {}),
    }, { status: 201, headers: jsonHeaders });
  }

  private authorizePage(params: URLSearchParams): Response {
    const parsed = this.parseAuthorizationRequest(params);
    if (parsed instanceof Response) return parsed;
    return this.renderAuthorizationPage(parsed);
  }

  private async authorize(request: Request): Promise<Response> {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return oauthError("invalid_request", "Authorization form is invalid");
    }
    const params = new URLSearchParams();
    for (const name of ["client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource", "response_type"]) {
      const value = formValue(form, name);
      if (value !== undefined) params.set(name, value);
    }
    const parsed = this.parseAuthorizationRequest(params);
    if (parsed instanceof Response) return parsed;

    const loginCode = formValue(form, "login_code") ?? "";
    if (!(await secretsMatch(loginCode, this.loginCode))) {
      return this.renderAuthorizationPage(parsed, "The demo login code is incorrect.", 401);
    }

    const code = randomToken();
    this.authorizationCodes.set(code, {
      ...parsed,
      expiresAt: this.now() + AUTHORIZATION_CODE_TTL_MS,
    });
    const redirect = new URL(parsed.redirectUri);
    redirect.searchParams.set("code", code);
    if (parsed.state !== undefined) redirect.searchParams.set("state", parsed.state);
    return Response.redirect(redirect, 302);
  }

  private parseAuthorizationRequest(params: URLSearchParams): AuthorizationRequest | Response {
    const responseType = params.get("response_type");
    const clientId = params.get("client_id");
    const redirectUri = params.get("redirect_uri");
    const codeChallenge = params.get("code_challenge");
    const codeChallengeMethod = params.get("code_challenge_method");
    const resource = params.get("resource");
    const scope = params.get("scope") || DEFAULT_SCOPE;
    const state = params.get("state") ?? undefined;

    if (responseType !== "code" || !clientId || !redirectUri || !codeChallenge || codeChallengeMethod !== "S256" || !resource) {
      return oauthError("invalid_request", "response_type, client_id, redirect_uri, resource, and S256 PKCE are required");
    }
    const client = this.clients.get(clientId);
    if (!client) return oauthError("invalid_client", "The OAuth client is not registered", 401);
    if (!client.redirectUris.includes(redirectUri)) return oauthError("invalid_request", "redirect_uri does not match the registered client");
    if (resource !== this.publicMcpUrl) return oauthError("invalid_target", "resource must identify this MCP server");
    if (scope !== DEFAULT_SCOPE) return oauthError("invalid_scope", `Only ${DEFAULT_SCOPE} is supported`);
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) return oauthError("invalid_request", "code_challenge is invalid");

    return {
      clientId,
      redirectUri,
      codeChallenge,
      scope,
      resource,
      ...(state === undefined ? {} : { state }),
    };
  }

  private renderAuthorizationPage(params: AuthorizationRequest, error?: string, status = 200): Response {
    const hidden = new URLSearchParams({
      response_type: "code",
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      code_challenge_method: "S256",
      scope: params.scope,
      resource: params.resource,
      ...(params.state === undefined ? {} : { state: params.state }),
    });
    const hiddenInputs = [...hidden].map(([name, value]) => (
      `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`
    )).join("\n");
    const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Authorize Book MCP</title>
<style>body{font-family:system-ui;max-width:34rem;margin:4rem auto;padding:0 1rem;color:#172033}form{display:grid;gap:1rem}input,button{font:inherit;padding:.75rem}button{cursor:pointer}p.error{color:#b42318}</style></head>
<body><h1>Authorize Book MCP</h1><p>This demo uses one fixed login code. OAuth authorization codes and tokens remain short-lived and cannot be replayed.</p>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/authorize">${hiddenInputs}<label>Demo login code <input type="password" name="login_code" required autocomplete="one-time-code"></label><button type="submit">Authorize Claude</button></form>
</body></html>`;
    return new Response(html, {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  private async token(request: Request): Promise<Response> {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return oauthError("invalid_request", "Token request must be form encoded");
    }
    const grantType = formValue(form, "grant_type");
    if (grantType === "authorization_code") return this.exchangeAuthorizationCode(form);
    if (grantType === "refresh_token") return this.exchangeRefreshToken(form);
    return oauthError("unsupported_grant_type", "Only authorization_code and refresh_token are supported");
  }

  private async exchangeAuthorizationCode(form: FormData): Promise<Response> {
    const code = formValue(form, "code");
    const clientId = formValue(form, "client_id");
    const redirectUri = formValue(form, "redirect_uri");
    const verifier = formValue(form, "code_verifier");
    const resource = formValue(form, "resource");
    if (!code || !clientId || !redirectUri || !verifier || !resource) {
      return oauthError("invalid_request", "code, client_id, redirect_uri, code_verifier, and resource are required");
    }

    const record = this.authorizationCodes.get(code);
    this.authorizationCodes.delete(code);
    if (!record || record.expiresAt <= this.now()) return oauthError("invalid_grant", "Authorization code is invalid or expired");
    if (record.clientId !== clientId || record.redirectUri !== redirectUri || record.resource !== resource) {
      return oauthError("invalid_grant", "Authorization code is not valid for this client or resource");
    }
    if ((await sha256Base64Url(verifier)) !== record.codeChallenge) {
      return oauthError("invalid_grant", "PKCE verification failed");
    }
    return this.issueTokens(record.clientId, record.resource, record.scope);
  }

  private exchangeRefreshToken(form: FormData): Response {
    const refreshToken = formValue(form, "refresh_token");
    const clientId = formValue(form, "client_id");
    const resource = formValue(form, "resource");
    if (!refreshToken || !clientId || !resource) {
      return oauthError("invalid_request", "refresh_token, client_id, and resource are required");
    }
    const record = this.refreshTokens.get(refreshToken);
    this.refreshTokens.delete(refreshToken);
    if (!record || record.expiresAt <= this.now()) return oauthError("invalid_grant", "Refresh token is invalid or expired");
    if (record.clientId !== clientId || record.resource !== resource) {
      return oauthError("invalid_grant", "Refresh token is not valid for this client or resource");
    }
    return this.issueTokens(record.clientId, record.resource, record.scope);
  }

  private issueTokens(clientId: string, resource: string, scope: string): Response {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const accessExpiresAt = this.now() + this.accessTokenTtlSeconds * 1_000;
    this.accessTokens.set(accessToken, { clientId, resource, scope, expiresAt: accessExpiresAt });
    this.refreshTokens.set(refreshToken, {
      clientId,
      resource,
      scope,
      expiresAt: this.now() + 30 * 24 * 60 * 60 * 1_000,
    });
    return Response.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: this.accessTokenTtlSeconds,
      refresh_token: refreshToken,
      scope,
    }, { headers: jsonHeaders });
  }

  private pruneExpiredRecords(): void {
    const now = this.now();
    for (const [key, value] of this.authorizationCodes) if (value.expiresAt <= now) this.authorizationCodes.delete(key);
    for (const [key, value] of this.accessTokens) if (value.expiresAt <= now) this.accessTokens.delete(key);
    for (const [key, value] of this.refreshTokens) if (value.expiresAt <= now) this.refreshTokens.delete(key);
  }
}
