import type { Plugin } from "vite";

/**
 * Vite plugin: Editor Overlay
 * Iframe 内にインスペクトモード + セマンティックラベルオーバーレイを注入する。
 * 開発時のみ動作。
 */
export default function editorOverlayPlugin(): Plugin {
  return {
    name: "editor-overlay",
    transformIndexHtml(html) {
      return html.replace(
        "</body>",
        `<script type="module">${OVERLAY_SCRIPT}</script></body>`
      );
    },
  };
}

const SEMANTIC_LABELS: Record<string, { label: string; color: string }> = {
  HEADER: { label: "ヘッダー", color: "#3b82f6" },
  NAV: { label: "メニュー", color: "#22c55e" },
  MAIN: { label: "メインコンテンツ", color: "#a855f7" },
  SECTION: { label: "セクション", color: "#6b7280" },
  ARTICLE: { label: "記事", color: "#f97316" },
  ASIDE: { label: "サイドバー", color: "#eab308" },
  FOOTER: { label: "フッター", color: "#3b82f6" },
  FORM: { label: "フォーム", color: "#ef4444" },
};

const TAG_LABELS: Record<string, string> = {
  HEADER: "ヘッダー",
  NAV: "メニュー",
  MAIN: "メインコンテンツ",
  SECTION: "セクション",
  ARTICLE: "記事",
  ASIDE: "サイドバー",
  FOOTER: "フッター",
  FORM: "フォーム",
  H1: "見出し", H2: "見出し", H3: "見出し", H4: "見出し", H5: "見出し", H6: "見出し",
  P: "本文",
  A: "リンク",
  BUTTON: "ボタン",
  IMG: "画像",
  VIDEO: "動画",
  IFRAME: "埋め込み",
  UL: "リスト", OL: "リスト",
  LI: "リスト項目",
  TABLE: "表",
  INPUT: "入力欄", TEXTAREA: "入力欄", SELECT: "入力欄",
};

