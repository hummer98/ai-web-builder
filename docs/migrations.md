# インフラ・コンテナ変更時の手順 (migrations)

このリポジトリは **個人ツール** だが、本番 Fly Volume にユーザーデータが乗っているため、
`Dockerfile` / `start.sh` / Fly Machine 設定を変えるときは **既存 Volume との互換性** を
必ず確認する必要がある。

このファイルは「過去にやらかした事故と再発防止策」のメモ。新しい変更を入れる前に該当
セクションを読み、必要な手順を `.team/tasks/<id>/summary.md` の **post-deploy migration**
セクションに転記すること。

---

## 1. USER / Volume 所有権 (root→app 降格パターンで自己修復)

### 過去事故

- T014 (2026-04-22) で `Dockerfile: USER app` に変更
- 既存 Fly Volume `/data` が過去 root 所有のまま残っていた
- `start.sh` の `node_modules` 同期で `rm -rf` が Permission denied → restart loop → 死亡
- ユーザーが `editor.le-serpent.club` にアクセスできず、復旧に時間を要した (2026-05-03)
- その後も Volume に UID≠1001 のファイルが混ざるたびに restart loop で再発
  (autostop 起き上がり時など)。手動 2 段階リカバリ (`RUN_AS_USER=root` deploy →
  通常 deploy) が必要で運用負荷が高かった

### 現在の方式 (2026-06-15〜) — 起動時に自己修復

`Dockerfile` から `USER app` を撤去し、**コンテナを root で起動**するように変更。
`start.sh` 冒頭で:

1. `id -u == 0` (root) なら `chown -R 1001:1001 /data` で所有権を**毎回強制修復**
   (root なので確実に成功する)
2. `export HOME=/home/app` して `exec gosu app "$0"` で **app(UID 1001) に降格**して
   本体を起動 (vite / hono / agent-server はすべて app として動く)

これにより Volume の所有権ずれは**起動のたびに自動回復**し、**手動リカバリは不要**。
`RUN_AS_USER` build-arg とリカバリモード (最小 HTTP で待機する分岐) は廃止した。

### 残っている安全網

- `start.sh` は降格後に `find -not -uid 1001` を一度チェックし、それでも 1001 以外が
  残っていれば (= chown が効かない異常) fail-fast して `flyctl ssh console` を案内
- node_modules は scaffold image へのシンボリックリンクなので、そもそも Volume 内に
  実体が無く所有権問題が起きにくい (二重の防御)

### USER / 起動方式を再度変えるときの注意

- root→drop をやめて再び固定 USER にする場合は、上記の自己修復が消えるので、
  Volume 所有権を別途保証する手段 (initContainer 相当 / 手動 chown) を用意すること
- `gosu` はベースイメージ (`node:22-slim`) に `apt-get install gosu` で導入済み。
  base image を alpine 等に変える場合は `su-exec` 等への置換が必要

---

## 2. node_modules の置き場所変更 (Volume → image symlink)

### 経緯

T014 後の事故 (前項) を受けて、`/data/workspace/node_modules` を `/app/container/scaffold/node_modules`
へのシンボリックリンクに変更した (2026-05-03)。

メリット:
- Volume の所有権問題が原理的に発生しない
- 起動時の `cp -r` (数十秒) → リンク作成 (即時) に短縮
- vite の `.vite/deps/` キャッシュは image overlay 内に書かれ、毎 deploy で fresh になる

### 必須手順

scaffold の依存を増減した場合、`Dockerfile` の `COPY container/scaffold/` 以降が
再ビルドされて `/app/container/scaffold/node_modules` が更新される。**workspace 側の
package.json は scaffold と同一前提**。ゲストサイト固有の追加依存は npm install してもsoon
シンボリックリンク先 (image overlay) に書かれるため永続化しない (= 次 deploy で消える)。

ゲストサイト固有依存を持たせたい場合は、scaffold/package.json に追加して image を
リビルドする方針で運用する。

---

## 3. Fly Volume 自体の変更 (作り直し・サイズ変更等)

### 注意

`fly.toml` の `[mounts]` を変更したり、Volume を destroy → recreate すると **すべての
ゲストサイトの workspace データが消失する**。GitHub にバックアップされているとはいえ、
未 push の commit や、`/data` 直下の `/data/sites.json` 由来データ等は復旧できない。

### 必須手順

1. `flyctl ssh console --user root` で `/data` の中身を tar 取得して S3 / 手元に退避
2. Volume 変更
3. 退避から復元
4. `flyctl deploy` で再起動

---

## 4. Dockerfile の base image 変更

`node:22-slim` → `node:24-alpine` のような変更時は、

- `apt-get` → `apk add` への置き換え (必要なら)
- ユーザー作成方法の差分 (`useradd` → `adduser`)
- Playwright の OS 依存パッケージ可否 (alpine には musl 互換が無いものあり)
- glibc 依存 npm パッケージ (sharp, swc, esbuild 等) の動作確認

を local docker build → run で確認してから push すること。

---

## チェックリストテンプレ (新タスク用)

`.team/tasks/<id>/summary.md` の末尾にコピペして使う:

```markdown
## Post-deploy migration

- [ ] 影響: Dockerfile / start.sh / fly.toml のどれを変えたか
- [ ] 既存 Volume 互換: 必要な手動操作はあるか (chown, データ退避等)
- [ ] 自動 smoke test: deploy.yml の post-deploy job が pass したか
- [ ] 手動確認: ブラウザで editor URL を開いて操作したか
- [ ] ロールバック手順: 失敗時にどう戻すか
```
