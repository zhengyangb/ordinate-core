import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";

vi.mock("electron", () => ({ app: {}, safeStorage: {}, shell: {} }));
import { verifyIdentity } from "./chatGptAuth";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });

function token(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: "https://auth.openai.com", aud: "oaiapp_test", sub: "subject-1",
    email: "person@example.com", iat: now, exp: now + 3600, nonce: "expected-nonce", ...overrides,
  })).toString("base64url");
  const input = `${header}.${claims}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
}

describe("ChatGPT identity verification", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function provideKey() {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ keys: [{ ...jwk, kid: "test-key", use: "sig" }] }) }));
  }

  it("accepts a correctly signed token for the issued client and nonce", async () => {
    provideKey();
    await expect(verifyIdentity(token(), "oaiapp_test", "expected-nonce"))
      .resolves.toEqual({ subject: "subject-1", email: "person@example.com" });
  });

  it("rejects the wrong client, nonce and expired identity", async () => {
    provideKey();
    await expect(verifyIdentity(token(), "oaiapp_other", "expected-nonce")).rejects.toThrow("claims");
    await expect(verifyIdentity(token(), "oaiapp_test", "other-nonce")).rejects.toThrow("claims");
    await expect(verifyIdentity(token({ exp: 1 }), "oaiapp_test", "expected-nonce")).rejects.toThrow("claims");
  });

  it("rejects a modified payload even when the claims look valid", async () => {
    provideKey();
    const original = token();
    const [header, , signature] = original.split(".");
    const altered = Buffer.from(JSON.stringify({ iss: "https://auth.openai.com", aud: "oaiapp_test", sub: "other", iat: 1, exp: 9999999999, nonce: "expected-nonce" })).toString("base64url");
    await expect(verifyIdentity(`${header}.${altered}.${signature}`, "oaiapp_test", "expected-nonce")).rejects.toThrow("signature");
  });
});
