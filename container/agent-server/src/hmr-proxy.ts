import { createConnection } from "node:net";
import type { Server } from "node:http";
import type { Socket } from "node:net";
import { createLogger } from "./logger.js";

const log = createLogger("hmr-proxy");

/**
 * HTTP server に Vite HMR WebSocket プロキシを設定する。
 * /preview/ パスへの WebSocket upgrade を Vite Dev Server に転送する。
 */
export function setupHmrProxy(
  server: Server,
  options?: { viteHost?: string; vitePort?: number }
): void {
  const viteHost = options?.viteHost ?? "localhost";
  const vitePort = options?.vitePort ?? parseInt(process.env.VITE_PORT ?? "5173", 10);

  server.on("upgrade", (req, socket: Socket, head) => {
    const url = req.url ?? "";
    // /preview/ パスのみ処理。それ以外は hono-ws (injectWebSocket) に任せる
    if (!url.startsWith("/preview/")) return;

    log.info("Proxying HMR WebSocket", { url });

    // Vite に TCP 接続し、HTTP upgrade リクエストを転送
    const proxy = createConnection({ host: viteHost, port: vitePort }, () => {
      // HTTP upgrade リクエストを再構築
      let header = `GET ${url} HTTP/1.1\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        header += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
      }
      header += "\r\n";
      proxy.write(header);
      if (head.length > 0) proxy.write(head);

      // 双方向パイプ
      proxy.pipe(socket);
      socket.pipe(proxy);
    });

    proxy.on("error", (err) => {
      log.warn("HMR proxy error", { error: String(err) });
      try { socket.destroy(); } catch {}
    });
    socket.on("error", () => {
      try { proxy.destroy(); } catch {}
    });
  });
}
