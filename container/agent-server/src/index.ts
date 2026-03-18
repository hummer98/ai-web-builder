import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { autoCommit, autoPush, undoLastCommit } from "./git-ops.js";
import { deploy } from "./deploy.js";
import { createNewSite, importExistingRepo } from "./site-init.js";
import { createLogger } from "./logger.js";

const log = createLogger("agent-server");
const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

const OPENCODE_URL = process.env.OPENCODE_URL ?? "http://localhost:4096";
const VITE_URL = process.env.VITE_URL ?? "http://localhost:5173";
const SITE_NAME = process.env.SITE_DOMAIN ?? "guest-site";

// 本番環境では Cloudflare Access JWT が必須（/health は除外）
app.use("*", async (c, next) => {
  if (process.env.NODE_ENV !== "production") return next();
  if (c.req.path === "/health") return next();
  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (!jwt) {
    log.warn("Access denied: missing Cf-Access-Jwt-Assertion", {
      path: c.req.path,
      ip: c.req.header("x-forwarded-for") ?? "unknown",
    });
    return c.text("Unauthorized", 401);
  }
  return next();
});

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// ゲストサイトプレビューへのプロキシ (/preview/*)
// Vite の base='/preview/' に合わせてパスをそのまま転送する
app.all("/preview/*", async (c) => {
  const path = c.req.path; // /preview/... のまま渡す
  const url = `${VITE_URL}${path}`;
  try {
    const resp = await fetch(url, {
      method: c.req.method,
      headers: c.req.raw.headers,
    });
    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers,
    });
  } catch {
    return c.text("Preview server not available", 502);
  }
});

