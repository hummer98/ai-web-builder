import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();

app.get("/api/health", (c) => c.json({ status: "ok" }));

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
