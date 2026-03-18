import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const app = new Hono();

app.get("/api/health", (c) => c.json({ status: "ok" }));

// --- お問い合わせフォーム受信 ---
app.post("/api/contact", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();

  // 必須フィールドチェック
  const { name, email, message } = body;
  if (!name || !email || !message) {
    return c.json(
      { success: false, error: "name, email, message は必須です" },
      400
    );
  }

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

// ローカル開発時のスタンドアロン起動
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
