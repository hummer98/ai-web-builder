/**
 * AI 応答テキストからコミットメッセージ用の要約を作成（50文字程度）
 */
export function truncateForCommit(text: string): string {
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) ?? "AI edit";
  if (firstLine.length <= 50) return firstLine;
  return firstLine.slice(0, 47) + "...";
}

/**
 * Source Locator のコンテキスト付きプロンプトを構築
 */
export function buildPrompt(data: {
  message: string;
  imageUrl?: string;
  elementContext?: {
    ocId?: string;
    tag?: string;
    text?: string;
    classes?: string;
    componentTree?: { name: string; file: string }[];
  };
}): string {
  const parts: string[] = [];

  if (data.elementContext?.ocId) {
    const ctx = data.elementContext;
    parts.push("## 対象要素");
    if (ctx.ocId) parts.push(`- ID: ${ctx.ocId}`);
    if (ctx.tag) parts.push(`- タグ: ${ctx.tag}`);
    if (ctx.text) parts.push(`- テキスト: "${ctx.text}"`);
    if (ctx.classes) parts.push(`- クラス: ${ctx.classes}`);
    if (ctx.componentTree?.length) {
      parts.push(
        `- コンポーネント: ${ctx.componentTree.map((c) => c.name).join(" > ")}`
      );
      parts.push(`- ファイル: ${ctx.componentTree[0].file}`);
    }
    parts.push("");
  }

  if (data.imageUrl) {
    parts.push("## 添付画像");
    parts.push(`- URL: ${data.imageUrl}`);
    parts.push("この画像をサイトで使用してください。");
    parts.push("");
  }

  parts.push("## ユーザーの指示");
  parts.push(data.message);

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// 自然言語コマンド認識
// ---------------------------------------------------------------------------

export type Command =
  | { type: "undo" }
  | { type: "deploy" }
  | { type: "create"; siteName: string }
  | { type: "import"; repoName: string }
  | { type: "help" }
  | { type: "reset" };

/**
 * ユーザーのメッセージが既知のコマンドに該当するかを正規表現で判定。
 * 曖昧な場合は null を返して OpenCode に委ねる。
 */
export function detectCommand(message: string): Command | null {
  const trimmed = message.trim();

  // undo
  if (/^(元に戻して|戻して|取り消して|やり直して|undo)$/i.test(trimmed)) {
    return { type: "undo" };
  }
  if (/^(さっきの(変更(を)?)?)?元に戻し(て|たい)$/i.test(trimmed)) {
    return { type: "undo" };
  }
  if (/^(さっきの(変更(を)?)?)?(取り消し|やり直し)(て|たい)$/i.test(trimmed)) {
    return { type: "undo" };
  }

  // help
  if (/^(使い方|ヘルプ|help|\?|どうやって使う|使い方を教えて|使い方は？)$/i.test(trimmed)) {
    return { type: "help" };
  }

  // reset
  if (/^(リセットして|初期化して|reset|リセット)$/i.test(trimmed)) {
    return { type: "reset" };
  }

  // deploy
  if (/^(公開して|公開したい|デプロイして|デプロイしたい|publish|deploy)$/i.test(trimmed)) {
    return { type: "deploy" };
  }
  if (/^サイトを(公開|デプロイ)して$/i.test(trimmed)) {
    return { type: "deploy" };
  }

  // create-site
  {
    const m = /^(.+)のサイトを(作って|作りたい)$/.exec(trimmed);
    if (m) return { type: "create", siteName: m[1] };
  }

  // import-repo
  {
    const m = /^(.+)を(編集したい|開いて|編集して)$/.exec(trimmed);
    if (m) return { type: "import", repoName: m[1] };
  }

  return null;
}

// ---------------------------------------------------------------------------
// ヘルプテキスト
// ---------------------------------------------------------------------------

export const HELP_TEXT = `\
💬 チャットで指示
テキスト入力して送信 → AI がサイトを編集します
例:「ヘッダーを青くして」「お問い合わせフォームを追加して」

🔍 要素を選んで編集
「Inspect」→ 要素をクリック → メニューから操作
・テキストを編集: その場で書き換え
・画像を差し替え: 新しい画像を選択
・削除: 要素を削除
・チャットで指示: より詳しい指示を入力

📎 画像を添付
📎ボタン or ドラッグ&ドロップで画像を添付して送信

↩ 元に戻す
「元に戻す」ボタン or チャットで「元に戻して」

📋 履歴
「履歴」ボタンで変更一覧を表示、任意の状態に復元

🚀 公開
「公開」ボタン or チャットで「公開して」

❓ ヘルプ
? キー or チャットで「使い方」と入力`;
