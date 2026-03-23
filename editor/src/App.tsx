import { useCallback, useEffect, useRef, useState } from "react";
import ChatPanel from "./components/ChatPanel";
import type { ChatMessage } from "./components/ChatPanel";
import PreviewPanel from "./components/PreviewPanel";
import type { ElementContext } from "./components/PreviewPanel";
import { useWebSocket } from "./hooks/useWebSocket";

const WS_URL = import.meta.env.DEV
  ? `ws://${window.location.hostname}:8080/ws`
  : `wss://${window.location.host}/ws`;

export default function App() {
  const { connected, messages, send } = useWebSocket(WS_URL);
  const [selectedElement, setSelectedElement] = useState<ElementContext | null>(
    null
  );
  const [injectedMessages, setInjectedMessages] = useState<ChatMessage[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [inspectRequested, setInspectRequested] = useState(0);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const prevMessagesLen = useRef(0);

  // ? キーでヘルプを開く、Escape で閉じる
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setHelpOpen(false);
        return;
      }
      if (e.key === "?") {
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        setHelpOpen(true);
      }
      // ⌘I (Mac) / Ctrl+I (Windows) で Inspect トグル
      if (e.key === "i" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setInspectRequested((n) => n + 1);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // AI 応答完了時にプレビューを自動 reload
  useEffect(() => {
    if (messages.length > prevMessagesLen.current) {
      const newMessages = messages.slice(prevMessagesLen.current);
      const shouldReload = newMessages.some(
        (m) => m.type === "response" || m.type === "stream-end" || m.type === "git" || m.type === "file-changed"
      );
      if (shouldReload) {
        setPreviewRefreshKey((n) => n + 1);
      }
    }
    prevMessagesLen.current = messages.length;
  }, [messages]);

  const injectMessage = useCallback((role: ChatMessage["role"], content: string) => {
    setInjectedMessages((prev) => [...prev, { role, content }]);
  }, []);

  const handleElementSelected = useCallback((context: ElementContext) => {
    setSelectedElement(context);
  }, []);

  const handleEditText = useCallback(
    (context: ElementContext, newText: string) => {
      const label = context.componentTree[0]?.name ?? context.tag;
      injectMessage("user", `[${label}] テキストを「${newText}」に変更`);
      send({
        type: "chat",
        message: `この要素のテキストを「${newText}」に変更して`,
        elementContext: context,
      });
    },
    [send, injectMessage],
  );

  const handleReplaceImage = useCallback(
    async (context: ElementContext, fileName: string, fileData: string) => {
      const label = context.componentTree[0]?.name ?? context.tag;
      injectMessage("user", `[${label}] 画像を差し替え: ${fileName}`);

      // Base64 → Blob → File
      try {
        const res = await fetch(fileData);
        const blob = await res.blob();
        const file = new File([blob], fileName, { type: blob.type });

        // /api/upload にアップロード
        const formData = new FormData();
        formData.append("file", file);
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        if (!uploadRes.ok) {
          const err = await uploadRes.json();
          throw new Error(err.error ?? "Upload failed");
        }
        const data = await uploadRes.json();
        const imageUrl = data.url as string;

        send({
          type: "chat",
          message: "この要素の画像を差し替えて",
          imageUrl,
          elementContext: context,
        });
      } catch (err) {
        console.error("Image replace upload error:", err);
        injectMessage("assistant", "Error: 画像のアップロードに失敗しました");
      }
    },
    [send, injectMessage],
  );

  const handleDeleteElement = useCallback(
    (context: ElementContext) => {
      const label = context.componentTree[0]?.name ?? context.tag;
      injectMessage("user", `[${label}] この要素を削除`);
      send({
        type: "chat",
        message: "この要素を削除して",
        elementContext: context,
      });
    },
    [send, injectMessage],
  );

  return (
    <div className="h-screen flex bg-gray-900">
      {/* 左: チャットパネル */}
      <div className="w-96 flex-shrink-0 border-r border-gray-700">
        <ChatPanel
          connected={connected}
          messages={messages}
          onSend={send}
          selectedElement={selectedElement}
          onClearElement={() => setSelectedElement(null)}
          injectedMessages={injectedMessages}
          onHelp={() => setHelpOpen(true)}
        />
      </div>

      {/* 右: プレビュー */}
      <div className="flex-1">
        <PreviewPanel
          onElementSelected={handleElementSelected}
          onEditText={handleEditText}
          onReplaceImage={handleReplaceImage}
          onDeleteElement={handleDeleteElement}
          inspectRequested={inspectRequested}
          refreshKey={previewRefreshKey}
        />
      </div>

      {/* ヘルプモーダル */}
      {helpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="bg-gray-800 text-gray-100 rounded-xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">使い方</h2>
              <button
                onClick={() => setHelpOpen(false)}
                className="text-gray-400 hover:text-white text-lg leading-none"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <div>
                <div className="flex items-center gap-2 font-medium mb-1">
                  <span className="text-lg">💬</span>
                  チャットで指示
                </div>
                <p className="text-gray-400 ml-7">
                  テキスト入力して送信 → AI がサイトを編集します
                  <br />
                  例:「ヘッダーを青くして」「お問い合わせフォームを追加して」
                </p>
              </div>

              <div>
                <div className="flex items-center gap-2 font-medium mb-1">
                  <span className="text-lg">🔍</span>
                  要素を選んで編集
                </div>
                <p className="text-gray-400 ml-7">
                  「Inspect」(⌘I) → 要素をクリック → メニューから操作
                  <br />
                  ・テキストを編集: その場で書き換え
                  <br />
                  ・画像を差し替え: 新しい画像を選択
                  <br />
                  ・削除: 要素を削除
                  <br />
                  ・チャットで指示: より詳しい指示を入力
                </p>
              </div>

              <div>
                <div className="flex items-center gap-2 font-medium mb-1">
                  <span className="text-lg">📎</span>
                  画像を添付
                </div>
                <p className="text-gray-400 ml-7">
                  📎ボタン or ドラッグ&ドロップで画像を添付して送信
                </p>
              </div>

              <div>
                <div className="flex items-center gap-2 font-medium mb-1">
                  <span className="text-lg">↩</span>
                  元に戻す
                </div>
                <p className="text-gray-400 ml-7">
                  「元に戻す」ボタン or チャットで「元に戻して」
                </p>
              </div>

              <div>
                <div className="flex items-center gap-2 font-medium mb-1">
                  <span className="text-lg">📋</span>
                  履歴
                </div>
                <p className="text-gray-400 ml-7">
                  「履歴」ボタンで変更一覧を表示、任意の状態に復元
                </p>
              </div>

              <div>
                <div className="flex items-center gap-2 font-medium mb-1">
                  <span className="text-lg">🚀</span>
                  公開
                </div>
                <p className="text-gray-400 ml-7">
                  「公開」ボタン or チャットで「公開して」
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
