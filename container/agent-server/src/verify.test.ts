import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { verifyServers } from "./verify.js";

type Started = { server: Server; port: number };

async function startMock(handler: (status: number) => number): Promise<Started> {
  const server = createServer((_req, res) => {
    res.statusCode = handler(200);
    res.end("ok");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address() as AddressInfo;
  return { server, port: addr.port };
}

async function close(s: Started): Promise<void> {
  await new Promise<void>((r) => s.server.close(() => r()));
}

describe("verifyServers", () => {
  let viteMock: Started;
  let honoMock: Started;

  beforeAll(async () => {
    viteMock = await startMock(() => 200);
    honoMock = await startMock(() => 200);
  });

  afterAll(async () => {
    await close(viteMock);
    await close(honoMock);
  });

  it("両サーバーが 200 を返せば ok=true", async () => {
    const r = await verifyServers({
      viteUrl: `http://127.0.0.1:${viteMock.port}/`,
      honoUrl: `http://127.0.0.1:${honoMock.port}/api/health`,
    });
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("Vite が接続不可なら ok=false で reason に Vite を含む", async () => {
    const r = await verifyServers({
      viteUrl: `http://127.0.0.1:1/`, // unreachable
      honoUrl: `http://127.0.0.1:${honoMock.port}/api/health`,
      timeoutMs: 500,
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((s) => s.startsWith("Vite"))).toBe(true);
  });

  it("Hono が 500 を返したら ok=false", async () => {
    const failing = createServer((_req, res) => {
      res.statusCode = 500;
      res.end("err");
    });
    await new Promise<void>((r) => failing.listen(0, "127.0.0.1", () => r()));
    const port = (failing.address() as AddressInfo).port;

    try {
      const r = await verifyServers({
        viteUrl: `http://127.0.0.1:${viteMock.port}/`,
        honoUrl: `http://127.0.0.1:${port}/api/health`,
      });
      expect(r.ok).toBe(false);
      expect(r.reasons.some((s) => s.startsWith("Hono"))).toBe(true);
    } finally {
      await new Promise<void>((r) => failing.close(() => r()));
    }
  });

  it("404 は OK 扱い (サーバーは生きている)", async () => {
    const fourOhFour = createServer((_req, res) => {
      res.statusCode = 404;
      res.end("not found");
    });
    await new Promise<void>((r) => fourOhFour.listen(0, "127.0.0.1", () => r()));
    const port = (fourOhFour.address() as AddressInfo).port;

    try {
      const r = await verifyServers({
        viteUrl: `http://127.0.0.1:${viteMock.port}/`,
        honoUrl: `http://127.0.0.1:${port}/api/health`,
      });
      expect(r.ok).toBe(true);
    } finally {
      await new Promise<void>((r) => fourOhFour.close(() => r()));
    }
  });
});
