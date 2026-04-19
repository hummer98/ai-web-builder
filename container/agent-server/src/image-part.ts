import { readFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";

/**
 * FilePartInput の形（opencode SDK）に合わせた戻り値。
 * SDK 側の型に依存させると循環しやすいので最小限のインターフェースを定義。
 */
export type ImageFilePart = {
  type: "file";
  mime: string;
  filename: string;
  url: string;
};

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function resolveMime(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

/**
 * ユーザーがアップロードした画像を data URL 化した FilePartInput を返す。
 *
 * - `imageUrl` は `/uploads/<filename>` 形式を想定（先頭スラッシュの欠落は許容）
 * - 画像の実体は `<workspaceDir>/public/uploads/<filename>` に保存されている
 * - data URL 方式を採るのは、opencode server の URL 解釈実装に依存せず
 *   コンテナ内 fetch も不要にするため（plan §2.2 参照）
 */
export async function buildImagePart(
  imageUrl: string,
  workspaceDir: string
): Promise<ImageFilePart> {
  const filename = basename(imageUrl.replace(/^\/?uploads\//, ""));
  const absolute = join(workspaceDir, "public", "uploads", filename);
  const buf = await readFile(absolute);
  const mime = resolveMime(filename);
  const b64 = buf.toString("base64");
  return {
    type: "file",
    mime,
    filename,
    url: `data:${mime};base64,${b64}`,
  };
}