// WebSocket endpoint
app.get(
  "/ws",
  upgradeWebSocket(() => {
    let opencode: ReturnType<typeof createOpencodeClient>;
    let sessionId: string | undefined;

    return {
      async onOpen(_, ws) {
        log.info("WS connected");

        try {
          opencode = createOpencodeClient({ baseUrl: OPENCODE_URL });
          log.info("OpenCode client created", { url: OPENCODE_URL });
        } catch (err) {
          log.error("OpenCode client creation failed", {
            error: String(err),
          });
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Failed to connect to OpenCode",
            })
          );
        }
      },

      async onMessage(event, ws) {
        const data = JSON.parse(event.data as string);
        log.info("WS message received", { type: data.type });

        if (data.type === "chat") {
          try {
            // コマンド判定（要素コンテキストがない場合のみ）
            if (!data.elementContext?.ocId) {
              const cmd = detectCommand(data.message);
              if (cmd) {
                log.info("Command detected", { command: cmd.type });
                await handleCommand(cmd, ws);
                return;
              }
            }

            // セッション作成（初回のみ）
            if (!sessionId) {
              const session = await opencode.session.create();
              sessionId = session.id;
              log.info("OpenCode session created", { sessionId });
            }

            // ユーザーの指示を通知
            ws.send(
              JSON.stringify({
                type: "status",
                message: "thinking",
              })
            );

            // プロンプト送信
            const prompt = buildPrompt(data);
            const result = await opencode.session.prompt({
              path: { id: sessionId },
              body: {
                parts: [{ type: "text", text: prompt }],
              },
            });

            // 結果を送信
            const responseText = extractText(result);
            ws.send(
              JSON.stringify({
                type: "response",
                message: responseText,
              })
            );

            log.info("OpenCode response sent", { sessionId });

            // バックグラウンドで自動コミット + push（応答はブロックしない）
            (async () => {
              try {
                const summary = truncateForCommit(responseText);
                const hash = autoCommit(summary);
                if (hash) {
                  await autoPush();
                  ws.send(JSON.stringify({ type: "git", action: "commit", hash }));
                }
              } catch (err) {
                log.error("Background git ops failed", { error: String(err) });
              }
            })();
          } catch (err) {
            log.error("OpenCode prompt failed", { error: String(err) });
            ws.send(
              JSON.stringify({
                type: "error",
                message: `AI error: ${err}`,
              })
            );
          }
        }

        if (data.type === "undo") {
          try {
            const hash = undoLastCommit();
            if (hash) {
              ws.send(
                JSON.stringify({
                  type: "git",
                  action: "undo",
                  message: `変更を元に戻しました (${hash})`,
                })
              );
              log.info("Undo completed", { hash });
              // undo 後も push（バックグラウンド）
              autoPush().catch((err) =>
                log.error("Push after undo failed", { error: String(err) })
              );
            } else {
              ws.send(
                JSON.stringify({ type: "error", message: "元に戻す変更がありません" })
              );
            }
          } catch (err) {
            log.error("Undo failed", { error: String(err) });
            ws.send(
              JSON.stringify({ type: "error", message: `元に戻す操作に失敗しました: ${err}` })
            );
          }
        }

        if (data.type === "deploy") {
          const siteName = process.env.SITE_DOMAIN ?? "guest-site";
          log.info("Deploy requested", { siteName });
          ws.send(JSON.stringify({ type: "status", message: "deploying" }));

          try {
            const result = await deploy(siteName);
            if (result.success) {
              ws.send(
                JSON.stringify({
                  type: "deploy",
                  success: true,
                  url: result.pagesUrl,
                })
              );
            } else {
              ws.send(
                JSON.stringify({
                  type: "deploy",
                  success: false,
                  error: result.error,
                })
              );
            }
          } catch (err) {
            log.error("Deploy failed", { error: String(err) });
            ws.send(
              JSON.stringify({
                type: "deploy",
                success: false,
                error: String(err),
              })
            );
          }
        }

        if (data.type === "create-site") {
          const { owner, siteName } = data;
          log.info("Create site requested", { owner, siteName });
          ws.send(JSON.stringify({ type: "status", message: "creating" }));

          try {
            const result = await createNewSite(owner, siteName);
            if (result.success) {
              ws.send(
                JSON.stringify({
                  type: "site-init",
                  action: "created",
                  repoUrl: result.repoUrl,
                })
              );
            } else {
              ws.send(
                JSON.stringify({ type: "error", message: result.error })
              );
            }
          } catch (err) {
            log.error("Create site failed", { error: String(err) });
            ws.send(
              JSON.stringify({ type: "error", message: String(err) })
            );
          }
        }

        if (data.type === "import-repo") {
          const { owner, repoName } = data;
          log.info("Import repo requested", { owner, repoName });
          ws.send(JSON.stringify({ type: "status", message: "importing" }));

          try {
            const result = await importExistingRepo(owner, repoName);
            if (result.success) {
              ws.send(
                JSON.stringify({
                  type: "site-init",
                  action: "imported",
                  repoUrl: result.repoUrl,
                })
              );
            } else {
              ws.send(
                JSON.stringify({ type: "error", message: result.error })
              );
            }
          } catch (err) {
            log.error("Import repo failed", { error: String(err) });
            ws.send(
              JSON.stringify({ type: "error", message: String(err) })
            );
          }
        }
      },

      onClose() {
        log.info("WS disconnected", { sessionId });
      },

      onError(error) {
        log.error("WS error", { error: String(error) });
      },
    };
  })
);

/**
 * AI 応答テキストからコミットメッセージ用の要約を作成（50文字程度）
 */
function truncateForCommit(text: string): string {
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) ?? "AI edit";
  if (firstLine.length <= 50) return firstLine;
  return firstLine.slice(0, 47) + "...";
}

/**
 * Source Locator のコンテキスト付きプロンプトを構築
 */
