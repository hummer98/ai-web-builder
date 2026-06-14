# インシデント記録: ゲストサイトのプレビューが真っ黒 (2026-06-14)

## 概要

ゲストサイト `le-serpent`（`https://editor.le-serpent.club/`）のプレビューが**完全に真っ黒**（文字もボタンも何も表示されない）状態になった。本番デプロイ（Cloudflare/Firebase）では正常に表示される。

調査の結果、**ai-web-builder（ビルダー）側の構造的な問題**であり、ゲストのコードは正しいことが判明した。根本原因は2つあり、どちらも「プレビューを `/preview/` サブパス（`base=/preview/`）で配信している」ことに起因していた。

## 環境

- 編集環境: Fly.io (`ai-web-builder`)
- プレビュー: agent-server (:8080, Hono) が `/preview/*` を Vite Dev Server (:5173, `base=/preview/`) にプロキシ。エディタ UI と同一オリジンに同居
- 本番: ゲストサイトはドメインのルート（`base=/`）で配信

## 症状の切り分け

| 確認項目 | 結果 |
|---|---|
| プレビュー HTML 配信 | ✅ 正常（`<div id="root">` あり） |
| 全ソース（19 ファイル）のトランスパイル | ✅ 全て 200 |
| 依存（react / react-router / react-dom 最適化） | ✅ 全て 200 |
| 構文エラー・Vite ビルドエラー | ✅ なし |
| ゲストの作業ツリー | ✅ クリーン |
| `#root` の中身 | ❌ AgeGate のみ。本体ページが空 |

サーバー側・ビルド面はすべて健全で、残るは**ブラウザ実行時の挙動**のみだった。

### 決め手: ブラウザのコンソールをコンテナ側で取得する

ユーザーの実ブラウザの `console` はサーバーには届かない。`log-reader` MCP が読むのはサーバープロセスのログ（vite/hono 等）でブラウザコンソールは含まれない。opencode の Playwright 視覚ループも当時は機能しておらず（後述）、原因に辿り着けていなかった。

そこで**コンテナ内に headless Chromium で Playwright を一時導入し、`localhost:5173/preview/` を開いてコンソールと `#root` を直接取得**した：

```
[console:warning] No routes matched location "/preview/"   ← 主因
[root.innerHTML.length] 1454                                ← AgeGate のみ
[pageerror] なし                                           ← JS クラッシュではない
```

この `No routes matched location "/preview/"` が決定打だった。

> 教訓: 「真っ黒／白画面」でサーバー側が全部健全なときは、**コンテナ内 headless ブラウザでコンソールと `#root` を取る**のが最短。

## 根本原因（2つとも `base=/preview/` 起因）

### ① 主因: BrowserRouter の basename 欠落

`scaffold/src/main.tsx` は本来 `<BrowserRouter basename={import.meta.env.BASE_URL}>` を持つ正しい構造だが、**opencode が le-serpent の `main.tsx` から BrowserRouter を取り除き、`App.tsx` に basename 無しの `<BrowserRouter>` を書き直していた**。

その結果、プレビュー（`base=/preview/`）では現在 URL `/preview/` がどの `<Route path="/">` にもマッチせず、`<Routes>` の中身（全ページ）が一切描画されなかった。本番（`base=/`）では URL が `/` なのでマッチし、正常に動く → 検知しづらい。

### ② 副因: CSS 背景画像の絶対パス

`index.css` の `url('/entrance.jpg')` `url('/concept-bg.jpg')` はルート絶対パス。Vite は CSS 内の絶対 URL に `base` を付け足さないため、プレビューではブラウザが `/entrance.jpg`（→ 404）を要求し、AgeGate の背景が出ず黒くなっていた。本番（`base=/`）では `/entrance.jpg` が実在するので正常。

```
/entrance.jpg          → 404
/preview/entrance.jpg  → 200 / 1.1MB
```

### 共通構図

ゲストのコードは「自分はルート `/` にいる」前提で**正しく**書かれており本番では動く。だがビルダーがプレビューを `/preview/` サブパスに間借りさせているため、その前提が崩れて壊れる。さらに opencode はこの `/preview/` 制約を知らされておらず、壊れても視覚ループが動かず検知できなかった。**3層すべてビルダー側の問題。**

## 修正内容

### ai-web-builder 本体（main にマージ済み・デプロイ済み）

| コミット | 内容 |
|---|---|
| `2eb9297` | agent-server: `editor/dist` に無い拡張子付きパス（ゲストのルート絶対アセット）を Vite の `/preview` 配下へフォールバック転送（②の救済） |
| `4abc211` | テスト: 旧名 `browser_screenshot` → `browser_take_screenshot` に追従 |
| `9005b7b` | common.md: 「BrowserRouter を作り直さない／使うなら `basename={import.meta.env.BASE_URL}` 必須」ルール追記（①の再発防止）+ 必須キーワードテストで担保 |

### le-serpent（ゲストリポジトリ）

- `1670e94` `fix: BrowserRouter に basename を追加しプレビューでの表示崩れを修正`（`ai-web-builder[bot]`、push 済み・リモート一致確認済み）

## opencode 視覚フィードバックループの問題（副次的発見）

当初「Chromium 未インストール」と誤認したが、実際は **Dockerfile で `PLAYWRIGHT_BROWSERS_PATH=/usr/local/share/playwright` に導入済み**（標準の `~/.cache/ms-playwright` ではない別パス）。`buildSanitizedEnv()` はこの env を削除しないため opencode に継承される。MCP 設定の無効オプションも同日のコミット（`850ca94` `--url` 削除 / `02381c7` `--browser chromium` 指定）で修正済み。

→ 視覚ループは既に直っている可能性が高いが、**opencode が実際に `browser_take_screenshot` を呼べるか実地確認する価値がある**（これが機能すれば、今後 opencode が黒画面を自分で検知・修正できる）。

## 残課題

1. **Hono クラッシュ**: `/data/workspace/functions/api/index.ts` が見つからずバックエンドが起動失敗（実体は `functions/src/`）。`/api/*` が全滅。初期表示には影響しないが問い合わせ/予約フォーム等が動かない
2. **opencode 視覚ループの実地確認**（上記）
3. **プレビューの根治案**: `/preview/` サブパスをやめ、別オリジンで `base=/` 配信して本番と環境を一致させれば、この種の base 起因バグが構造的に消える（ゲストに制約を課さない＝アンチ・ロックインとも整合。ただしインフラ改修が重く、個人ツールとしては将来検討）

## 運用メモ

- `flyctl ssh console -C` は**外部コマンドの stdout を断続的に取りこぼす**ことがあった。`{ ...; } > /tmp/out.txt 2>&1; sync` でファイルに書き、別 ssh で `cat` すると確実
- autostop で寝るので、ssh 前に `curl -s -m 90 https://ai-web-builder.fly.dev/health`（200）で起こす
- コンテナ内 `git` は `git -c safe.directory=/data/workspace -C /data/workspace ...`（dubious ownership 回避）。push 認証は remote URL 埋め込みトークンで通る
