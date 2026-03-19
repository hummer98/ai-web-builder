import { useCallback, useState } from "react";
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
        />
      </div>

      {/* 右: プレビュー */}
      <div className="flex-1">
        <PreviewPanel
          onElementSelected={handleElementSelected}
          onEditText={handleEditText}
          onReplaceImage={handleReplaceImage}
          onDeleteElement={handleDeleteElement}
        />
      </div>
    </div>
  );
}
