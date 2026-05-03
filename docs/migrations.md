# インフラ・コンテナ変更時の手順 (migrations)

このリポジトリは **個人ツール** だが、本番 Fly Volume にユーザーデータが乗っているため、
`Dockerfile` / `start.sh` / Fly Machine 設定を変えるときは **既存 Volume との互換性** を
必ず確認する必要がある。

このファイルは「過去にやらかした事故と再発防止策」のメモ。新しい変更を入れる前に該当
セクションを読み、必要な手順を `.team/tasks/<id>/summary.md` の **post-deploy migration**
セクションに転記すること。

---

## 1. USER 変更 (root → app などの非 root 化)

### 過去事故

- T014 (2026-04-22) で `Dockerfile: USER app` に変更
- 既存 Fly Volume `/data` が過去 root 所有のまま残っていた
- `start.sh` の `node_modules` 同期で `rm -rf` が Permission denied → restart loop → 死亡
- ユーザーが `editor.le-serpent.club` にアクセスできず、復旧に時間を要した (2026-05-03)

### 必須手順

USER を変更する deploy には **Volume の所有権マイグレーション** を伴うこと:

```bash
# 1. リカバリ deploy (一時的に root 起動して chown だけ走らせる)
flyctl deploy --build-arg RUN_AS_USER=root -a ai-web-builder

# 2. ログで "Recovery chown complete" を確認
flyctl logs -a ai-web-builder --no-tail | grep -E "Recovery|chown"

# 3. ssh で所有権を確認 (任意)
flyctl ssh console -a ai-web-builder --user root -C 'find /data/workspace -not -uid 1001 -type f | head'

# 4. 通常 deploy で USER app に戻す
flyctl deploy --remote-only -a ai-web-builder
```

### 自己修復ガード (実装済み)

- `start.sh` 冒頭で `find -not -uid 1001` し、見つかれば fail-fast でリカバリ手順を表示
- `start.sh` の root 起動分岐 (`id -u == 0`) は chown だけ走らせ、`vite/hono/opencode` は
  起動しない (ヘルスチェック用に :8080 最小 HTTP のみ)
- node_modules は scaffold image へのシンボリックリンクなので、Volume 内に node_modules
  実体が無ければ所有権問題は発生しない

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
