import { useState, useRef, useEffect } from "react";
import type { WSMessage } from "../hooks/useWebSocket";
import type { ElementContext } from "./PreviewPanel";

type ChatMessage = {
  role: "user" | "assistant" | "status";
  content: string;
};

type Props = {
  connected: boolean;
  messages: WSMessage[];
  onSend: (msg: WSMessage) => void;
  selectedElement: ElementContext | null;
  onClearElement: () => void;
};

export default function ChatPanel({
  connected,
  messages,
  onSend,
  selectedElement,
  onClearElement,
}: Props) {
  const [input, setInput] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // WS メッセージをチャット履歴に変換
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];

    if (last.type === "status") {
      if (last.message === "deploying") {
        setDeploying(true);
      } else {
        setLoading(true);
      }
    } else if (last.type === "response") {
      setChat((prev) => [
        ...prev,
        { role: "assistant", content: last.message ?? "" },
      ]);
      setLoading(false);
    } else if (last.type === "deploy") {
      setDeploying(false);
      if (last.success) {
        setChat((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `公開しました!\n${(last as { url?: string }).url ?? ""}`,
          },
        ]);
      } else {
        setChat((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `公開に失敗しました: ${(last as { error?: string }).error ?? "不明なエラー"}`,
          },
        ]);
      }
    } else if (last.type === "git") {
      setChat((prev) => [
        ...prev,
        { role: "status", content: (last as { message?: string }).message ?? "" },
      ]);
      setUndoing(false);
    } else if (last.type === "error") {
      setChat((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${last.message}` },
      ]);
      setLoading(false);
      setUndoing(false);
    }
  }, [messages]);

  function handleUndo() {
    if (!connected || undoing) return;
    setUndoing(true);
    onSend({ type: "undo" });
  }

  // 自動スクロール
  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [chat, loading]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !connected) return;

    const displayMsg = selectedElement
      ? `[${selectedElement.componentTree[0]?.name ?? selectedElement.tag}] ${input}`
      : input;

    setChat((prev) => [...prev, { role: "user", content: displayMsg }]);
    onSend({
      type: "chat",
      message: input,
      elementContext: selectedElement ?? undefined,
    });
    setInput("");
    onClearElement();
  }

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-100">
      {/* ヘッダー */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700">
        <div
          className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`}
        />
        <span className="text-sm font-medium flex-1">AI Web Builder</span>
        <button
          onClick={handleUndo}
          disabled={!connected || undoing}
          className="flex items-center gap-1 bg-gray-700 text-gray-200 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          title="直前の変更を元に戻す"
        >
          {undoing ? (
            <>
              <span className="animate-spin">&#8635;</span>
              戻し中...
            </>
          ) : (
            <>
              <span>&#8630;</span>
              元に戻す
            </>
          )}
        </button>
        <button
          onClick={() => onSend({ type: "deploy" })}
          disabled={!connected || deploying}
          className="bg-emerald-600 text-white rounded-lg px-3 py-1 text-xs font-medium hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
        >
          {deploying ? (
            <>
              <span className="animate-spin inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full" />
              公開中...
            </>
          ) : (
            "公開"
          )}
        </button>
      </div>

      {/* メッセージ一覧 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {chat.length === 0 && (
          <p className="text-gray-500 text-sm">
            チャットで指示を送ると、AIがサイトを編集します。
            <br />
            Inspect ボタンで要素を選択してから指示すると、ピンポイントで編集できます。
          </p>
        )}
        {chat.map((msg, i) => (
          <div
            key={i}
            className={`text-sm whitespace-pre-wrap ${
              msg.role === "user"
                ? "bg-blue-600/20 text-blue-100 rounded-lg px-3 py-2 ml-8"
                : msg.role === "status"
                  ? "bg-green-600/20 text-green-200 rounded-lg px-3 py-2 text-center"
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

      {/* 選択中の要素表示 */}
      {selectedElement && (
        <div className="mx-3 mb-1 px-3 py-2 bg-orange-500/20 border border-orange-500/40 rounded-lg text-xs text-orange-200 flex items-center gap-2">
          <span className="flex-1">
            {selectedElement.componentTree[0]?.name ?? selectedElement.tag}
            {selectedElement.text && (
              <span className="text-orange-300/60 ml-1">
                "{selectedElement.text.slice(0, 30)}"
              </span>
            )}
          </span>
          <button
            onClick={onClearElement}
            className="text-orange-300 hover:text-orange-100"
          >
            x
          </button>
        </div>
      )}

      {/* 入力フォーム */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-gray-700">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              selectedElement
                ? `${selectedElement.componentTree[0]?.name ?? selectedElement.tag} への指示...`
                : "指示を入力..."
            }
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
