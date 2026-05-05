import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// React/ReactDOM が editor/node_modules とルートの両方に入ると
// dispatcher が分岐して useState が null になるため、ルートの 1 コピーに揃える。
const reactRoot = fileURLToPath(new URL("./node_modules/react", import.meta.url));
const reactDomRoot = fileURLToPath(
  new URL("./node_modules/react-dom", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      react: reactRoot,
      "react-dom": reactDomRoot,
    },
    dedupe: ["react", "react-dom"],
  },
  test: {
    exclude: ["**/node_modules/**", "**/e2e/**", "**/.worktrees/**"],
  },
});
