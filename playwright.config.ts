import { defineConfig } from "@playwright/test";

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
if (!DEMO_PASSWORD) {
  throw new Error(
    "DEMO_PASSWORD env var is required to run Playwright tests (set in .envrc or shell)"
  );
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000, // AI 応答を待つため長め
  use: {
    baseURL: process.env.DEMO_URL ?? "https://ai-web-builder-demo.fly.dev",
    video: "on",
    screenshot: "on",
    httpCredentials: {
      username: "demo",
      password: DEMO_PASSWORD,
    },
  },
  outputDir: "./e2e/results",
  projects: [
    {
      name: "demo",
      testMatch: "demo.spec.ts",
    },
  ],
});
