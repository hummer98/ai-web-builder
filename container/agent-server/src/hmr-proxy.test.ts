import { describe, it, expect } from "vitest";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { request } from "node:http";
import { setupHmrProxy } from "./hmr-proxy.js";

function listenOnRandomPort(server: { listen: Function; address: Function }): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

function forceClose(server: { closeAllConnections?: Function; close: Function }) {
  server.closeAllConnections?.();
  server.close();
}

describe("setupHmrProxy", () => {
  it("/preview/ パスの WebSocket upgrade を Vite にプロキシする", async () => {
    const receivedData: string[] = [];
    const mockVite = createTcpServer((socket) => {
      socket.on("data", (data) => {
        const str = data.toString();
        receivedData.push(str);
        if (str.includes("GET /preview/")) {
          socket.write(
            "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "\r\n"
          );
          setTimeout(() => socket.write("hello from vite"), 50);
        }
      });
    });
    const vitePort = await listenOnRandomPort(mockVite);

    const httpServer = createHttpServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    setupHmrProxy(httpServer, { viteHost: "127.0.0.1", vitePort });
    const proxyPort = await listenOnRandomPort(httpServer);

    try {
      const response = await new Promise<{ statusCode: number; data: string }>((resolve, reject) => {
        const req = request({
          hostname: "127.0.0.1",
          port: proxyPort,
          path: "/preview/__vite_hmr",
          headers: {
            Upgrade: "websocket",
            Connection: "Upgrade",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version": "13",
          },
        });

        req.on("upgrade", (res: { statusCode: number }, socket: { on: Function; destroy: Function }) => {
          let data = "";
          socket.on("data", (chunk: Buffer) => {
            data += chunk.toString();
            if (data.includes("hello from vite")) {
              socket.destroy();
              resolve({ statusCode: res.statusCode, data });
            }
          });
          setTimeout(() => {
            socket.destroy();
            resolve({ statusCode: res.statusCode, data });
          }, 2000);
        });

        req.on("error", reject);
        req.end();
      });

      expect(response.statusCode).toBe(101);
      expect(response.data).toContain("hello from vite");

      const upgradeReq = receivedData.find((d) => d.includes("GET /preview/"));
      expect(upgradeReq).toBeDefined();
      expect(upgradeReq).toContain("/preview/__vite_hmr");
    } finally {
      forceClose(httpServer);
      forceClose(mockVite);
    }
  });

  it("/preview/ 以外のパスはプロキシしない", async () => {
    let viteConnected = false;
    const mockVite = createTcpServer(() => {
      viteConnected = true;
    });
    const vitePort = await listenOnRandomPort(mockVite);

    const httpServer = createHttpServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    setupHmrProxy(httpServer, { viteHost: "127.0.0.1", vitePort });
    const proxyPort = await listenOnRandomPort(httpServer);

    try {
      await new Promise<void>((resolve) => {
        const req = request({
          hostname: "127.0.0.1",
          port: proxyPort,
          path: "/ws",
          headers: {
            Upgrade: "websocket",
            Connection: "Upgrade",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version": "13",
          },
        });

        req.on("upgrade", () => {
          req.destroy();
          resolve();
        });
        req.on("error", () => resolve());
        setTimeout(() => {
          req.destroy();
          resolve();
        }, 300);
        req.end();
      });

      expect(viteConnected).toBe(false);
    } finally {
      forceClose(httpServer);
      forceClose(mockVite);
    }
  });
});
