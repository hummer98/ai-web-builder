import { test, expect } from "@playwright/test";

/**
 * AI Web Builder デモスクリプト
 *
 * サイトをゼロから構築する一連のフローを実行し、動画として録画する。
 * 実際の OpenCode + LLM を使うため、応答に時間がかかる。
 *
 * 実行:
 *   DEMO_URL=https://ai-web-builder-demo.fly.dev npx playwright test --project demo
 *
 * 動画は e2e/results/ に保存される。
 */

// AI の応答を待つヘルパー
async function waitForResponse(page: import("@playwright/test").Page, timeout = 120_000) {
  // 1. まず "考え中..." (animate-pulse) が表示されるのを待つ
  await page.waitForFunction(
    () => document.querySelectorAll(".animate-pulse").length > 0,
    { timeout: 10_000 }
  ).catch(() => {}); // 表示されない場合もある（即座にエラーが返る等）

  // 2. animate-pulse が消えるのを待つ（AI 応答完了）
  await page.waitForFunction(
    () => document.querySelectorAll(".animate-pulse").length === 0,
    { timeout }
  );

  // 3. ストリーミングカーソルが消えるまで少し待つ
  await page.waitForTimeout(3000);
}

// チャットでメッセージを送信（WS 接続待ちを含む）
async function sendChat(page: import("@playwright/test").Page, message: string) {
  // WS 接続が確立されて input が有効になるまで待つ
  const input = page.locator('input[placeholder*="指示"]');
  await input.waitFor({ state: "attached", timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('input[placeholder*="指示"]') as HTMLInputElement;
      return el && !el.disabled;
    },
    { timeout: 60_000 }
  );
  await input.fill(message);
  await page.locator('button:has-text("送信")').click();
}

test.describe("AI Web Builder デモ", () => {
  test.beforeEach(async ({ page }) => {
    // デモサイトにアクセス（Basic 認証は playwright.config.ts で設定済み）
    await page.goto("/");
    // エディター UI の読み込みを待つ
    await page.waitForSelector("text=AI Web Builder", { timeout: 60_000 });
  });

  test("Step 0: リセット", async ({ page }) => {
    // ワークスペースを初期状態に戻す
    await sendChat(page, "リセットして");
    await waitForResponse(page);

    // リセット完了メッセージを確認
    await expect(page.getByText("初期状態にリセットしました")).toBeVisible({ timeout: 30_000 });
  });

  test("Step 1: サイト生成", async ({ page }) => {
    // カフェサイトを生成
    await sendChat(page, "おしゃれなカフェのサイトを作って。店名は Café Lumière。パリの路地裏にありそうなフレンチカフェ。");
    await waitForResponse(page, 180_000);

    // プレビューにサイトが表示されていることを確認
    const preview = page.frameLocator("#preview-iframe");
    await expect(preview.locator("body")).not.toBeEmpty();

    await page.waitForTimeout(3000); // 録画用に少し待つ
  });

  test("Step 2: ヒーロー画像を AI で生成", async ({ page }) => {
    // ペルソナ準拠: 技術用語を使わず、友人が自然に言いそうな言葉で指示
    await sendChat(
      page,
      "トップに使う写真を作って。パリのカフェのテラス席で、コーヒーとクロワッサンが並んでいる感じ。温かい光で。"
    );
    await waitForResponse(page, 180_000);

    // プレビュー内に画像が表示されていることを確認（Unsplash URL or /images/ どちらでも）
    const preview = page.frameLocator("#preview-iframe");
    const heroImg = preview.locator('img[src]').first();
    await expect(heroImg).toBeVisible({ timeout: 30_000 });

    await page.waitForTimeout(3000); // 録画用に少し待つ
  });

  test("Step 3: テキスト編集（コンテキストメニュー）", async ({ page }) => {
    // Inspect モードを有効化
    await page.locator('button:has-text("Inspect")').click();
    await page.waitForTimeout(1000);

    // iframe 内で inspect モードを直接有効化し、h1 をクリックしてコンテキストメニューを表示
    const iframeEl = page.locator("#preview-iframe");
    const iframe = page.frameLocator("#preview-iframe");

    // iframe 内で直接コンテキストメニューを開く
    await iframe.locator("h1").first().hover();
    await page.waitForTimeout(500);

    // iframe 要素の位置を取得して、page レベルでクリック（iframe 経由でなく）
    const h1Box = await iframe.locator("h1").first().boundingBox();
    const iframeBox = await iframeEl.boundingBox();
    if (h1Box && iframeBox) {
      await page.mouse.click(
        iframeBox.x + h1Box.x + h1Box.width / 2,
        iframeBox.y + h1Box.y + h1Box.height / 2
      );
    }
    await page.waitForTimeout(1000);

    // コンテキストメニューが表示されるか確認
    const contextMenu = iframe.locator("#__oc_context_menu__");
    const menuVisible = await contextMenu.isVisible().catch(() => false);

    if (menuVisible) {
      // コンテキストメニュー経由でテキスト編集
      await iframe.locator("button[data-action='edit-text']").click();
      await page.waitForTimeout(500);
      const editArea = iframe.locator("#__oc_edit_area__");
      await editArea.fill("Café Lumière — Paris Style");
      await page.keyboard.press("Enter");
      await waitForResponse(page);
    } else {
      // フォールバック: チャットでテキスト変更を指示
      await sendChat(page, "見出しのテキストを「Café Lumière — Paris Style」に変更して");
      await waitForResponse(page);
    }

    await page.waitForTimeout(2000);
  });

  test("Step 4: チャットでスタイル変更", async ({ page }) => {
    await sendChat(page, "全体の雰囲気を明るくして。白とミントグリーンを基調にした爽やかな感じにして");
    await waitForResponse(page, 180_000);
    await page.waitForTimeout(3000);
  });

  test("Step 5: レスポンシブ確認", async ({ page }) => {
    // Mobile 表示に切り替え
    await page.locator('button:has-text("Mobile")').click();
    await page.waitForTimeout(2000);

    // Desktop に戻す
    await page.locator('button:has-text("Desktop")').click();
    await page.waitForTimeout(2000);
  });

  test("Step 6: 元に戻す → 履歴", async ({ page }) => {
    // 元に戻す
    await page.locator('button:has-text("元に戻す")').click();
    await page.waitForTimeout(3000);

    // 履歴を開く
    await page.locator('button:has-text("履歴")').click();
    await page.waitForTimeout(2000);

    // 履歴モーダルが表示される
    await expect(page.getByText("変更履歴")).toBeVisible();
    await page.waitForTimeout(2000);

    // モーダルを閉じる（Escape）
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);
  });

  test("Step 7: 使い方を聞く", async ({ page }) => {
    // チャットで使い方を聞く → detectCommand で即座にヘルプを返す
    await sendChat(page, "使い方");

    // ヘルプテキストが表示されるまで待つ（waitForResponse は不要、即座に返る）
    await expect(page.getByText("画像を添付")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3000);
  });
});
