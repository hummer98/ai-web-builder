import { useCallback, useEffect, useRef, useState } from "react";

export type WSMessage = {
  type: string;
  message?: string;
  [key: string]: unknown;
};

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<WSMessage[]>([]);

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      // 再接続（3秒後）
      setTimeout(() => {
        if (wsRef.current?.readyState === WebSocket.CLOSED) {
          wsRef.current = new WebSocket(url);
        }
      }, 3000);
    };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data) as WSMessage;
      setMessages((prev) => [...prev, data]);
    };

    return () => ws.close();
  }, [url]);

  const send = useCallback((msg: WSMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { connected, messages, send };
}
