#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { format } from "prettier";
import ts from "typescript";

const protocolModule = "./generated/protocol";

/** 只导出界面 SDK 公开引用的 Rust DTO 及其传递依赖，不携带宿主命令实现。 */
export async function renderExtensionSdkProtocol(bindings, sdk) {
  const filename = resolve("extension-sdk-bindings.ts").replaceAll("\\", "/");
  const options = {
    target: ts.ScriptTarget.ES2022,
    noResolve: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (path, ...args) =>
    path === filename
      ? ts.createSourceFile(path, bindings, options.target, true)
      : getSourceFile(path, ...args);
  const program = ts.createProgram([filename], options, host);
  const source = program.getSourceFile(filename);
  const api = ts.createSourceFile(
    "extension-ui.d.ts",
    sdk,
    options.target,
    true,
  );
  for (const file of [source, api]) {
    if (file.parseDiagnostics.length)
      throw new Error(
        ts.flattenDiagnosticMessageText(
          file.parseDiagnostics[0].messageText,
          "\n",
        ),
      );
  }
  const declarations = new Map();
  for (const statement of source.statements) {
    if (
      (ts.isTypeAliasDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement)) &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      if (declarations.has(statement.name.text))
        throw new Error(`Rust 绑定包含重复类型：${statement.name.text}`);
      declarations.set(statement.name.text, statement);
    }
  }
  const roots = [];
  for (const statement of api.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      statement.moduleSpecifier.text !== protocolModule
    )
      continue;
    const imports = statement.importClause?.namedBindings;
    if (!imports || !ts.isNamedImports(imports))
      throw new Error("SDK 协议必须使用具名类型导入");
    roots.push(
      ...imports.elements.map(
        (element) => (element.propertyName ?? element.name).text,
      ),
    );
  }
  if (!roots.length) throw new Error("SDK 没有声明公开协议类型");

  const checker = program.getTypeChecker();
  const selected = new Set();
  function include(name) {
    if (selected.has(name)) return;
    const declaration = declarations.get(name);
    if (!declaration) throw new Error(`Rust 绑定缺少公开 DTO：${name}`);
    selected.add(name);
    function visit(node) {
      if (ts.isTypeQueryNode(node) || ts.isImportTypeNode(node))
        throw new Error(`公开 DTO ${name} 不能依赖运行时值或外部模块`);
      if (
        ts.isTypeReferenceNode(node) ||
        ts.isExpressionWithTypeArguments(node)
      ) {
        const reference = ts.isTypeReferenceNode(node)
          ? node.typeName
          : node.expression;
        const symbol = checker.getSymbolAtLocation(reference);
        if (
          symbol?.declarations?.every(
            (entry) =>
              ts.isTypeParameterDeclaration(entry) ||
              program.isSourceFileDefaultLibrary(entry.getSourceFile()),
          )
        ) {
          // 泛型参数和 TypeScript 标准库类型由使用方编译器提供。
        } else if (
          symbol &&
          symbol.declarations?.includes(declarations.get(symbol.name))
        ) {
          include(symbol.name);
        } else {
          throw new Error(
            `公开 DTO ${name} 存在未闭合的类型引用：${reference.getText(source)}`,
          );
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(declaration);
  }
  roots.forEach(include);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const output = [...declarations]
    .filter(([name]) => selected.has(name))
    .map(([, declaration]) =>
      printer.printNode(ts.EmitHint.Unspecified, declaration, source),
    );
  return format(
    "// 此文件由 scripts/generate-extension-sdk-types.mjs 从 Rust IPC 绑定生成，请勿手改。\n\n" +
      output.join("\n\n") +
      "\n",
    { filepath: "protocol.d.ts" },
  );
}

export async function generateExtensionSdkTypes(root, { check = false } = {}) {
  const [bindings, sdk] = await Promise.all([
    readFile(join(root, "src/lib/generated/bindings.ts"), "utf8"),
    readFile(join(root, "sdk/extension-ui.d.ts"), "utf8"),
  ]);
  const generated = await renderExtensionSdkProtocol(bindings, sdk);
  const target = join(root, "sdk/generated/protocol.d.ts");
  if (check) {
    const existing = await readFile(target, "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    if (existing.replaceAll("\r\n", "\n") !== generated)
      throw new Error(
        "SDK 公共类型已变化，请运行 pnpm extension:sdk:generate 并提交生成结果。",
      );
    return "SDK 公共类型与 Rust IPC 绑定一致。";
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, generated, "utf8");
  return "已从 Rust IPC 绑定生成 sdk/generated/protocol.d.ts。";
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check") || args.length > 1)
    throw new Error(
      "Usage: node scripts/generate-extension-sdk-types.mjs [--check]",
    );
  console.log(
    await generateExtensionSdkTypes(resolve(import.meta.dirname, ".."), {
      check: args.includes("--check"),
    }),
  );
}
