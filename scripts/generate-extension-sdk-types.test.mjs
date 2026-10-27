import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  generateExtensionSdkTypes,
  renderExtensionSdkProtocol,
} from "./generate-extension-sdk-types.mjs";

const root = resolve(import.meta.dirname, "..");

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "starter-sdk-types-"));
  assert.equal(dirname(directory), resolve(tmpdir()));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("公开 DTO 自动包含递归与新增传递依赖，排除宿主命令和无关类型", async () => {
  const sdk = 'import type { Root } from "./generated/protocol";';
  const bindings = `
    import type { Channel } from "@tauri-apps/api/core";
    export const commands = { invoke() {} };
    export type UnrelatedHostState = { channel: Channel<string> };
    export type Root = { child: Child<string> };
    export type Child<T> = { data: Record<string, T>; next: Root | null };
  `;
  const output = await renderExtensionSdkProtocol(bindings, sdk);
  assert.match(output, /export type Root/);
  assert.match(output, /export type Child<T>/);
  assert.doesNotMatch(output, /commands|UnrelatedHostState|Channel|@tauri/);
  const changed = await renderExtensionSdkProtocol(
    bindings.replace("next: Root | null", "next: Added | null") +
      "export interface Added { owner: Root }",
    sdk,
  );
  assert.match(changed, /export interface Added/);
  assert.notEqual(changed, output);
  await assert.rejects(
    renderExtensionSdkProtocol(
      bindings.replace("child: Child<string>", "child: Channel<string>"),
      sdk,
    ),
    /未闭合的类型引用：Channel/,
  );
  await assert.rejects(
    renderExtensionSdkProtocol(
      bindings.replace("child: Child<string>", "child: typeof commands"),
      sdk,
    ),
    /不能依赖运行时值或外部模块/,
  );
  await assert.rejects(
    renderExtensionSdkProtocol("export type Another = string;", sdk),
    /缺少公开 DTO：Root/,
  );
});

test("检查模式拒绝缺失或漂移的 SDK 产物，生成后可重新验证", async (t) => {
  const directory = await temporaryDirectory(t);
  await mkdir(join(directory, "src/lib/generated"), { recursive: true });
  await mkdir(join(directory, "sdk"));
  await writeFile(
    join(directory, "src/lib/generated/bindings.ts"),
    "export type Root = { value: string };\n",
  );
  await writeFile(
    join(directory, "sdk/extension-ui.d.ts"),
    'import type { Root } from "./generated/protocol";\n',
  );
  await assert.rejects(
    generateExtensionSdkTypes(directory, { check: true }),
    /extension:sdk:generate/,
  );
  await generateExtensionSdkTypes(directory);
  await generateExtensionSdkTypes(directory, { check: true });
  await writeFile(
    join(directory, "src/lib/generated/bindings.ts"),
    "export type Root = { value: number };\n",
  );
  await assert.rejects(
    generateExtensionSdkTypes(directory, { check: true }),
    /公共类型已变化/,
  );
  await generateExtensionSdkTypes(directory);
  await generateExtensionSdkTypes(directory, { check: true });
});

test("只复制 SDK 到仓库外即可完整编译，仍拒绝未知服务、资源动作与宿主身份", async (t) => {
  await generateExtensionSdkTypes(root, { check: true });
  const directory = await temporaryDirectory(t);
  await cp(join(root, "sdk"), join(directory, "sdk"), { recursive: true });
  const filename = join(directory, "plugin.ts");
  await writeFile(
    filename,
    `
      import type { ExtensionUiApi, ExtensionUiSnapshot } from "./sdk/extension-ui";
      declare const api: ExtensionUiApi;
      declare const snapshot: ExtensionUiSnapshot;
      declare const root: ShadowRoot;
      const dispose: () => void = api.applyStyles(root);
      dispose();
      const view: Promise<NonNullable<ExtensionUiSnapshot["view"]>> = api.run("refresh");
      const fields: string | undefined = snapshot.view?.fields[0]?.id;
      api.services.request("resources", { action: "preview", resourceId: "image" });
      api.services.request("links", { url: "https://example.com" });
      // @ts-expect-error 只允许注册的宿主服务。
      api.services.request("shell", { command: "run" });
      // @ts-expect-error 图片资源只能使用已注册动作。
      api.services.request("resources", { action: "execute" });
      // @ts-expect-error 插件不能自述宿主身份。
      api.services.request("links", { url: "https://example.com", expectedGeneration: 2 });
      // @ts-expect-error SDK 不公开通用宿主命令。
      import { commands } from "./sdk/generated/protocol";
      void view; void fields; void commands;
    `,
  );
  const program = ts.createProgram([filename], {
    noEmit: true,
    strict: true,
    skipLibCheck: false,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
  });
  assert.deepEqual(
    ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      ),
    [],
  );
  const protocol = await readFile(
    join(directory, "sdk/generated/protocol.d.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    protocol,
    /@tauri-apps|\.\.\/src\/|export const commands/,
  );
});