// テンプレートリテラル内のスクリプト
const OVERLAY_SCRIPT = `
const LABELS = ${JSON.stringify(SEMANTIC_LABELS)};
const TAG_LABELS = ${JSON.stringify(TAG_LABELS)};

let inspectMode = false;
let highlightEl = null;
let labelEls = [];

// 意味のある親要素を探す
function findMeaningfulElement(el) {
  const GENERIC_TAGS = new Set(['SPAN', 'DIV', 'I', 'EM', 'STRONG', 'B', 'SMALL', 'LABEL', 'ABBR', 'CITE', 'CODE', 'DATA', 'DFN', 'KBD', 'MARK', 'Q', 'S', 'SAMP', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'WBR']);
  if (!GENERIC_TAGS.has(el.tagName)) return el;
  let current = el.parentElement;
  while (current && current !== document.body) {
    if (TAG_LABELS[current.tagName]) return current;
    current = current.parentElement;
  }
  return el;
}

// ハイライトオーバーレイ要素を作成
const overlay = document.createElement('div');
overlay.id = '__oc_highlight__';
overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:99998;border:2px solid #3b82f6;background:rgba(59,130,246,0.1);transition:all 0.1s ease;display:none;';
document.body.appendChild(overlay);

// ツールチップ
const tooltip = document.createElement('div');
tooltip.id = '__oc_tooltip__';
tooltip.style.cssText = 'position:fixed;pointer-events:none;z-index:99999;background:#1e293b;color:#f1f5f9;font-size:11px;padding:2px 8px;border-radius:4px;white-space:nowrap;display:none;font-family:system-ui;';
document.body.appendChild(tooltip);

// 親ウィンドウからのメッセージ受信
window.addEventListener('message', (e) => {
  if (e.data?.type === 'set-inspect-mode') {
    inspectMode = e.data.enabled;
    if (!inspectMode) {
      overlay.style.display = 'none';
      tooltip.style.display = 'none';
      clearSemanticLabels();
    } else {
      showSemanticLabels();
    }
  }
});

// ホバーハイライト
document.addEventListener('mousemove', (e) => {
  if (!inspectMode) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || el === overlay || el === tooltip || el.id?.startsWith('__oc_')) return;

  highlightEl = el;
  const meaningful = findMeaningfulElement(el);
  const rect = meaningful.getBoundingClientRect();
  overlay.style.display = 'block';
  overlay.style.left = rect.left + 'px';
  overlay.style.top = rect.top + 'px';
  overlay.style.width = rect.width + 'px';
  overlay.style.height = rect.height + 'px';

  // ツールチップ: 「テキスト」 ラベル
  const label = TAG_LABELS[meaningful.tagName] || '';
  let text = '';
  if (meaningful.tagName === 'IMG') {
    text = meaningful.getAttribute('alt') || '';
  } else {
    text = (meaningful.textContent || '').trim().slice(0, 20);
  }

  if (text && label) {
    tooltip.textContent = '\\u300c' + text + (text.length >= 20 ? '...' : '') + '\\u300d ' + label;
  } else if (label) {
    tooltip.textContent = label;
  } else {
    tooltip.textContent = meaningful.tagName.toLowerCase();
  }
  tooltip.style.display = 'block';
  tooltip.style.left = rect.left + 'px';
  tooltip.style.top = Math.max(0, rect.top - 24) + 'px';
});

// クリックでコンテキスト送信
document.addEventListener('click', (e) => {
  if (!inspectMode) return;
  e.preventDefault();
  e.stopPropagation();

  const el = highlightEl;
  if (!el) return;

  // コンポーネント階層を構築
  const componentTree = [];
  let current = el;
  while (current && current !== document.body) {
    const comp = current.getAttribute('data-oc-component');
    const ocId = current.getAttribute('data-oc-id');
    if (comp && ocId) {
      const file = ocId.split(':')[0];
      componentTree.unshift({ name: comp, file });
    }
    current = current.parentElement;
  }

  const ocId = el.getAttribute('data-oc-id') || findMeaningfulElement(el).getAttribute('data-oc-id') || '';
  const context = {
    ocId,
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || '').slice(0, 100).trim(),
    classes: el.className || '',
    componentTree,
  };

  // 親ウィンドウ（エディター）に送信
  window.parent.postMessage({
    type: 'element-selected',
    context,
  }, '*');
}, true);

// セマンティックラベル表示
function showSemanticLabels() {
  clearSemanticLabels();
  for (const [tag, info] of Object.entries(LABELS)) {
    const elements = document.querySelectorAll(tag.toLowerCase());
    elements.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      // コンポーネント名があれば上書き
      let labelText = info.label;
      const compName = el.getAttribute('data-oc-component');
      if (compName && tag === 'SECTION') {
        labelText = compName;
      }

      const label = document.createElement('div');
      label.className = '__oc_semantic_label__';
      label.textContent = labelText;
      label.style.cssText = 'position:absolute;pointer-events:none;z-index:99997;font-size:10px;padding:1px 6px;border-radius:2px;font-family:system-ui;color:white;background:' + info.color + ';opacity:0.8;';
      label.style.left = (rect.left + window.scrollX) + 'px';
      label.style.top = (rect.top + window.scrollY) + 'px';

      // 枠線
      const border = document.createElement('div');
      border.className = '__oc_semantic_label__';
      border.style.cssText = 'position:absolute;pointer-events:none;z-index:99996;border:1px dashed ' + info.color + ';opacity:0.4;';
      border.style.left = (rect.left + window.scrollX) + 'px';
      border.style.top = (rect.top + window.scrollY) + 'px';
      border.style.width = rect.width + 'px';
      border.style.height = rect.height + 'px';

      document.body.appendChild(label);
      document.body.appendChild(border);
      labelEls.push(label, border);
    });
  }
}

function clearSemanticLabels() {
  labelEls.forEach(el => el.remove());
  labelEls = [];
}

// 初期状態: インスペクトモードOFF
console.log('[editor-overlay] loaded');
`;
