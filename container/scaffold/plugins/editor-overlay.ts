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

// ---------- コンテキストメニュー DOM ----------

const TEXT_TAGS = new Set(['H1','H2','H3','H4','H5','H6','P','A','BUTTON','LI','SPAN','LABEL']);
const IMAGE_TAGS = new Set(['IMG']);

const ctxMenu = document.createElement('div');
ctxMenu.id = '__oc_context_menu__';
ctxMenu.style.cssText = 'position:fixed;z-index:100000;background:#1e293b;color:#f1f5f9;border-radius:8px;padding:4px;box-shadow:0 4px 12px rgba(0,0,0,0.5);font-family:system-ui;font-size:14px;display:none;';

const btnStyle = 'display:block;width:100%;text-align:left;padding:8px 16px;background:none;border:none;color:inherit;font:inherit;cursor:pointer;border-radius:4px;';
const btnHoverIn = (e) => { e.currentTarget.style.background = '#334155'; };
const btnHoverOut = (e) => { e.currentTarget.style.background = 'none'; };

function makeBtn(action, label) {
  const btn = document.createElement('button');
  btn.setAttribute('data-action', action);
  btn.style.cssText = btnStyle;
  btn.textContent = label;
  btn.addEventListener('mouseenter', btnHoverIn);
  btn.addEventListener('mouseleave', btnHoverOut);
  return btn;
}

const btnEditText = makeBtn('edit-text', 'テキストを編集');
const btnReplaceImage = makeBtn('replace-image', '画像を差し替え');
const btnDelete = makeBtn('delete', '削除');
const btnChat = makeBtn('chat', 'チャットで指示');

const separator = document.createElement('hr');
separator.style.cssText = 'border:none;border-top:1px solid #334155;margin:4px 0;';

ctxMenu.appendChild(btnEditText);
ctxMenu.appendChild(btnReplaceImage);
ctxMenu.appendChild(btnDelete);
ctxMenu.appendChild(separator);
ctxMenu.appendChild(btnChat);
document.body.appendChild(ctxMenu);

// 非表示ファイル input
const fileInput = document.createElement('input');
fileInput.id = '__oc_file_input__';
fileInput.type = 'file';
fileInput.accept = 'image/*';
fileInput.style.display = 'none';
document.body.appendChild(fileInput);

// テキスト編集 textarea
const editArea = document.createElement('textarea');
editArea.id = '__oc_edit_area__';
editArea.style.cssText = 'position:fixed;z-index:100001;width:300px;resize:vertical;background:#1e293b;color:#f1f5f9;border:2px solid #3b82f6;border-radius:8px;padding:8px;font-family:system-ui;font-size:14px;display:none;outline:none;';
document.body.appendChild(editArea);

let menuTargetEl = null;
let menuMeaningfulEl = null;
let menuContext = null;

// 親ウィンドウからのメッセージ受信
window.addEventListener('message', (e) => {
  if (e.data?.type === 'set-inspect-mode') {
    inspectMode = e.data.enabled;
    if (!inspectMode) {
      overlay.style.display = 'none';
      tooltip.style.display = 'none';
      closeContextMenu();
      closeEditArea();
      clearSemanticLabels();
    } else {
      showSemanticLabels();
    }
  }
});

// ホバーハイライト
document.addEventListener('mousemove', (e) => {
  if (!inspectMode) return;
  // メニューや編集欄が開いている間はハイライト更新しない
  if (ctxMenu.style.display !== 'none' || editArea.style.display !== 'none') return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || el === overlay || el === tooltip || el.id?.startsWith('__oc_') || el.closest('[id^="__oc_"]')) return;

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

function buildContext(el) {
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
  return {
    ocId,
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || '').slice(0, 100).trim(),
    classes: el.className || '',
    componentTree,
  };
}

