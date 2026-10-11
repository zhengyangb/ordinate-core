import { app, safeStorage, shell } from "electron";
import { createHash, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify, type JsonWebKey } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const ISSUER = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
const JWKS = `${ISSUER}/.well-known/jwks.json`;
const CALLBACK_PATH = "/auth/callback";
const REQUIRED_SCOPE = "chatgpt.tokens.use.direct";

type Credential = {
  clientId: string; subject: string; email: string | null; idToken: string;
  accessToken: string; refreshToken: string; expiresAt: number; scopes: string[];
};
type AuthData = { hostId: string; activeClientId: string | null; accounts: Credential[] };
type TokenResponse = { access_token: string; refresh_token: string; id_token: string; token_type: string; expires_in: number; scope: string };

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new Error(`ChatGPT sign-in did not return ${name}.`);
  return value;
}

function parseTokenResponse(value: unknown): TokenResponse {
  if (!value || typeof value !== "object") throw new Error("ChatGPT returned an invalid token response.");
  const response = value as Record<string, unknown>;
  const expiresIn = response.expires_in;
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error("ChatGPT returned an invalid token lifetime.");
  if (response.token_type !== "Bearer") throw new Error("ChatGPT returned an unsupported token type.");
  return {
    access_token: requireString(response.access_token, "an access token"),
    refresh_token: requireString(response.refresh_token, "a refresh token"),
    id_token: requireString(response.id_token, "an identity token"),
    token_type: "Bearer", expires_in: expiresIn, scope: requireString(response.scope, "granted scopes"),
  };
}

async function exchangeToken(fields: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields), signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`ChatGPT authorization failed (${response.status}). Please sign in again.`);
  return parseTokenResponse(await response.json());
}

/** Verify before accepting any account identity or OAuth credential. */
export async function verifyIdentity(idToken: string, clientId: string, nonce?: string): Promise<{ subject: string; email: string | null }> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("ChatGPT returned an invalid identity token.");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Record<string, unknown>;
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Unsupported ChatGPT identity signature.");
  const response = await fetch(JWKS, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error("Could not verify the ChatGPT identity signature.");
  const keySet = await response.json() as { keys?: Array<Record<string, unknown>> };
  const jwk = keySet.keys?.find(key => key.kid === header.kid && key.kty === "RSA" && key.use === "sig");
  if (!jwk) throw new Error("ChatGPT identity signing key was not found.");
  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
  if (!verify("RSA-SHA256", signingInput, createPublicKey({ key: jwk as JsonWebKey, format: "jwk" }), Buffer.from(parts[2], "base64url"))) {
    throw new Error("ChatGPT identity signature did not verify.");
  }
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== ISSUER || !(claims.aud === clientId || Array.isArray(claims.aud) && claims.aud.includes(clientId)) ||
      typeof claims.exp !== "number" || claims.exp < now - 5 || typeof claims.iat !== "number" || claims.iat > now + 5 ||
      typeof claims.sub !== "string" || !claims.sub || (nonce !== undefined && claims.nonce !== nonce)) {
    throw new Error("ChatGPT identity claims did not verify.");
  }
  return { subject: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
}

