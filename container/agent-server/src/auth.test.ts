import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, type JWK } from "jose";
import { createVerifier } from "./auth.js";

const TEAM_DOMAIN = "test.cloudflareaccess.com";
const AUD = "test-aud-123";

type KeyMaterial = {
  privateKey: CryptoKey;
  publicJwk: JWK;
};

async function makeKey(kid: string): Promise<KeyMaterial> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const jwk = await exportJWK(publicKey);
  jwk.kid = kid;
  jwk.alg = "RS256";
  jwk.use = "sig";
  return { privateKey, publicJwk: jwk };
}

async function signToken(
  privateKey: CryptoKey,
  kid: string,
  opts: {
    aud?: string;
    iss?: string;
    expSec?: number;
    sub?: string;
  } = {}
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = opts.expSec ?? now + 600;
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(opts.iss ?? `https://${TEAM_DOMAIN}`)
    .setAudience(opts.aud ?? AUD)
    .setSubject(opts.sub ?? "user@example.com")
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(privateKey);
}

/**
 * テスト用に LocalJWKSet 風の getKey 関数を作る。
 * jose の createLocalJWKSet が public で使えるが、ここではシンプルに
 * kid 一致で公開鍵を返す KeyLike を返す関数を組む。
 */
async function makeJwksFn(keys: KeyMaterial[]) {
  const { importJWK } = await import("jose");
  return async (
    header: { kid?: string }
  ): Promise<CryptoKey> => {
    const k = keys.find((k) => k.publicJwk.kid === header.kid);
    if (!k) throw new Error(`unknown kid: ${header.kid}`);
    const imported = (await importJWK(k.publicJwk, "RS256")) as CryptoKey;
    return imported;
  };
}

describe("createVerifier", () => {
  let key1: KeyMaterial;
  let key2: KeyMaterial;
  let jwksFn: Awaited<ReturnType<typeof makeJwksFn>>;

  beforeAll(async () => {
    key1 = await makeKey("k1");
    key2 = await makeKey("k2");
    jwksFn = await makeJwksFn([key1]); // k1 のみ JWKS にある
  });

  it("正規 JWT は ok=true で payload を返す", async () => {
    const verify = createVerifier({
      teamDomain: TEAM_DOMAIN,
      aud: AUD,
      jwks: jwksFn,
    });
    const token = await signToken(key1.privateKey, "k1");
    const r = await verify(token);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.aud).toBe(AUD);
      expect(r.payload.iss).toBe(`https://${TEAM_DOMAIN}`);
    }
  });

  it("AUD 不一致は ok=false", async () => {
    const verify = createVerifier({
      teamDomain: TEAM_DOMAIN,
      aud: AUD,
      jwks: jwksFn,
    });
    const token = await signToken(key1.privateKey, "k1", {
      aud: "wrong-aud",
    });
    const r = await verify(token);
    expect(r.ok).toBe(false);
  });

  it("期限切れは ok=false", async () => {
    const verify = createVerifier({
      teamDomain: TEAM_DOMAIN,
      aud: AUD,
      jwks: jwksFn,
    });
    const past = Math.floor(Date.now() / 1000) - 60;
    const token = await signToken(key1.privateKey, "k1", { expSec: past });
    const r = await verify(token);
    expect(r.ok).toBe(false);
  });

  it("不正署名 (JWKS にない鍵で署名) は ok=false", async () => {
    const verify = createVerifier({
      teamDomain: TEAM_DOMAIN,
      aud: AUD,
      jwks: jwksFn,
    });
    // key2 で署名した kid=k1 トークン → 鍵不一致
    const token = await signToken(key2.privateKey, "k1");
    const r = await verify(token);
    expect(r.ok).toBe(false);
  });

  it("ランダム文字列は ok=false", async () => {
    const verify = createVerifier({
      teamDomain: TEAM_DOMAIN,
      aud: AUD,
      jwks: jwksFn,
    });
    const r = await verify("abc.def.ghi");
    expect(r.ok).toBe(false);
  });

  it("issuer 不一致は ok=false", async () => {
    const verify = createVerifier({
      teamDomain: TEAM_DOMAIN,
      aud: AUD,
      jwks: jwksFn,
    });
    const token = await signToken(key1.privateKey, "k1", {
      iss: "https://other.cloudflareaccess.com",
    });
    const r = await verify(token);
    expect(r.ok).toBe(false);
  });

  it("検証失敗時の error にトークン本体は含まれない", async () => {
    const verify = createVerifier({
      teamDomain: TEAM_DOMAIN,
      aud: AUD,
      jwks: jwksFn,
    });
    const token = "this-is-not-a-jwt-but-looks-like-secret-abc.def.ghi";
    const r = await verify(token);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).not.toContain(token);
      expect(r.error).not.toContain("def.ghi");
    }
  });
});
