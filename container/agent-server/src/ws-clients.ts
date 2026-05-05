/**
 * 接続中の WebSocket クライアントをモジュールスコープで保持し、
 * supervisor 等から system event を一括 broadcast するための薄いレジストリ。
 *
 * ws-handler.ts の onOpen/onClose で add/remove する。
 */

type Sender = { send: (data: string) => void };

const clients = new Set<Sender>();

export function addClient(ws: Sender): void {
  clients.add(ws);
}

export function removeClient(ws: Sender): void {
  clients.delete(ws);
}

export function broadcastSystem(
  event: "opencode_restarting" | "opencode_ready"
): void {
  const payload = JSON.stringify({ type: "system", event });
  for (const ws of clients) {
    try {
      ws.send(payload);
    } catch {
      // close 直後の race 等は無視。次回の broadcast 時には Set から消えている想定。
    }
  }
}
