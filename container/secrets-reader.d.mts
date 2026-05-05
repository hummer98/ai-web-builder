/** SECRETS_FILE env → /data/secrets.json → <repo>/data/secrets.json の優先順で解決。 */
export function resolveSecretsPath(): string;

/** OpenCode 起動時に opencode.json へ流し込む BYOK の API キー（フラットな形）。 */
export interface OpencodeRelevantSecrets {
  openrouterApiKey?: string;
  geminiApiKey?: string;
}

/** secrets.json から openrouter / gemini の apiKey を抽出する。失敗時は throw せず {} を返す。 */
export function loadOpencodeRelevantSecrets(): OpencodeRelevantSecrets;
