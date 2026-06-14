import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import type { WSMessage, WSSendable } from "../hooks/useWebSocket";
import type { ElementContext } from "./PreviewPanel";
import QuestionCard, { type PendingQuestion } from "./QuestionCard";

export type ChatMessage = {
  role: "user" | "assistant" | "status";
  content: string;
};

type Props = {
  connected: boolean;
  messages: WSMessage[];
  onSend: (msg: WSSendable) => void;
  selectedElement: ElementContext | null;
  onClearElement: () => void;
  injectedMessages?: ChatMessage[];
  disabledReason?: string | null;
};

export default function ChatPanel({
  connected,
  messages,
  onSend,
  selectedElement,
  onClearElement,
  injectedMessages,
  disabledReason,
}: Props) {
  const guarded = !!disabledReason;
  const [input, setInput] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(
    null
  );
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const processedRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // WS メッセージをチャット履歴に変換
  useEffect(() => {
    const start = processedRef.current;
    if (start >= messages.length) return;

    for (let i = start; i < messages.length; i++) {
      const msg = messages[i];

      switch (msg.type) {
        case "status":
          // 'deploying' は App 側で扱うので無視
          if (msg.message === "deploying") break;
          setLoading(true);
          setStatusText(msg.message ?? "thinking");
          break;

        case "stream":
          // ストリーミング中: 最後の assistant メッセージに delta を追記
          setLoading(false);
          setStreaming(true);
          setStatusText(null);
          setChat((prev) => {
            const delta = msg.delta;
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

        case "error":
          setChat((prev) => [
            ...prev,
            { role: "assistant", content: `Error: ${msg.message}` },
          ]);
          setLoading(false);
          setStreaming(false);
          setStatusText(null);
          break;

        case "question":
          // opencode が選択肢を出した。回答するまで agent はブロックしているので
          // loading/streaming を止め (タイムアウト通知を抑制)、カードを表示する。
          setLoading(false);
          setStreaming(false);
          setStatusText(null);
          setPendingQuestion({
            requestId: msg.requestId,
            questions: msg.questions,
          });
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

  // AI タイムアウト通知（3分でソフト、5分でハード）
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
    }, 180_000);

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
    }, 300_000);

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

  function handleAnswer(requestId: string, answers: string[][]) {
    // 選んだ内容をチャットに記録してから回答を送る
    const summary = answers.map((a) => a.join("・")).filter(Boolean).join(" / ");
    if (summary) {
      setChat((prev) => [...prev, { role: "user", content: summary }]);
    }
    setPendingQuestion(null);
    // 回答後は再び agent が動くので考え中表示に戻す
    setLoading(true);
    setStatusText("考え中...");
    onSend({ type: "answer", requestId, answers });
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

  return (
    <div className="relative flex flex-col h-full bg-gray-900 text-gray-100">
      {/* ヘッダー: 接続インジケータ + タイトルのみ */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700">
        <div
          className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`}
        />
        <span className="text-sm font-medium flex-1">AI Web Builder</span>
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
            className={`text-sm ${
              msg.role === "user"
                ? "whitespace-pre-wrap bg-blue-600/20 text-blue-100 rounded-lg px-3 py-2 ml-8"
                : msg.role === "status"
                  ? "whitespace-pre-wrap bg-green-600/20 text-green-200 rounded-lg px-3 py-2 text-center"
                  : "bg-gray-800 text-gray-200 rounded-lg px-3 py-2 mr-8"
            }`}
          >
            {msg.role === "assistant" ? (
              <div className="markdown-body">
                <ReactMarkdown
                  remarkPlugins={[remarkBreaks]}
                  components={{
                    pre: ({ children }) => (
                      <pre className="bg-gray-900 rounded p-2 my-2 overflow-x-auto text-xs">{children}</pre>
                    ),
                    code: ({ children, className }) => {
                      const isBlock = className?.startsWith("language-");
                      return isBlock ? (
                        <code className={className}>{children}</code>
                      ) : (
                        <code className="bg-gray-900 px-1 py-0.5 rounded text-xs">{children}</code>
                      );
                    },
                    h1: ({ children }) => <h1 className="text-lg font-bold mt-3 mb-1">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-base font-bold mt-3 mb-1">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-sm font-bold mt-2 mb-1">{children}</h3>,
                    ul: ({ children }) => <ul className="list-disc pl-4 my-1">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal pl-4 my-1">{children}</ol>,
                    li: ({ children }) => <li className="my-0.5">{children}</li>,
                    p: ({ children }) => <p className="my-1">{children}</p>,
                    a: ({ href, children }) => (
                      <a href={href} className="text-blue-400 underline" target="_blank" rel="noreferrer">{children}</a>
                    ),
                    strong: ({ children }) => <strong className="font-bold">{children}</strong>,
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-2 border-gray-600 pl-2 my-1 text-gray-400">{children}</blockquote>
                    ),
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
                {streaming && i === chat.length - 1 && (
                  <span className="inline-block w-1.5 h-4 bg-gray-400 animate-pulse ml-0.5 align-text-bottom" />
                )}
              </div>
            ) : (
              <>
                {msg.content}
              </>
            )}
          </div>
        ))}
        {pendingQuestion && (
          <QuestionCard pending={pendingQuestion} onAnswer={handleAnswer} />
        )}
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
      <form
        onSubmit={handleSubmit}
        className={`p-3 border-t border-gray-700 ${guarded ? "opacity-50" : ""}`}
      >
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
            disabled={!connected || guarded}
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
              guarded
                ? (disabledReason ?? "")
                : selectedElement
                  ? `${selectedElement.componentTree[0]?.name ?? selectedElement.tag} への指示...`
                  : pendingImage
                    ? "画像の使い方を指示..."
                    : "指示を入力..."
            }
            disabled={!connected || guarded}
            className="flex-1 bg-gray-800 text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 placeholder-gray-500"
          />
          <button
            type="submit"
            disabled={!connected || guarded || (!input.trim() && !pendingImage)}
            className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            送信
          </button>
        </div>
      </form>
    </div>
  );
}
