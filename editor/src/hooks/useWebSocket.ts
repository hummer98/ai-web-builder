import { useCallback, useEffect, useRef, useState } from "react";
import type { WSOutboundMessage } from "../types/ws-outbound";

export type WSMessage = WSOutboundMessage;

const RECONNECT_DELAY_MS = 3000;

/**
 * 受信した string を WSMessage にパースする純関数。
 *  - 不正 JSON は null を返す
 *  - type が string でないものも null を返す (悪意ある proxy / バグ対策)
 *
 * テストしやすいよう export している。
 */
export function parseInboundMessage(raw: string): WSMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const type = (data as { type?: unknown }).type;
  if (typeof type !== "string") return null;
  return data as WSMessage;
}

export type WSSendable =
  | { type: "chat"; message: string; imageUrl?: string; elementContext?: unknown }
  | { type: "undo" }
  | { type: "history"; count?: number }
  | { type: "revert"; hash: string }
  | { type: "deploy" }
  | { type: "create-site"; siteName: string }
  | { type: "import-repo"; repoName: string }
  | { type: "site-brief-get" }
  | { type: "site-brief-set"; content: string }
  | { type: "answer"; requestId: string; answers: string[][] };

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<WSMessage[]>([]);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setConnected(true);
      };
      ws.onmessage = (event) => {
        if (cancelled) return;
        const msg = parseInboundMessage(event.data as string);
        if (!msg) return;
        setMessages((prev) => [...prev, msg]);
      };
      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [url]);

  const send = useCallback((msg: WSSendable) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { connected, messages, send };
}
