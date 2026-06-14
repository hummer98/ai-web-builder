---
id: 026
title: E2E デモに GO/BACK/HOME/RELOAD ナビゲーションテストを追加
priority: high
depends_on: [025]
created_by: surface:63
created_at: 2026-05-07T23:29:31.225Z
---

## タスク
## 背景

\`e2e/demo.spec.ts\` には現在 Step 0〜7 のシナリオがあるが、
**右ペインの ← / → / 🏠 / Reload ボタンを動作確認するステップが存在しない**。

T024（戻る/進むバグ修正: \`iframe.contentWindow.history.back()\` ではなく
自前の URL スタックで iframe ナビゲーションする）と
T025（ヘッダー再構成 + Reload アイコン化）が closed になった時点で、
これらの挙動を保証する **回帰テスト** を E2E に追加する必要がある。

特に T024 のバグ
「← を押すと親ブラウザ（editor 自体）が戻ってしまう」は、
ユニットテストだけでは検出が難しい（実ブラウザの joint session history 挙動が絡むため）。
E2E で \`page.url()\` を監視して親ブラウザが遷移しないことを確認するテストが要る。

## 影響ファイル

- \`e2e/demo.spec.ts\` — 新規ステップ追加
- 必要に応じて \`container/scaffold/\` 配下のサンプルページ（テストで遷移させるリンク先）

## 追加するステップ案

既存 Step 5（レスポンシブ確認）と Step 6（元に戻す → 履歴）の **間に** 挿入する
（"Step 5.5" 等ではなく Step 番号は連番に振り直す）。

### Step A: ナビゲーション操作（GO/BACK/HOME）

\`\`\`ts
test("Step X: ナビゲーション (← / → / 🏠)", async ({ page }) => {
  const initialEditorUrl = page.url();
  const iframe = page.frameLocator("#preview-iframe");

  // 1. iframe 内で別パスに遷移する（pushState を直接実行）
  //    scaffold に複数ページ／リンクがあればクリックでも可
  await page.locator("#preview-iframe").evaluate((el: HTMLIFrameElement) => {
    el.contentWindow?.history.pushState({}, "", "/about");
    el.contentWindow?.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForTimeout(500);

  // 2. ← (戻る) をクリック
  await page.locator('button[aria-label="戻る"]').click();
  await page.waitForTimeout(1000);

  // 3. ★クリティカル: 親ブラウザの URL は変わっていない (T024 回帰テスト)
  expect(page.url()).toBe(initialEditorUrl);

  // 4. iframe 内の URL が「戻った」状態になっている
  const backUrl = await page.locator("#preview-iframe").evaluate(
    (el: HTMLIFrameElement) => el.contentWindow?.location.pathname
  );
  expect(backUrl).toBe("/");

  // 5. → (進む) をクリック
  await page.locator('button[aria-label="進む"]').click();
  await page.waitForTimeout(1000);

  // 親ブラウザは依然変わらない
  expect(page.url()).toBe(initialEditorUrl);

  const fwdUrl = await page.locator("#preview-iframe").evaluate(
    (el: HTMLIFrameElement) => el.contentWindow?.location.pathname
  );
  expect(fwdUrl).toBe("/about");

  // 6. 🏠 (ホーム) をクリック → iframe が / に戻る
  await page.locator('button[aria-label="ホーム"]').click();
  await page.waitForTimeout(1000);

  expect(page.url()).toBe(initialEditorUrl);
  const homeUrl = await page.locator("#preview-iframe").evaluate(
    (el: HTMLIFrameElement) => el.contentWindow?.location.pathname
  );
  expect(homeUrl).toBe("/");
});
\`\`\`

### Step B: Reload (アイコン)

\`\`\`ts
test("Step Y: Reload アイコンで iframe 再読み込み", async ({ page }) => {
  const initialEditorUrl = page.url();

  // iframe 内に再読み込み検出用マーカーを設置
  await page.locator("#preview-iframe").evaluate((el: HTMLIFrameElement) => {
    (el.contentWindow as any).__RELOAD_MARKER__ = "before";
  });

  // T025 で Reload はアイコンになる。aria-label="再読み込み" で locate
  await page.locator('button[aria-label="再読み込み"]').click();

  // load イベント完了を待つ
  await page.waitForFunction(
    () => {
      const el = document.querySelector("#preview-iframe") as HTMLIFrameElement;
      return el?.contentWindow && !(el.contentWindow as any).__RELOAD_MARKER__;
    },
    { timeout: 10_000 }
  );

  // 親ブラウザの URL は不変
  expect(page.url()).toBe(initialEditorUrl);
});
\`\`\`

## 注意点・調整余地

- 上記テストコードは **草案**。Conductor / Agent はそのままコピペせず、
  \`container/scaffold/\` の現状（ルーティング有無、ページ構成）を見て調整すること:
  - scaffold が SPA Router（react-router 等）を持っていない場合、
    \`pushState\` だけでは iframe 側の表示が変わらない可能性がある。
    その場合は scaffold に簡単な複数ページ or リンクを追加するか、
    \`iframe.src\` を直接書き換える方式に変える
- \`button[aria-label="再読み込み"]\` の aria-label は T025 の実装に合わせて確認すること
  （T025 タスクでは \`aria-label="再読み込み"\` 推奨と書いたが、実装がずれていたら追従）
- T024 の自前履歴スタック実装方式によっては、\`pushState\` 検知のため
  \`postMessage({type:"nav"})\` を Agent 側が iframe スクリプトに足しているはず。
  この **postMessage が来ないとスタックに積まれず ← が効かない** 可能性があるので、
  scaffold でナビゲーションした際に postMessage が確実に発火しているか確認する
- 既存テストはすべて \`test.describe\` 内に並列で書かれているが、
  各 test は **独立コンテキスト** で実行されるため、
  Step A → Step B の順序依存はない。各テスト先頭で \`/\` から始める前提で書く

## 受け入れ条件

1. \`e2e/demo.spec.ts\` に GO/BACK/HOME/RELOAD を検証するステップが
   独立した \`test()\` として追加されている
2. **親ブラウザの URL が変わらない** ことを各ステップで \`expect(page.url()).toBe(initialEditorUrl)\` で検証
3. \`npx playwright test --project demo\` で **全 Step が pass**（ローカル or デモ環境）
4. T024 の修正前のコード（\`iframe.contentWindow.history.back()\` 直呼び）に
   一時的に戻すと **追加した Step が確実に fail する** ことを確認
   （= 回帰検出能力があることを summary.md で言明）
5. \`e2e/results/\` に新ステップの動画が出力される

## 関連

- T024: PreviewPanel の ←/→ ボタンが親ブラウザの履歴を巻き込む問題を修正
- T025: 編集ヘッダーを右ペインに集約 + Reload をアイコン化
- 報告者: Master / ユーザー（2026-05-08 セッション）
