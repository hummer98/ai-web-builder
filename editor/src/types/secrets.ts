/**
 * BYOK アクセスキー関連の型定義 (editor 側)。
 *
 * 同期要件: container/agent-server/src/secrets-store.ts および api-secrets.ts と
 * 手動で同期すること。
 *  - editor と agent-server は別 npm パッケージで型を直接 import できないため
 *    両側で同一の型を定義している
 *  - 型を追加・変更したら両側に同じ変更を入れる
 */

export type Provider = "openrouter" | "gemini" | "cloudflare" | "firebase";

export interface SecretStatus {
  openrouter: { set: boolean; last4?: string };
  gemini: { set: boolean; last4?: string };
  cloudflare: { set: boolean; last4?: string; accountId?: string };
  firebase: { set: boolean; last4?: string };
}

export interface SecretsUpdate {
  openrouter?: { apiKey: string };
  gemini?: { apiKey: string };
  cloudflare?: { apiToken: string; accountId: string };
  firebase?: { token: string };
}
