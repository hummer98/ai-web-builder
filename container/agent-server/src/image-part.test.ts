import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildImagePart } from "./image-part.js";

describe("buildImagePart", () => {
  let workspaceDir: string;

  beforeAll(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), "aiwb-image-part-"));
    await mkdir(join(workspaceDir, "public", "uploads"), { recursive: true });
    // PNG のダミーバイト（先頭4バイトだけでも base64 化は可能）
    await writeFile(
      join(workspaceDir, "public", "uploads", "test.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    await writeFile(
      join(workspaceDir, "public", "uploads", "photo.jpg"),
      Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    );
    await writeFile(
      join(workspaceDir, "public", "uploads", "photo.jpeg"),
      Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    );
    await writeFile(
      join(workspaceDir, "public", "uploads", "animation.gif"),
      Buffer.from([0x47, 0x49, 0x46, 0x38])
    );
    await writeFile(
      join(workspaceDir, "public", "uploads", "image.webp"),
      Buffer.from([0x52, 0x49, 0x46, 0x46])
    );
    await writeFile(
      join(workspaceDir, "public", "uploads", "file.bin"),
      Buffer.from([0x00, 0x01])
    );
  });

  afterAll(async () => {
    await rm(workspaceDir, { recursive: true, force: true });
  });

  it("PNG → mime=image/png, data URL を返す", async () => {
    const part = await buildImagePart("/uploads/test.png", workspaceDir);
    expect(part.type).toBe("file");
    expect(part.mime).toBe("image/png");
    expect(part.url).toMatch(/^data:image\/png;base64,/);
    expect(part.filename).toBe("test.png");
  });

  it("JPG → mime=image/jpeg", async () => {
    const part = await buildImagePart("/uploads/photo.jpg", workspaceDir);
    expect(part.mime).toBe("image/jpeg");
    expect(part.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("JPEG (大文字) → mime=image/jpeg", async () => {
    const part = await buildImagePart("/uploads/photo.jpeg", workspaceDir);
    expect(part.mime).toBe("image/jpeg");
  });

  it("GIF → mime=image/gif", async () => {
    const part = await buildImagePart("/uploads/animation.gif", workspaceDir);
    expect(part.mime).toBe("image/gif");
  });

  it("WebP → mime=image/webp", async () => {
    const part = await buildImagePart("/uploads/image.webp", workspaceDir);
    expect(part.mime).toBe("image/webp");
  });

  it("不明な拡張子 → mime=application/octet-stream", async () => {
    const part = await buildImagePart("/uploads/file.bin", workspaceDir);
    expect(part.mime).toBe("application/octet-stream");
  });

  it("存在しないパス → throw", async () => {
    await expect(
      buildImagePart("/uploads/does-not-exist.png", workspaceDir)
    ).rejects.toThrow();
  });

  it("/uploads/ を外したパスでも解決できる (先頭スラッシュ欠落は許容)", async () => {
    const part = await buildImagePart("uploads/test.png", workspaceDir);
    expect(part.mime).toBe("image/png");
  });

  it("base64 エンコード内容が元バイト列と一致する", async () => {
    const part = await buildImagePart("/uploads/test.png", workspaceDir);
    const b64 = part.url.replace(/^data:image\/png;base64,/, "");
    const decoded = Buffer.from(b64, "base64");
    expect(decoded).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  });
});
