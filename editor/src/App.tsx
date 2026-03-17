import { useCallback, useState } from "react";
import ChatPanel from "./components/ChatPanel";
import PreviewPanel from "./components/PreviewPanel";
import type { ElementContext } from "./components/PreviewPanel";
import { useWebSocket } from "./hooks/useWebSocket";

const WS_URL = `ws://${window.location.hostname}:8080/ws`;

export default function App() {
  const { connected, messages, send } = useWebSocket(WS_URL);
  const [selectedElement, setSelectedElement] = useState<ElementContext | null>(
    null
  );

  const handleElementSelected = useCallback((context: ElementContext) => {
    setSelectedElement(context);
  }, []);

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
        />
      </div>

      {/* 右: プレビュー */}
      <div className="flex-1">
        <PreviewPanel onElementSelected={handleElementSelected} />
      </div>
    </div>
  );
}
