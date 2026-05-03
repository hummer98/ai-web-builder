/**
 * SITE_BRIEF.md (Markdown blob) と編集フォームの 5 フィールドを相互変換する。
 *
 * 真実の源は workspace/SITE_BRIEF.md (Markdown)。この変換ロジックは UI の利便性のために
 * 「## 見出し」をフォーム項目にマッピングするだけで、AI 側は plain Markdown として読む。
 *
 * - parse: Markdown → SiteBriefFields
 *   セクション見出しをキーに、見出しの次行から次の見出しまでの本文を値として抽出
 * - serialize: SiteBriefFields → Markdown
 *   テンプレと同じ順序・見出しで再構築
 */

export type SiteBriefFields = {
  /** 1 行モーダルでも編集される最重要フィールド */
  whatKind: string;
  location: string;
  audience: string;
  tone: string;
  notes: string;
};

export const EMPTY_FIELDS: SiteBriefFields = {
  whatKind: "",
  location: "",
  audience: "",
  tone: "",
  notes: "",
};

const HEADINGS: Array<[keyof SiteBriefFields, string]> = [
  ["whatKind", "何のサイト"],
  ["location", "場所"],
  ["audience", "来てほしい人"],
  ["tone", "雰囲気・トーン"],
  ["notes", "大事なメモ"],
];

const HEADING_TITLES: Record<keyof SiteBriefFields, string> = Object.fromEntries(
  HEADINGS
) as Record<keyof SiteBriefFields, string>;

/**
 * Markdown を 5 フィールドに分解する。
 * 認識しない見出しの本文は失う (notes 等にマージしない) — 単純に既知見出しのみ救う方針。
 */
export function parseSiteBrief(markdown: string): SiteBriefFields {
  const fields: SiteBriefFields = { ...EMPTY_FIELDS };
  const lines = markdown.split("\n");

  let currentKey: keyof SiteBriefFields | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentKey) {
      // 末尾の空行を削る
      while (buffer.length > 0 && buffer[buffer.length - 1].trim() === "") {
        buffer.pop();
      }
      fields[currentKey] = buffer.join("\n");
    }
    buffer = [];
  };

  const headingMap = new Map<string, keyof SiteBriefFields>();
  for (const [key, title] of HEADINGS) {
    headingMap.set(title, key);
  }

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      flush();
      const title = headingMatch[1].trim();
      currentKey = headingMap.get(title) ?? null;
      continue;
    }
    if (currentKey) {
      buffer.push(line);
    }
  }
  flush();

  return fields;
}

/**
 * 5 フィールドを SITE_BRIEF.md 形式の Markdown に組み立てる。
 * 空欄でも見出しは残す (テンプレ性を保つ)。
 */
export function serializeSiteBrief(fields: SiteBriefFields): string {
  const sections = HEADINGS.map(([key]) => {
    const title = HEADING_TITLES[key];
    const body = fields[key].trim();
    return `## ${title}\n${body ? body + "\n" : "\n"}`;
  }).join("\n");

  return `# サイトの設計図

このファイルは AI がサイトを編集する際に毎回参照する基本情報です。
雰囲気が変わったら、AI に「ターゲットを変えて」「もっとカジュアルに」等で更新を依頼できます。

${sections}`;
}

/**
 * 1 行ミニモーダル用: whatKind だけ更新して既存 Markdown を保つ。
 */
export function setWhatKind(
  markdown: string,
  whatKind: string
): string {
  const fields = parseSiteBrief(markdown);
  fields.whatKind = whatKind;
  return serializeSiteBrief(fields);
}
