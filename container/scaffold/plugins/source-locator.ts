import type { Plugin } from "vite";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
import * as t from "@babel/types";
import path from "node:path";

// ESM/CJS interop
const traverse = (_traverse as unknown as { default: typeof _traverse }).default ?? _traverse;
const generate = (_generate as unknown as { default: typeof _generate }).default ?? _generate;

/**
 * Vite plugin: Source Locator
 * 全 JSX 要素に data-oc-id と data-oc-component を自動注入する。
 * 開発時のみ動作（ビルド時は何もしない）。
 */
export default function sourceLocatorPlugin(): Plugin {
  let root = "";

  return {
    name: "source-locator",
    configResolved(config) {
      root = config.root;
    },
    transform(code, id) {
      // 開発時のみ、TSX/JSX ファイルのみ
      if (!id.match(/\.[jt]sx$/)) return null;
      if (id.includes("node_modules")) return null;

      const relativePath = path.relative(root, id).replace(/\\/g, "/");

      try {
        const ast = parse(code, {
          sourceType: "module",
          plugins: ["typescript", "jsx"],
        });

        // 最も近い関数コンポーネント名を追跡
        let currentComponent = "";

        traverse(ast, {
          // function Foo() / const Foo = () =>
          FunctionDeclaration(path) {
            if (path.node.id?.name && /^[A-Z]/.test(path.node.id.name)) {
              currentComponent = path.node.id.name;
            }
          },
          VariableDeclarator(path) {
            if (
              t.isIdentifier(path.node.id) &&
              /^[A-Z]/.test(path.node.id.name) &&
              (t.isArrowFunctionExpression(path.node.init) ||
                t.isFunctionExpression(path.node.init))
            ) {
              currentComponent = path.node.id.name;
            }
          },
          // export default function() の場合
          ExportDefaultDeclaration(path) {
            if (t.isFunctionDeclaration(path.node.declaration)) {
              if (path.node.declaration.id?.name) {
                currentComponent = path.node.declaration.id.name;
              } else {
                // 無名の場合、ファイル名から推定
                const basename = relativePath.split("/").pop()?.replace(/\.[jt]sx$/, "") ?? "Unknown";
                currentComponent = basename;
              }
            }
          },

          JSXOpeningElement(jsxPath) {
            const node = jsxPath.node;

            // Fragment (<>, <React.Fragment>) はスキップ
            if (t.isJSXIdentifier(node.name) && node.name.name === "Fragment") return;
            if (t.isJSXMemberExpression(node.name) && t.isJSXIdentifier(node.name.property) && node.name.property.name === "Fragment") return;

            // 既に data-oc-id がある場合はスキップ
            const hasOcId = node.attributes.some(
              (attr) =>
                t.isJSXAttribute(attr) &&
                t.isJSXIdentifier(attr.name) &&
                attr.name.name === "data-oc-id"
            );
            if (hasOcId) return;

            const line = node.loc?.start.line ?? 0;
            const col = node.loc?.start.column ?? 0;
            const tag = t.isJSXIdentifier(node.name) ? node.name.name : "unknown";
            const ocId = `${relativePath}:${tag}:${line}:${col}`;

            // data-oc-id を追加
            node.attributes.push(
              t.jsxAttribute(
                t.jsxIdentifier("data-oc-id"),
                t.stringLiteral(ocId)
              )
            );

            // data-oc-component を追加（コンポーネントのルート要素のみ）
            if (currentComponent) {
              const hasComponent = node.attributes.some(
                (attr) =>
                  t.isJSXAttribute(attr) &&
                  t.isJSXIdentifier(attr.name) &&
                  attr.name.name === "data-oc-component"
              );
              if (!hasComponent) {
                node.attributes.push(
                  t.jsxAttribute(
                    t.jsxIdentifier("data-oc-component"),
                    t.stringLiteral(currentComponent)
                  )
                );
              }
            }
          },
        });

        const output = generate(ast, { sourceMaps: true, sourceFileName: id }, code);
        return { code: output.code, map: output.map };
      } catch {
        // パース失敗時はスルー（SWC が別途処理する）
        return null;
      }
    },
  };
}
