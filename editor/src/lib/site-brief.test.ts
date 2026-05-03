import { describe, it, expect } from "vitest";
import {
  parseSiteBrief,
  serializeSiteBrief,
  setWhatKind,
  EMPTY_FIELDS,
} from "./site-brief";

describe("parseSiteBrief", () => {
  it("テンプレ (空) を全フィールド空文字で返す", () => {
    const md = `# サイトの設計図

このファイルは AI が…

## 何のサイト


## 場所


## 来てほしい人


## 雰囲気・トーン


## 大事なメモ

`;
    expect(parseSiteBrief(md)).toEqual(EMPTY_FIELDS);
  });

  it("各セクションの本文を抽出する", () => {
    const md = `# サイトの設計図

## 何のサイト
新宿のカフェ

## 場所
東京都新宿区

## 来てほしい人
30 代女性

## 雰囲気・トーン
柔らかく落ち着いた

## 大事なメモ
- 全席禁煙
- ペット不可
`;
    expect(parseSiteBrief(md)).toEqual({
      whatKind: "新宿のカフェ",
      location: "東京都新宿区",
      audience: "30 代女性",
      tone: "柔らかく落ち着いた",
      notes: "- 全席禁煙\n- ペット不可",
    });
  });

  it("複数行の本文を保持する", () => {
    const md = `## 何のサイト
1 行目
2 行目
3 行目
`;
    expect(parseSiteBrief(md).whatKind).toBe("1 行目\n2 行目\n3 行目");
  });

  it("未知の見出しの本文は捨てる", () => {
    const md = `## 何のサイト
カフェ

## 全然関係ない見出し
これは無視される

## 場所
新宿
`;
    const r = parseSiteBrief(md);
    expect(r.whatKind).toBe("カフェ");
    expect(r.location).toBe("新宿");
    expect(JSON.stringify(r)).not.toContain("これは無視される");
  });
});

describe("serializeSiteBrief", () => {
  it("空フィールドでも見出しを残す", () => {
    const md = serializeSiteBrief(EMPTY_FIELDS);
    expect(md).toContain("## 何のサイト");
    expect(md).toContain("## 場所");
    expect(md).toContain("## 来てほしい人");
    expect(md).toContain("## 雰囲気・トーン");
    expect(md).toContain("## 大事なメモ");
  });

  it("値を埋めて再生する", () => {
    const md = serializeSiteBrief({
      whatKind: "カフェ",
      location: "新宿",
      audience: "",
      tone: "落ち着いた",
      notes: "",
    });
    expect(md).toContain("## 何のサイト\nカフェ");
    expect(md).toContain("## 場所\n新宿");
    expect(md).toContain("## 雰囲気・トーン\n落ち着いた");
  });

  it("parse → serialize → parse の往復で同等の値になる (round-trip)", () => {
    const orig = {
      whatKind: "カフェ",
      location: "新宿",
      audience: "30 代",
      tone: "柔らかい",
      notes: "禁煙",
    };
    const md = serializeSiteBrief(orig);
    expect(parseSiteBrief(md)).toEqual(orig);
  });
});

describe("setWhatKind", () => {
  it("既存の他フィールドを保持して whatKind だけ書き換える", () => {
    const orig = serializeSiteBrief({
      whatKind: "古い",
      location: "新宿",
      audience: "",
      tone: "落ち着いた",
      notes: "",
    });
    const updated = setWhatKind(orig, "新しい");
    const fields = parseSiteBrief(updated);
    expect(fields.whatKind).toBe("新しい");
    expect(fields.location).toBe("新宿");
    expect(fields.tone).toBe("落ち着いた");
  });
});
