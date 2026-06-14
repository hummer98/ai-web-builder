#!/usr/bin/env node
// stdin のプレーンテキストログを 1 行ずつ JSON Lines に整形して stdout へ流す。
// start.sh で vite / hono の出力をこれに通してから tee することで、
// vite.log / hono.log を agent-server.log と同じ JSON Lines 形式に揃える。
//
//   npx vite ... 2>&1 | node jsonl-wrap.mjs vite | tee -a logs/vite.log
//
// 依存なしの plain node (tsx 不要)。opencode-postprocess.mjs / secrets-reader.mjs
// と同じ配置・起動方式。

import { createInterface } from "node:readline";
import { toJsonl } from "./log-format.mjs";

const service = process.argv[2] || "unknown";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (raw) => {
  const line = toJsonl(service, raw, "info");
  if (line !== null) process.stdout.write(line + "\n");
});
