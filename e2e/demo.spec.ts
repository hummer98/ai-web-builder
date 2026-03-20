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
  // "考え中..." が消えて、新しい assistant メッセージが表示されるまで待つ
  await page.waitForFunction(
    () => {
      const pulses = document.querySelectorAll(".animate-pulse");
      return pulses.length === 0;
    },
    { timeout }
  );
  // ストリーミング完了を待つ（ブリンクカーソルが消えるまで）
  await page.waitForTimeout(2000);
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
    await sendChat(page, "おしゃれなカフェのサイトを作ってください。店名は「Café Lumière」、フレンチスタイルのカフェです。ヒーローセクション、メニュー、アクセス、お問い合わせの4セクション構成でお願いします。");
    await waitForResponse(page, 180_000);

    // プレビューにサイトが表示されていることを確認
    const preview = page.frameLocator("#preview-iframe");
    await expect(preview.locator("body")).not.toBeEmpty();

    await page.waitForTimeout(3000); // 録画用に少し待つ
  });

  test("Step 2: テキスト編集（コンテキストメニュー）", async ({ page }) => {
    // Inspect モードを有効化
    await page.locator('button:has-text("Inspect")').click();
    await page.waitForTimeout(1000);

    // プレビュー内の見出しをクリック
    const preview = page.frameLocator("#preview-iframe");
    const heading = preview.locator("h1").first();
    await heading.click();
    await page.waitForTimeout(500);

    // コンテキストメニューが表示される
    const contextMenu = preview.locator("#__oc_context_menu__");
    await expect(contextMenu).toBeVisible({ timeout: 5000 });

    // 「テキストを編集」をクリック
    await preview.locator("text=テキストを編集").click();
    await page.waitForTimeout(500);

    // テキストを編集
    const editArea = preview.locator("#__oc_edit_area__");
    await editArea.fill("Café Lumière — Paris Style");
    await page.keyboard.press("Enter");

    // AI の応答を待つ
    await waitForResponse(page);
    await page.waitForTimeout(2000);
  });

  test("Step 3: チャットでスタイル変更", async ({ page }) => {
    await sendChat(page, "全体の配色をダークブラウンとクリーム色のパリ風カフェカラーに変えてください");
    await waitForResponse(page, 180_000);
    await page.waitForTimeout(3000);
  });

  test("Step 4: レスポンシブ確認", async ({ page }) => {
    // Mobile 表示に切り替え
    await page.locator('button:has-text("Mobile")').click();
    await page.waitForTimeout(2000);

    // Desktop に戻す
    await page.locator('button:has-text("Desktop")').click();
    await page.waitForTimeout(2000);
  });

  test("Step 5: 元に戻す → 履歴", async ({ page }) => {
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

  test("Step 6: ヘルプ", async ({ page }) => {
    // ? ボタンでヘルプを開く
    await page.locator('button:has-text("使い方")').click();
    await page.waitForTimeout(2000);

    await expect(page.getByRole("heading", { name: "使い方" })).toBeVisible();
    await page.waitForTimeout(2000);

    // 閉じる
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);
  });
});