function showContextMenu(x, y, meaningfulEl, rawEl) {
  menuTargetEl = rawEl;
  menuMeaningfulEl = meaningfulEl;
  menuContext = buildContext(rawEl);

  const tag = meaningfulEl.tagName;
  btnEditText.style.display = TEXT_TAGS.has(tag) ? 'block' : 'none';
  btnReplaceImage.style.display = IMAGE_TAGS.has(tag) ? 'block' : 'none';

  ctxMenu.style.display = 'block';
  // 一旦表示して寸法を取得してから位置調整
  const menuRect = ctxMenu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = x + menuRect.width > vw ? vw - menuRect.width - 8 : x;
  const top = y + menuRect.height > vh ? vh - menuRect.height - 8 : y;
  ctxMenu.style.left = Math.max(0, left) + 'px';
  ctxMenu.style.top = Math.max(0, top) + 'px';
}

function closeContextMenu() {
  ctxMenu.style.display = 'none';
  menuTargetEl = null;
  menuMeaningfulEl = null;
  menuContext = null;
}

function closeEditArea() {
  editArea.style.display = 'none';
}

// クリックでコンテキストメニュー表示
document.addEventListener('click', (e) => {
  if (!inspectMode) return;

  // コンテキストメニュー自体のクリックは無視
  if (e.target.closest('#__oc_context_menu__')) return;

  // テキスト編集中はそちらのハンドラーに任せる
  if (editArea.style.display !== 'none') return;

  e.preventDefault();
  e.stopPropagation();

  // メニューが開いていて外をクリックした場合は閉じるだけ
  if (ctxMenu.style.display !== 'none') {
    closeContextMenu();
    return;
  }

  const el = highlightEl;
  if (!el) return;

  const meaningful = findMeaningfulElement(el);
  showContextMenu(e.clientX, e.clientY, meaningful, el);
}, true);

// Escape でメニュー / 編集欄を閉じる
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (editArea.style.display !== 'none') {
      closeEditArea();
    } else if (ctxMenu.style.display !== 'none') {
      closeContextMenu();
    }
  }
});

// ---------- アクション: テキストを編集 ----------
btnEditText.addEventListener('click', (e) => {
  e.stopPropagation();
  const ctx = menuContext;
  const meaningful = menuMeaningfulEl;
  const menuLeft = ctxMenu.style.left;
  const menuTop = ctxMenu.style.top;
  closeContextMenu();
  if (!ctx || !meaningful) return;

  editArea.value = (meaningful.textContent || '').trim();
  editArea.style.left = menuLeft;
  editArea.style.top = menuTop;
  editArea.style.display = 'block';
  editArea.style.height = 'auto';
  editArea.style.height = Math.max(60, editArea.scrollHeight) + 'px';
  editArea.focus();

  const commit = () => {
    const newText = editArea.value;
    closeEditArea();
    cleanup();
    window.parent.postMessage({ type: 'edit-text', context: ctx, newText }, '*');
  };
  const cancel = () => {
    closeEditArea();
    cleanup();
  };
  const onKey = (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      commit();
    } else if (ev.key === 'Escape') {
      cancel();
    }
  };
  const onClickOutside = (ev) => {
    if (ev.target !== editArea) {
      commit();
    }
  };
  const cleanup = () => {
    editArea.removeEventListener('keydown', onKey);
    document.removeEventListener('click', onClickOutside, true);
  };
  editArea.addEventListener('keydown', onKey);
  // 次のイベントループで登録（現在のクリックで発火しないように）
  setTimeout(() => {
    document.addEventListener('click', onClickOutside, true);
  }, 0);
});

// ---------- アクション: 画像を差し替え ----------
btnReplaceImage.addEventListener('click', (e) => {
  e.stopPropagation();
  const ctx = menuContext;
  closeContextMenu();
  if (!ctx) return;

  fileInput.value = '';
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const fileData = btoa(binary);
    window.parent.postMessage({ type: 'replace-image', context: ctx, fileName: file.name, fileData }, '*');
  };
  fileInput.click();
});

// ---------- アクション: 削除 ----------
btnDelete.addEventListener('click', (e) => {
  e.stopPropagation();
  const ctx = menuContext;
  closeContextMenu();
  if (!ctx) return;
  window.parent.postMessage({ type: 'delete-element', context: ctx }, '*');
});

// ---------- アクション: チャットで指示 ----------
btnChat.addEventListener('click', (e) => {
  e.stopPropagation();
  const ctx = menuContext;
  closeContextMenu();
  if (!ctx) return;
  window.parent.postMessage({ type: 'element-selected', context: ctx }, '*');
});

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
