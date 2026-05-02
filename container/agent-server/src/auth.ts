import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

export type VerifyResult =
  | { ok: true; payload: JWTPayload }
  | { ok: false; error: string };

export type Verifier = (token: string) => Promise<VerifyResult>;

export type CreateVerifierOpts = {
  teamDomain: string;
  aud: string;
  /**
   * テスト用に注入する JWKS / KeyLike 取得関数。
   * 本番では未指定で `createRemoteJWKSet(...)` をデフォルト生成する。
   */
  jwks?: JWTVerifyGetKey;
};

/**
 * Cloudflare Access の JWT を検証する関数を作る。
 *
 * - issuer: `https://<teamDomain>`
 * - audience: AUD タグ
 * - 検証失敗時は `String(err)` のメッセージのみ error に詰める。
 *   トークン本体・payload はログに出さない (CLAUDE.md: シークレット未ログ)。
 */
export function createVerifier(opts: CreateVerifierOpts): Verifier {
  const jwks =
    opts.jwks ??
    createRemoteJWKSet(
      new URL(`https://${opts.teamDomain}/cdn-cgi/access/certs`)
    );
  const issuer = `https://${opts.teamDomain}`;
  return async (token: string): Promise<VerifyResult> => {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: opts.aud,
      });
      return { ok: true, payload };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  };
}
