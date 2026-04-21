#!/bin/bash
# モデル比較テストスクリプト
# 使い方: ./scripts/model-compare.sh <opencode-url> <model-id> <prompt>
# 例: ./scripts/model-compare.sh http://localhost:4096 "anthropic/claude-sonnet-4.6" "カフェのサイトを作って"

set -e

OPENCODE_URL="${1:-http://localhost:4096}"
MODEL="$2"
PROMPT="$3"
RESULTS_DIR="scripts/model-results"

mkdir -p "$RESULTS_DIR"

# モデル名からファイル名を生成
MODEL_SLUG=$(echo "$MODEL" | tr '/' '-')
OUTPUT_DIR="$RESULTS_DIR/$MODEL_SLUG"
mkdir -p "$OUTPUT_DIR"

echo "=== Model: $MODEL ==="
echo "Prompt: $PROMPT"
echo ""

# 1. opencode.json のモデルを変更
WORKSPACE_DIR="${WORKSPACE_DIR:-./workspace}"
python3 -c "
import json
with open('$WORKSPACE_DIR/opencode.json') as f: data = json.load(f)
data['model'] = '$MODEL'
with open('$WORKSPACE_DIR/opencode.json', 'w') as f: json.dump(data, f, indent=2)
print('Model set to: $MODEL')
"

# 2. ワークスペースをリセット（scaffold の初期状態に戻す）
echo "Resetting workspace..."
for dir in src functions public; do
  rm -rf "$WORKSPACE_DIR/$dir"
done
rm -f "$WORKSPACE_DIR/index.html"
cp -r container/scaffold/src "$WORKSPACE_DIR/src"
cp -r container/scaffold/functions "$WORKSPACE_DIR/functions"
cp container/scaffold/index.html "$WORKSPACE_DIR/index.html" 2>/dev/null || true
cp container/scaffold/package.json "$WORKSPACE_DIR/package.json"

# 3. git commit（差分をクリアに）
cd "$WORKSPACE_DIR"
if [ -d .git ]; then
  git add -A && git -c user.name=test -c user.email=test@test.com commit -m "Reset for model test: $MODEL" --allow-empty 2>/dev/null || true
fi
cd ..

# 4. OpenCode セッション作成
echo "Creating session..."
SESSION=$(curl -s -X POST "$OPENCODE_URL/session" -H "Content-Type: application/json" -d '{}')
SESSION_ID=$(echo "$SESSION" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)

if [ -z "$SESSION_ID" ]; then
  echo "ERROR: Failed to create session"
  echo "$SESSION"
  exit 1
fi
echo "Session: $SESSION_ID"

# 5. プロンプト送信（同期）
echo "Sending prompt..."
START=$(date +%s)
RESPONSE=$(curl -s --max-time 300 -X POST "$OPENCODE_URL/session/$SESSION_ID/message" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json
print(json.dumps({'parts': [{'type': 'text', 'text': '$PROMPT'}]}))
")")
END=$(date +%s)
ELAPSED=$((END - START))

# 6. 結果を保存
echo "$RESPONSE" > "$OUTPUT_DIR/response.json"

# 7. 変更されたファイルを記録
cd "$WORKSPACE_DIR"
if [ -d .git ]; then
  git diff --name-only HEAD > "../$OUTPUT_DIR/changed-files.txt" 2>/dev/null || true
  git diff --stat HEAD > "../$OUTPUT_DIR/diff-stat.txt" 2>/dev/null || true
  git diff HEAD > "../$OUTPUT_DIR/full-diff.txt" 2>/dev/null || true
fi
cd ..

# 8. 結果サマリー
CHANGED=$(wc -l < "$OUTPUT_DIR/changed-files.txt" 2>/dev/null | tr -d ' ' || echo 0)
RESPONSE_TEXT=$(echo "$RESPONSE" | python3 -c "
import json,sys
data = json.load(sys.stdin)
parts = data.get('parts', [])
texts = [p.get('text','') for p in parts if p.get('type') == 'text']
print('\n'.join(texts)[:500])
" 2>/dev/null || echo "ERROR parsing response")

echo ""
echo "=== Results ==="
echo "Time: ${ELAPSED}s"
echo "Changed files: $CHANGED"
cat "$OUTPUT_DIR/changed-files.txt" 2>/dev/null
echo ""
echo "Response (first 500 chars):"
echo "$RESPONSE_TEXT"
echo ""
echo "Full results saved to: $OUTPUT_DIR/"