function sameSecret(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function randomSecret() { return randomBytes(32).toString("base64url"); }

/** The desktop main process alone owns credentials; renderers never receive tokens. */
export class ChatGptAuth {
  private data: AuthData | null = null;
  private loading: Promise<AuthData> | null = null;
  private refreshTask: Promise<void> | null = null;
  private loginServer: Server | null = null;
  private signInError: string | null = null;
  private listeners = new Set<() => void>();

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { for (const listener of this.listeners) listener(); }
  get signingIn() { return this.loginServer !== null; }
  get error() { return this.signInError; }

  private get file() { return path.join(app.getPath("userData"), "chatgpt-auth.enc"); }
  private async load(): Promise<AuthData> {
    if (this.data) return this.data;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("macOS Keychain is unavailable; ChatGPT credentials cannot be stored safely.");
      try {
        const encrypted = await readFile(this.file);
        const data = JSON.parse(safeStorage.decryptString(encrypted)) as AuthData;
        if (!data.hostId?.startsWith("urn:uuid:") || !Array.isArray(data.accounts)) throw new Error("ChatGPT credential storage is invalid.");
        this.data = data;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        this.data = { hostId: `urn:uuid:${randomUUID()}`, activeClientId: null, accounts: [] };
        await this.save();
      }
      return this.data!;
    })();
    try { return await this.loading; } finally { this.loading = null; }
  }

  private async save() {
    if (!this.data) throw new Error("ChatGPT credential storage is not initialized.");
    const target = this.file;
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, safeStorage.encryptString(JSON.stringify(this.data)), { mode: 0o600, flag: "wx" });
      await rename(temporary, target);
    } finally { await rm(temporary, { force: true }); }
  }

  private active(data: AuthData) { return data.accounts.find(account => account.clientId === data.activeClientId) ?? null; }
  async account(): Promise<{ email: string | null } | null> {
    const data = await this.load();
    const account = this.active(data);
    return account ? { email: account.email } : null;
  }

  async accessToken(): Promise<string | null> {
    const data = await this.load();
    const account = this.active(data);
    if (!account) return null;
    if (account.expiresAt > Date.now() + 120_000) return account.accessToken;
    if (!this.refreshTask) this.refreshTask = this.refresh(account).finally(() => { this.refreshTask = null; });
    await this.refreshTask;
    return this.active(data)?.accessToken ?? null;
  }

  private async refresh(account: Credential) {
    const tokens = await exchangeToken({
      grant_type: "refresh_token", client_id: account.clientId,
      refresh_token: account.refreshToken, resource: RESOURCE,
    });
    const identity = await verifyIdentity(tokens.id_token, account.clientId);
    if (identity.subject !== account.subject) throw new Error("ChatGPT returned a different account during refresh.");
    const scopes = tokens.scope.split(" ").filter(Boolean);
    if (!scopes.includes(REQUIRED_SCOPE)) throw new Error("ChatGPT plan access is not enabled for this account.");
    Object.assign(account, {
      idToken: tokens.id_token, accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000, scopes, email: identity.email,
    });
    await this.save();
    this.changed();
  }

  async login(): Promise<void> {
    if (this.loginServer) throw new Error("ChatGPT sign-in is already in progress.");
    this.signInError = null;
    const data = await this.load();
    const current = this.active(data);
    const state = randomSecret(); const nonce = randomSecret(); const verifier = randomSecret();
    const server = createServer();
    this.loginServer = server;
    const finish = () => { server.close(); this.loginServer = null; this.changed(); };
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Could not start the ChatGPT sign-in callback.");
      const redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;
      const timer = setTimeout(finish, 5 * 60_000);
      server.on("close", () => clearTimeout(timer));
      server.on("request", (request, response) => {
        void (async () => {
          const callback = new URL(request.url ?? "/", redirectUri);
          if (request.method !== "GET" || callback.pathname !== CALLBACK_PATH) { response.writeHead(404).end(); return; }
          if (!sameSecret(callback.searchParams.get("state") ?? "", state)) throw new Error("ChatGPT sign-in state did not match.");
          if (callback.searchParams.has("error")) throw new Error("ChatGPT sign-in was not completed.");
          const code = requireString(callback.searchParams.get("code"), "an authorization code");
          const callbackClientId = callback.searchParams.get("client_id");
          const clientId = current ? current.clientId : requireString(callbackClientId, "a registered client ID");
          if (current && callbackClientId && callbackClientId !== current.clientId) throw new Error("ChatGPT returned a different client registration.");
          const tokens = await exchangeToken({
            grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier,
            redirect_uri: redirectUri, resource: RESOURCE,
          });
          const identity = await verifyIdentity(tokens.id_token, clientId, nonce);
          if (current && identity.subject !== current.subject) throw new Error("ChatGPT returned a different account.");
          const scopes = tokens.scope.split(" ").filter(Boolean);
          if (!scopes.includes(REQUIRED_SCOPE)) throw new Error("ChatGPT plan access was not granted.");
          const credential: Credential = {
            clientId, subject: identity.subject, email: identity.email, idToken: tokens.id_token,
            accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
            expiresAt: Date.now() + tokens.expires_in * 1000, scopes,
          };
          const index = data.accounts.findIndex(account => account.clientId === clientId);
          if (index >= 0) data.accounts[index] = credential; else data.accounts.push(credential);
          data.activeClientId = clientId;
          await this.save();
          this.signInError = null;
          response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
            .end("<!doctype html><title>Ordinate connected</title><p>ChatGPT is connected. You can return to Ordinate.</p>");
        })().catch(error => {
          this.signInError = String(error);
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" })
            .end(`Sign-in failed: ${String(error)}`);
        }).finally(finish);
      });
      const url = new URL(AUTHORIZE);
      const params = url.searchParams;
      params.set("client_id", current?.clientId ?? "dynamic_agent_client");
      if (!current) params.set("agent_name_hint", "ordinate");
      params.set("ext_agent_host_id", data.hostId);
      if (current) { params.set("id_token_hint", current.idToken); if (current.email) params.set("login_hint", current.email); }
      params.set("response_type", "code"); params.set("redirect_uri", redirectUri);
      params.set("scope", "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct");
      params.set("resource", RESOURCE); params.set("state", state); params.set("nonce", nonce);
      params.set("code_challenge_method", "S256");
      params.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
      this.changed();
      await shell.openExternal(url.toString());
    } catch (error) { this.signInError = String(error); finish(); throw error; }
  }
}

export const chatGptAuth = new ChatGptAuth();
