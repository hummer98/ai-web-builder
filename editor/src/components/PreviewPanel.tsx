import { useCallback, useEffect, useRef, useState } from "react";

const PREVIEW_URL =
  import.meta.env.DEV
    ? "http://localhost:5173"
    : `${window.location.origin}/preview/`;

const SIZES = [
  { label: "Desktop", width: "100%" },
  { label: "Tablet", width: "768px" },
  { label: "Mobile", width: "375px" },
] as const;

export type ElementContext = {
  ocId: string;
  tag: string;
  text: string;
  classes: string;
  componentTree: { name: string; file: string }[];
};

type Props = {
  onElementSelected?: (context: ElementContext) => void;
  onEditText?: (context: ElementContext, newText: string) => void;
  onReplaceImage?: (context: ElementContext, fileName: string, fileData: string) => void;
  onDeleteElement?: (context: ElementContext) => void;
  inspectRequested?: number; // increment to toggle inspect from parent
};

export default function PreviewPanel({ onElementSelected, onEditText, onReplaceImage, onDeleteElement, inspectRequested }: Props) {
  const [sizeIndex, setSizeIndex] = useState(0);
  const [inspectMode, setInspectMode] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const size = SIZES[sizeIndex];

  // Iframe からの postMessage を受信
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      const data = e.data;
      if (!data?.type) return;

      switch (data.type) {
        case "element-selected":
          onElementSelected?.(data.context);
          break;
        case "edit-text":
          onEditText?.(data.context, data.newText);
          break;
        case "replace-image":
          onReplaceImage?.(data.context, data.fileName, data.fileData);
          break;
        case "delete-element":
          onDeleteElement?.(data.context);
          break;
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onElementSelected, onEditText, onReplaceImage, onDeleteElement]);

  // インスペクトモードの切り替えを Iframe に通知
  const toggleInspect = useCallback(() => {
    const next = !inspectMode;
    setInspectMode(next);
    iframeRef.current?.contentWindow?.postMessage(
      { type: "set-inspect-mode", enabled: next },
      "*"
    );
  }, [inspectMode]);

  // 親からの inspect トグル要求
  useEffect(() => {
    if (inspectRequested && inspectRequested > 0) {
      toggleInspect();
    }
  }, [inspectRequested]);

  return (
    <div className="flex flex-col h-full bg-gray-800">
      {/* ツールバー */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-700 bg-gray-900">
        <button
          onClick={toggleInspect}
          className={`text-xs px-3 py-1 rounded font-medium ${
            inspectMode
              ? "bg-orange-500 text-white"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
        >
          {inspectMode ? "Inspect ON" : "Inspect"}
          <kbd className="hidden md:inline ml-1 text-[10px] opacity-60 font-mono">⌘I</kbd>
        </button>
        <div className="w-px h-4 bg-gray-600" />
        {SIZES.map((s, i) => (
          <button
            key={s.label}
            onClick={() => setSizeIndex(i)}
            className={`text-xs px-3 py-1 rounded ${
              i === sizeIndex
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {s.label}
          </button>
        ))}
        <button
          onClick={() => iframeRef.current?.contentWindow?.location.reload()}
          className="ml-auto text-xs px-3 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
        >
          Reload
        </button>
      </div>

      {/* Iframe プレビュー */}
      <div className="flex-1 flex items-start justify-center overflow-auto p-4 bg-gray-600/30">
        <iframe
          ref={iframeRef}
          id="preview-iframe"
          src={PREVIEW_URL}
          style={{ width: size.width, height: "100%" }}
          className="bg-white rounded shadow-lg transition-all duration-300 max-w-full"
          title="Site Preview"
        />
      </div>
    </div>
  );
}
