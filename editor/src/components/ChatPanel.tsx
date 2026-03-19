import { useState, useRef, useEffect, useCallback } from "react";
import type { WSMessage } from "../hooks/useWebSocket";
import type { ElementContext } from "./PreviewPanel";

export type ChatMessage = {
  role: "user" | "assistant" | "status";
  content: string;
};

type Props = {
  connected: boolean;
  messages: WSMessage[];
  onSend: (msg: WSMessage) => void;
  selectedElement: ElementContext | null;
  onClearElement: () => void;
  injectedMessages?: ChatMessage[];
  onHelp: () => void;
};

export default function ChatPanel({
  connected,
  messages,
  onSend,
  selectedElement,
  onClearElement,
  injectedMessages,
  onHelp,
}: Props) {
  const [input, setInput] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const processedRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [commits, setCommits] = useState<{ hash: string; message: string; date: string }[]>([]);

  // WS メッセージをチャット履歴に変換
  useEffect(() => {
    const start = processedRef.current;
    if (start >= messages.length) return;

    for (let i = start; i < messages.length; i++) {
      const msg = messages[i];

      switch (msg.type) {
        case "status":
          if (msg.message === "deploying") {
            setDeploying(true);
          } else {
            setLoading(true);
            setStatusText(msg.message ?? "thinking");
          }
          break;

        case "stream":
          // ストリーミング中: 最後の assistant メッセージに delta を追記
          setLoading(false);
          setStreaming(true);
          setStatusText(null);
          setChat((prev) => {
            const delta = String((msg as { delta?: string }).delta ?? "");
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...last,
                content: last.content + delta,
              };
              return updated;
            }
            return [...prev, { role: "assistant", content: delta }];
          });
          break;

        case "stream-end":
          setStreaming(false);
          setLoading(false);
          setStatusText(null);
          break;

        case "response":
          // 非ストリーミングのフォールバック
          setChat((prev) => [
            ...prev,
            { role: "assistant", content: msg.message ?? "" },
          ]);
          setLoading(false);
          setStreaming(false);
          setStatusText(null);
          break;

        case "deploy":
          setDeploying(false);
          if ((msg as { success?: boolean }).success) {
            setChat((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `公開しました!\n${(msg as { url?: string }).url ?? ""}`,
              },
            ]);
          } else {
            setChat((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `公開に失敗しました: ${(msg as { error?: string }).error ?? "不明なエラー"}`,
              },
            ]);
          }
          break;

        case "git":
          setChat((prev) => [
            ...prev,
            { role: "status", content: (msg as { message?: string }).message ?? "" },
          ]);
          setUndoing(false);
          break;

        case "history":
          setHistoryLoading(false);
          setCommits((msg as { commits?: { hash: string; message: string; date: string }[] }).commits ?? []);
          break;

        case "error":
          setChat((prev) => [
            ...prev,
            { role: "assistant", content: `Error: ${msg.message}` },
          ]);
          setLoading(false);
          setStreaming(false);
          setUndoing(false);
          setHistoryLoading(false);
          setStatusText(null);
          break;
      }
    }

    processedRef.current = messages.length;
  }, [messages]);

  // 外部から注入されたメッセージをチャットに追加
  const injectedCountRef = useRef(0);
  useEffect(() => {
    if (!injectedMessages || injectedMessages.length <= injectedCountRef.current) return;
    const newMessages = injectedMessages.slice(injectedCountRef.current);
    setChat((prev) => [...prev, ...newMessages]);
    injectedCountRef.current = injectedMessages.length;
  }, [injectedMessages]);

  // AI タイムアウト通知（60秒でソフト、120秒でハード）
  useEffect(() => {
    if (!loading && !streaming) return;

    const softId = setTimeout(() => {
      setChat((prev) => [
        ...prev,
        {
          role: "status",
          content: "AI の応答に時間がかかっています。しばらくお待ちください。",
        },
      ]);
    }, 60_000);

    const hardId = setTimeout(() => {
      setChat((prev) => [
        ...prev,
        {
          role: "status",
          content:
            "AI の応答がタイムアウトしました。ページをリロードしてやり直してください。",
        },
      ]);
      setLoading(false);
      setStreaming(false);
      setStatusText(null);
    }, 120_000);

    return () => {
      clearTimeout(softId);
      clearTimeout(hardId);
    };
  }, [loading, streaming]);

  // 自動スクロール
  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [chat, loading, streaming]);

  // 画像選択処理
  function handleImageSelect(file: File) {
    if (!file.type.startsWith("image/")) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("画像サイズは5MB以下にしてください");
      return;
    }
    setPendingImage(file);
    const url = URL.createObjectURL(file);
    setImagePreview(url);
  }

  function clearImage() {
    setPendingImage(null);
    if (imagePreview) {
      URL.revokeObjectURL(imagePreview);
      setImagePreview(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  // ドラッグ&ドロップ
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleImageSelect(file);
  }, []);

  async function uploadImage(file: File): Promise<string | null> {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Upload failed");
      }
      const data = await res.json();
      return data.url;
    } catch (err) {
      console.error("Upload error:", err);
      return null;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if ((!input.trim() && !pendingImage) || !connected) return;

    const displayMsg = selectedElement
      ? `[${selectedElement.componentTree[0]?.name ?? selectedElement.tag}] ${input}`
      : input;

    // 画像がある場合のプレビュー付きメッセージ表示
    const userContent = pendingImage
      ? `${displayMsg}\n[画像添付: ${pendingImage.name}]`
      : displayMsg;

    setChat((prev) => [...prev, { role: "user", content: userContent }]);

    let imageUrl: string | undefined;
    if (pendingImage) {
      setUploading(true);
      const url = await uploadImage(pendingImage);
      setUploading(false);
      if (url) {
        imageUrl = url;
      } else {
        setChat((prev) => [
          ...prev,
          { role: "assistant", content: "Error: 画像のアップロードに失敗しました" },
        ]);
        clearImage();
        return;
      }
    }

    onSend({
      type: "chat",
      message: input || "この画像をサイトに使ってください",
      imageUrl,
      elementContext: selectedElement ?? undefined,
    });
    setInput("");
    clearImage();
    onClearElement();
  }

  function handleUndo() {
    if (!connected || undoing) return;
    setUndoing(true);
    onSend({ type: "undo" });
  }

  function handleHistory() {
    if (!connected) return;
    setHistoryOpen(true);
    setHistoryLoading(true);
    setCommits([]);
    onSend({ type: "history" });
  }

  function handleRevert(hash: string) {
    if (!connected) return;
    setHistoryOpen(false);
    onSend({ type: "revert", hash });
  }

  return (
    <div className="relative flex flex-col h-full bg-gray-900 text-gray-100">
      {/* ヘッダー */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700">
        <div
          className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`}
        />
        <span className="text-sm font-medium flex-1">AI Web Builder</span>
        <button
          onClick={onHelp}
          className="text-gray-400 hover:text-gray-200 text-sm px-2 py-1"
          title="使い方 (?)"
        >
          ?
        </button>
        <button
          onClick={handleHistory}
          disabled={!connected}
          className="flex items-center gap-1 bg-gray-700 text-gray-200 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          title="変更履歴を表示"
        >
          <span>&#128203;</span>
          履歴
        </button>
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
      <div
        ref={scrollRef}
        className={`flex-1 overflow-y-auto p-4 space-y-3 ${dragOver ? "ring-2 ring-blue-400 ring-inset bg-blue-900/20" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {chat.length === 0 && (
          <p className="text-gray-500 text-sm">
            チャットで指示を送ると、AIがサイトを編集します。
            <br />
            Inspect ボタンで要素を選択してから指示すると、ピンポイントで編集できます。
            <br />
            画像をドラッグ&ドロップして添付することもできます。
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
            {streaming && i === chat.length - 1 && msg.role === "assistant" && (
              <span className="inline-block w-1.5 h-4 bg-gray-400 animate-pulse ml-0.5 align-text-bottom" />
            )}
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <div className="animate-pulse">●</div>
            {statusText ?? "考え中..."}
          </div>
        )}
        {uploading && (
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <div className="animate-pulse">●</div>
            画像をアップロード中...
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

      {/* 画像プレビュー */}
      {imagePreview && (
        <div className="mx-3 mb-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg flex items-center gap-2">
          <img
            src={imagePreview}
            alt="添付画像プレビュー"
            className="w-12 h-12 object-cover rounded"
          />
          <span className="text-xs text-gray-400 flex-1 truncate">
            {pendingImage?.name}
          </span>
          <button
            onClick={clearImage}
            className="text-gray-400 hover:text-gray-200 text-sm"
          >
            x
          </button>
        </div>
      )}

      {/* 入力フォーム */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-gray-700">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImageSelect(file);
          }}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!connected}
            className="bg-gray-700 text-gray-300 rounded-lg px-2.5 py-2 text-sm hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            title="画像を添付"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              selectedElement
                ? `${selectedElement.componentTree[0]?.name ?? selectedElement.tag} への指示...`
                : pendingImage
                  ? "画像の使い方を指示..."
                  : "指示を入力..."
            }
            disabled={!connected}
            className="flex-1 bg-gray-800 text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 placeholder-gray-500"
          />
          <button
            type="submit"
            disabled={!connected || (!input.trim() && !pendingImage)}
            className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            送信
          </button>
        </div>
      </form>

      {/* 履歴モーダル */}
      {historyOpen && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl w-[90%] max-w-md max-h-[70%] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <span className="text-sm font-medium">変更履歴</span>
              <button
                onClick={() => setHistoryOpen(false)}
                className="text-gray-400 hover:text-gray-200 text-lg leading-none"
              >
                x
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {historyLoading ? (
                <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
                  <div className="animate-pulse mr-2">●</div>
                  履歴を読み込み中...
                </div>
              ) : commits.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-8">
                  履歴がありません
                </p>
              ) : (
                <ul className="space-y-1">
                  {commits.map((c, i) => (
                    <li
                      key={c.hash}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-700/50 text-sm"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-gray-200 truncate">{c.message}</div>
                        <div className="text-gray-500 text-xs">
                          {new Date(c.date).toLocaleString("ja-JP", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          <span className="ml-2 text-gray-600">{c.hash}</span>
                        </div>
                      </div>
                      {i > 0 && (
                        <button
                          onClick={() => handleRevert(c.hash)}
                          className="shrink-0 bg-gray-600 text-gray-200 rounded px-2 py-1 text-xs hover:bg-gray-500"
                        >
                          戻す
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
