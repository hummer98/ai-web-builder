import { useState, useRef, useEffect } from "react";
import type { WSMessage } from "../hooks/useWebSocket";

type ChatMessage = {
  role: "user" | "assistant" | "status";
  content: string;
};

type Props = {
  connected: boolean;
  messages: WSMessage[];
  onSend: (msg: WSMessage) => void;
};

export default function ChatPanel({ connected, messages, onSend }: Props) {
  const [input, setInput] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // WS メッセージをチャット履歴に変換
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];

    if (last.type === "status") {
      setLoading(true);
    } else if (last.type === "response") {
      setChat((prev) => [
        ...prev,
        { role: "assistant", content: last.message ?? "" },
      ]);
      setLoading(false);
    } else if (last.type === "error") {
      setChat((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${last.message}` },
      ]);
      setLoading(false);
    }
  }, [messages]);

  // 自動スクロール
  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [chat, loading]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !connected) return;

    setChat((prev) => [...prev, { role: "user", content: input }]);
    onSend({ type: "chat", message: input });
    setInput("");
  }

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-100">
      {/* ヘッダー */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700">
        <div
          className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`}
        />
        <span className="text-sm font-medium">AI Web Builder</span>
      </div>

      {/* メッセージ一覧 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {chat.length === 0 && (
          <p className="text-gray-500 text-sm">
            チャットで指示を送ると、AIがサイトを編集します。
          </p>
        )}
        {chat.map((msg, i) => (
          <div
            key={i}
            className={`text-sm whitespace-pre-wrap ${
              msg.role === "user"
                ? "bg-blue-600/20 text-blue-100 rounded-lg px-3 py-2 ml-8"
                : "bg-gray-800 text-gray-200 rounded-lg px-3 py-2 mr-8"
            }`}
          >
            {msg.content}
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <div className="animate-pulse">●</div>
            考え中...
          </div>
        )}
      </div>

      {/* 入力フォーム */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-gray-700">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="指示を入力..."
            disabled={!connected}
            className="flex-1 bg-gray-800 text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 placeholder-gray-500"
          />
          <button
            type="submit"
            disabled={!connected || !input.trim()}
            className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            送信
          </button>
        </div>
      </form>
    </div>
  );
}
