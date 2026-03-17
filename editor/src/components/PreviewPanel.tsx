import { useState } from "react";

const PREVIEW_URL = "http://localhost:5173";

const SIZES = [
  { label: "Desktop", width: "100%" },
  { label: "Tablet", width: "768px" },
  { label: "Mobile", width: "375px" },
] as const;

export default function PreviewPanel() {
  const [sizeIndex, setSizeIndex] = useState(0);
  const size = SIZES[sizeIndex];

  return (
    <div className="flex flex-col h-full bg-gray-800">
      {/* ツールバー */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-700 bg-gray-900">
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
          onClick={() => {
            const iframe = document.getElementById(
              "preview-iframe"
            ) as HTMLIFrameElement;
            iframe?.contentWindow?.location.reload();
          }}
          className="ml-auto text-xs px-3 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
        >
          Reload
        </button>
      </div>

      {/* Iframe プレビュー */}
      <div className="flex-1 flex items-start justify-center overflow-auto p-4 bg-gray-600/30">
        <iframe
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