function buildPrompt(data: {
  message: string;
  elementContext?: {
    ocId?: string;
    tag?: string;
    text?: string;
    classes?: string;
    componentTree?: { name: string; file: string }[];
  };
}): string {
  const parts: string[] = [];

  if (data.elementContext?.ocId) {
    const ctx = data.elementContext;
    parts.push("## 対象要素");
    if (ctx.ocId) parts.push(`- ID: ${ctx.ocId}`);
    if (ctx.tag) parts.push(`- タグ: ${ctx.tag}`);
    if (ctx.text) parts.push(`- テキスト: "${ctx.text}"`);
    if (ctx.classes) parts.push(`- クラス: ${ctx.classes}`);
    if (ctx.componentTree?.length) {
      parts.push(
        `- コンポーネント: ${ctx.componentTree.map((c) => c.name).join(" > ")}`
      );
      parts.push(`- ファイル: ${ctx.componentTree[0].file}`);
    }
    parts.push("");
  }

  parts.push("## ユーザーの指示");
  parts.push(data.message);

  return parts.join("\n");
}

/**
 * OpenCode のレスポンスからテキストを抽出
 */
function extractText(result: unknown): string {
  if (result && typeof result === "object" && "parts" in result) {
    const parts = (result as { parts: { type: string; text?: string }[] })
      .parts;
    return parts
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("\n");
  }
  return String(result);
}

// ---------------------------------------------------------------------------
// 自然言語コマンド認識
// ---------------------------------------------------------------------------

type Command = { type: "undo" } | { type: "deploy" };

/**
 * ユーザーのメッセージが既知のコマンドに該当するかを正規表現で判定。
 * 曖昧な場合は null を返して OpenCode に委ねる。
 */
function detectCommand(message: string): Command | null {
  const trimmed = message.trim();

  // undo
  if (/^(元に戻して|戻して|取り消して|やり直して|undo)$/i.test(trimmed)) {
    return { type: "undo" };
  }
  if (/^(さっきの(変更(を)?)?)?元に戻し(て|たい)$/i.test(trimmed)) {
    return { type: "undo" };
  }
  if (/^(さっきの(変更(を)?)?)?(取り消し|やり直し)(て|たい)$/i.test(trimmed)) {
    return { type: "undo" };
  }

  // deploy
  if (/^(公開して|公開したい|デプロイして|デプロイしたい|publish|deploy)$/i.test(trimmed)) {
    return { type: "deploy" };
  }
  if (/^サイトを(公開|デプロイ)して$/i.test(trimmed)) {
    return { type: "deploy" };
  }

  return null;
}

/**
 * 検出されたコマンドを実行し、結果を WebSocket で送信する。
 */
async function handleCommand(
  cmd: Command,
  ws: { send: (data: string) => void }
): Promise<void> {
  switch (cmd.type) {
    case "undo": {
      ws.send(JSON.stringify({ type: "status", message: "undoing" }));
      const hash = undoLastCommit();
      if (hash) {
        autoPush().catch(() => {});
        ws.send(
          JSON.stringify({
            type: "response",
            message: `変更を元に戻しました (commit: ${hash})`,
          })
        );
      } else {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "元に戻せる変更がありませんでした",
          })
        );
      }
      break;
    }

    case "deploy": {
      ws.send(JSON.stringify({ type: "status", message: "deploying" }));
      const result = await deploy(SITE_NAME);
      if (result.success) {
        ws.send(
          JSON.stringify({
            type: "response",
            message: result.pagesUrl
              ? `サイトを公開しました！\n${result.pagesUrl}`
              : "サイトを公開しました！",
          })
        );
      } else {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `公開に失敗しました: ${result.error}`,
          })
        );
      }
      break;
    }
  }
}

// エディター UI の静的ファイル配信（本番時: ビルド済み dist/）
if (process.env.NODE_ENV === "production") {
  app.use(
    "/*",
    serveStatic({ root: "../../editor/dist" })
  );
  // SPA フォールバック
  app.get("/*", serveStatic({ root: "../../editor/dist", path: "index.html" }));
}

const port = 8080;
const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  log.info(`Agent Server started on 0.0.0.0:${port}`);
});

injectWebSocket(server);
