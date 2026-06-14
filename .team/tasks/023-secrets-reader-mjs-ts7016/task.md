---
id: 023
title: secrets-reader.mjs の型定義を追加（TS7016 解消）
priority: low
created_by: surface:272
created_at: 2026-05-05T10:47:22.577Z
---

## タスク
## 背景

T019 で deploy.ts → secrets-store.ts → secrets-reader.mjs の import 連鎖が成立した結果、secrets-reader.mjs に対応する .d.ts が無いため TS7016 (implicit any) が secrets-store.ts:12:36 で表面化している。

## 対応案

A) container/secrets-reader.d.ts を追加（resolveSecretsPath の型のみ）
B) secrets-reader.mjs を .mts 化

## 影響

dev 体験のみ。テスト・ビルド・実行には影響なし。

## 由来

- T016: secrets-reader.mjs を導入（型定義なしで放置）
- T019 inspection.md の Minor finding 1
- impl-report.md / inspection.md でも記載済み
