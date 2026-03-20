import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000, // AI 応答を待つため長め
  use: {
    baseURL: process.env.DEMO_URL ?? "https://ai-web-builder-demo.fly.dev",
    video: "on",
    screenshot: "on",
    httpCredentials: {
      username: "demo",
      password: process.env.DEMO_PASSWORD ?? "ai-web-builder-2026",
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
