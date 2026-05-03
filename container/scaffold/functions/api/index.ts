import { Hono } from "hono";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const ContactSchema = z.object({
  name: z.string().min(1).max(100),
  email: z
    .string()
    .email()
    .max(254)
    .refine((s) => !/[\r\n]/.test(s), { message: "改行は使用できません" }),
  message: z.string().min(1).max(5000),
});

const app = new Hono();

app.get("/api/health", (c) => c.json({ status: "ok" }));

// --- お問い合わせフォーム受信 ---
app.post("/api/contact", zValidator("json", ContactSchema), async (c) => {
  const { name, email, message } = c.req.valid("json");
  const entry = JSON.stringify({
    name,
    email,
    message,
    receivedAt: new Date().toISOString(),
  });
  const filePath = "data/submissions.json";
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, entry + "\n", "utf-8");
  return c.json({ success: true });
});

export default app;

// ローカル開発時のスタンドアロン起動 (テスト時は副作用回避: import.meta.url ガード)
// @hono/node-server は scaffold の dependencies には含めない (本番は Cloudflare Pages
// Functions として app.fetch が直接呼ばれる)。dev 起動時のみ dynamic import で解決し、
// テスト import / Pages ビルド時には何もしない。
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { serve } = await import("@hono/node-server");
  serve({ fetch: app.fetch, port: 3000 }, () => {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        service: "hono",
        msg: "Hono Dev Server started on :3000",
      })
    );
  });
}
