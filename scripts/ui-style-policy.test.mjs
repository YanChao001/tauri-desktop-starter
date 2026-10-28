import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const stylesheetPaths = [
  "src/styles/surface-tokens.css",
  "src/styles/control-styles.css",
];
const read = (path) => readFile(resolve(root, path), "utf8");

// 这些 slot 不拥有独立表面：逻辑节点、文字布局和图像沿用其控件的材质。
// 只列既有语义，不按文件或名称前缀放行；新增控件须接入共享规则或显式声明角色。
const inheritedSlots = new Map([
  [
    "逻辑节点、Portal 与贡献位置不绘制独立表面",
    [
      "dialog",
      "dialog-portal",
      "dialog-trigger",
      "dialog-close",
      "dropdown-menu",
      "dropdown-menu-portal",
      "dropdown-menu-trigger",
      "dropdown-menu-sub",
      "popover",
      "popover-trigger",
      "popover-anchor",
      "select",
      "tooltip",
      "tooltip-provider",
      "tooltip-trigger",
    ],
  ],
  [
    "文字、布局与分组继承父级阅读面，避免逐层叠加磨砂",
    [
      "accordion",
      "accordion-item",
      "accordion-content",
      "avatar",
      "avatar-group",
      "card-header",
      "card-title",
      "card-description",
      "card-action",
      "card-content",
      "dialog-header",
      "dialog-title",
      "dialog-description",
      "dropdown-menu-group",
      "dropdown-menu-radio-group",
      "dropdown-menu-label",
      "dropdown-menu-shortcut",
      "label",
      "popover-header",
      "popover-title",
      "popover-description",
      "radio-group",
      "scroll-area",
      "scroll-area-viewport",
      "select-group",
      "select-value",
      "slider",
      "select-label",
      "table-container",
      "table-body",
      "table-head",
      "table-cell",
      "table-caption",
      "tabs",
      "tabs-content",
      "toggle-group",
    ],
  ],
  [
    "图像与指示图标沿用内容和所属控件，不是阅读面板",
    [
      "avatar-image",
      "accordion-trigger-icon",
      "checkbox-indicator",
      "radio-group-indicator",
      "dropdown-menu-checkbox-item-indicator",
      "dropdown-menu-radio-item-indicator",
    ],
  ],
]);
const inherited = new Set([...inheritedSlots.values()].flat());
const surfaceRoles = new Set([
  "panel",
  "control",
  "popover",
  "reading",
  "solid",
  "transparent",
  "artwork",
]);

function parse(source, path = "probe.tsx") {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}
function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}
function literalAttribute(node, name) {
  const attribute = node.attributes.properties.find(
    (property) =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
  if (!attribute?.initializer) return null;
  const value = ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression
    : attribute.initializer;
  return value &&
    (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))
    ? value.text
    : null;
}
function slotsIn(source, path) {
  const file = parse(source, path);
  const slots = [];
  walk(file, (node) => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node))
      return;
    const slot = literalAttribute(node, "data-slot");
    if (!slot) return;
    slots.push({
      slot,
      tag: node.tagName.getText(file),
      surface: literalAttribute(node, "data-surface"),
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
    });
  });
  return slots;
}
function localMaterialClasses(source, path) {
  const file = parse(source, path);
  const cvaNames = new Set(["cva"]);
  walk(file, (node) => {
    if (
      ts.isImportSpecifier(node) &&
      (node.propertyName?.text ?? node.name.text) === "cva"
    )
      cvaNames.add(node.name.text);
  });
  const found = new Map();
  const inspect = (expression) => {
    walk(expression, (node) => {
      if (
        ![
          ts.SyntaxKind.StringLiteral,
          ts.SyntaxKind.NoSubstitutionTemplateLiteral,
          ts.SyntaxKind.TemplateHead,
          ts.SyntaxKind.TemplateMiddle,
          ts.SyntaxKind.TemplateTail,
        ].includes(node.kind) ||
        node.parent?.name === node
      )
        return;
      const classes = node.text
        .split(/\s+/)
        .filter((token) =>
          /(?:^|:)!?(?:bg-(?!blend-)|backdrop-blur(?:-|!|$))/.test(token),
        );
      if (classes.length)
        found.set(
          node.getStart(file),
          `${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1} ${classes.join(" ")}`,
        );
    });
  };
  walk(file, (node) => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(file) === "className" &&
      node.initializer
    )
      inspect(node.initializer);
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      cvaNames.has(node.expression.text)
    )
      inspect(node);
  });
  return [...found.values()];
}
function hasUiButtonClass(node) {
  const containsBase = (value) =>
    value &&
    (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) &&
    value.text.split(/\s+/).includes("ui-button");
  const attribute = node.attributes.properties.find(
    (property) =>
      ts.isJsxAttribute(property) && property.name.getText() === "className",
  );
  if (!attribute?.initializer) return false;
  const value = ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression
    : attribute.initializer;
  if (containsBase(value)) return true;
  return (
    value &&
    ts.isCallExpression(value) &&
    ts.isIdentifier(value.expression) &&
    ["cn", "clsx", "classNames"].includes(value.expression.text) &&
    value.arguments.some(containsBase)
  );
}
function rawButtonsIn(source, path) {
  const file = parse(source, path);
  const buttons = [];
  walk(file, (node) => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node))
      return;
    const tag = node.tagName.getText(file);
    const type = literalAttribute(node, "type")?.toLowerCase();
    const rawButton = tag === "button" || tag.endsWith(".button");
    const buttonInput =
      (tag === "input" || tag.endsWith(".input")) &&
      ["button", "submit", "reset"].includes(type);
    if (!rawButton && !buttonInput) return;
    buttons.push({
      tag,
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
      classified:
        surfaceRoles.has(literalAttribute(node, "data-surface")) ||
        !!literalAttribute(node, "data-slot")?.trim() ||
        hasUiButtonClass(node),
    });
  });
  return buttons;
}
async function sourceTsxFiles(directory = "src") {
  const entries = await readdir(resolve(root, directory), {
    withFileTypes: true,
  });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory())
        return ["test", "tests", "__tests__"].includes(entry.name)
          ? []
          : sourceTsxFiles(path);
      return entry.isFile() &&
        path.endsWith(".tsx") &&
        !/\.(test|spec)\.tsx$/.test(path)
        ? [path]
        : [];
    }),
  );
  return paths.flat().sort();
}

// 只读取有声明的 CSS 规则前导，不把注释、content 字符串或空规则算作接线。
function selectorsIn(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [];
  const blocks = [];
  let start = 0;
  let quote = "";
  let parentheses = 0;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index++;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") parentheses++;
    else if (character === ")") parentheses--;
    else if (!parentheses && character === "{") {
      blocks.push({
        selector: source.slice(start, index).trim(),
        declaration: false,
      });
      start = index + 1;
    } else if (!parentheses && character === ";") {
      if (blocks.length && source.slice(start, index).includes(":"))
        blocks.at(-1).declaration = true;
      start = index + 1;
    } else if (!parentheses && character === "}") {
      const block = blocks.pop();
      if (
        block &&
        (block.declaration || source.slice(start, index).includes(":")) &&
        !block.selector.startsWith("@")
      )
        selectors.push(block.selector);
      start = index + 1;
    }
  }
  return selectors;
}
function mappedSlots(selectors) {
  return new Set(
    selectors
      .map(withoutNegation)
      .flatMap((selector) =>
        [
          ...selector.matchAll(
            /\[data-slot\s*=\s*["']?([a-z][a-z0-9-]*)["']?\s*\]/g,
          ),
        ].map((match) => match[1]),
      ),
  );
}
function withoutNegation(selector) {
  let result = "";
  for (let index = 0; index < selector.length; index++) {
    if (!selector.startsWith(":not(", index)) {
      result += selector[index];
      continue;
    }
    let depth = 1;
    let quote = "";
    index += 5;
    for (; index < selector.length && depth; index++) {
      const character = selector[index];
      if (quote) {
        if (character === "\\") index++;
        else if (character === quote) quote = "";
      } else if (character === '"' || character === "'") quote = character;
      else if (character === "(") depth++;
      else if (character === ")") depth--;
    }
    index--;
  }
  return result;
}
function nativeRule(tag, selectors) {
  // 语义标签已有完整默认规则时，不要求为同一原生输入再复制 data-slot 选择器。
  if (
    ![
      "input",
      "textarea",
      "select",
      "table",
      "thead",
      "tfoot",
      "tr",
      "th",
      "td",
      "progress",
      "meter",
      "details",
      "summary",
      "output",
      "kbd",
      "pre",
      "code",
    ].includes(tag)
  )
    return false;
  const pattern = new RegExp(`(?:^|[\\s(:,])${tag}(?=[\\s[.:),>+~]|$)`);
  return selectors.some((selector) => pattern.test(withoutNegation(selector)));
}

test("host and extension default styles load the same complete CSS sources", async () => {
  const [index, moduleSource, sdk, ...css] = await Promise.all([
    read("src/index.css"),
    read("src/lib/ui-theme.ts"),
    read("sdk/extension-ui.js"),
    ...stylesheetPaths.map(read),
  ]);
  const liveIndex = index.replace(/\/\*[\s\S]*?\*\//g, "");
  const imports = new Set(
    [...liveIndex.matchAll(/(?:^|[;\n])\s*@import\s+(["'])([^"']+)\1/g)].map(
      (match) => match[2],
    ),
  );
  for (const path of stylesheetPaths) {
    assert.ok(
      imports.has(`./${path.slice("src/".length)}`),
      `宿主未导入共享样式：${path}`,
    );
  }
  const layer =
    liveIndex
      .match(/@layer\s+([^;{}]+);/)?.[1]
      .split(",")
      .map((value) => value.trim()) ?? [];
  assert.ok(
    ["base", "starter-defaults", "utilities"].every((name) =>
      layer.includes(name),
    ) &&
      layer.indexOf("base") < layer.indexOf("starter-defaults") &&
      layer.indexOf("starter-defaults") < layer.indexOf("utilities"),
    "共享默认层应高于 reset、低于调用方 utilities，保留显式定制",
  );
  const cssByPath = new Map(
    stylesheetPaths.map((path, index) => [
      resolve(root, path),
      `${css[index]}\n:root { --ui-source-probe-${index}: shared; }`,
    ]),
  );
  const loaded = [];
  const exports = {};
  for (const source of css)
    assert.doesNotMatch(
      source.replace(/\/\*[\s\S]*?\*\//g, ""),
      /@(import|apply|theme|source|custom-variant)\b/,
      "共享 CSS 原文必须能在隔离文档中直接运行，不能依赖宿主构建指令或相对网络导入",
    );
  vm.runInNewContext(
    ts.transpileModule(moduleSource, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports,
      require(specifier) {
        assert.ok(
          specifier.endsWith(".css?raw"),
          `主题样式装配引入未知依赖：${specifier}`,
        );
        const path = specifier.startsWith("@/")
          ? resolve(root, "src", specifier.slice(2, -4))
          : resolve(root, "src/lib", specifier.slice(0, -4));
        assert.ok(cssByPath.has(path), `插件未使用约定共享样式：${path}`);
        loaded.push(path);
        return { __esModule: true, default: cssByPath.get(path) };
      },
    },
  );
  assert.equal(typeof exports.UI_STYLES, "string");
  assert.deepEqual([...new Set(loaded)].sort(), [...cssByPath.keys()].sort());
  for (const text of cssByPath.values())
    assert.equal(
      exports.UI_STYLES.split(text).length - 1,
      1,
      "插件快照必须传完整共享样式，不能按当前控件裁剪或维护拷贝",
    );

  let consumesThemeStyles = false;
  const duplicateCss = [];
  walk(parse(sdk, "extension-ui.js"), (node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "styles" &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "theme"
    )
      consumesThemeStyles = true;
    const text =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        ? node.text
        : ts.isTemplateExpression(node)
          ? node.head.text +
            node.templateSpans.map((span) => span.literal.text).join("")
          : "";
    if (
      /\{[^}]*\b(?:background|border|padding|font)\s*:/.test(text) &&
      /\b(?:button|input|textarea|select|kbd|output|table|progress|meter)\b/.test(
        text,
      )
    )
      duplicateCss.push(text.slice(0, 80));
  });
  assert.ok(consumesThemeStyles, "SDK 应消费当前宿主的 theme.styles");
  assert.deepEqual(duplicateCss, [], "SDK 不应再次硬编码基础控件 CSS");
});

test("new UI slots need a shared style rule or an explicit material role", async () => {
  const selectors = selectorsIn(
    (await Promise.all(stylesheetPaths.map(read))).join("\n"),
  );
  const mapped = mappedSlots(selectors);
  const directory = resolve(root, "src/components/ui");
  const paths = (await readdir(directory))
    .filter((path) => path.endsWith(".tsx"))
    .sort();
  const known = new Set();
  const missing = [];
  const localMaterials = [];
  for (const path of paths) {
    const source = await readFile(resolve(directory, path), "utf8");
    localMaterials.push(...localMaterialClasses(source, path));
    for (const entry of slotsIn(source, path)) {
      known.add(entry.slot);
      if (
        mapped.has(entry.slot) ||
        surfaceRoles.has(entry.surface) ||
        nativeRule(entry.tag, selectors) ||
        inherited.has(entry.slot)
      )
        continue;
      missing.push(`${path}:${entry.line} ${entry.slot}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    "新增控件尚未分类：在共享样式接线，或声明 data-surface 角色；不要新增局部实体底色\n" +
      missing.join("\n"),
  );
  const stale = [...inherited].filter((slot) => !known.has(slot));
  assert.deepEqual(stale, [], "删除或重命名 slot 后应移除失效的继承分类");
  assert.deepEqual(
    localMaterials,
    [],
    "React 适配器不能重复定义默认背景或磨砂：将 bg-* / backdrop-blur* 移到共享 CSS，调用方 className 定制仍可保留\n" +
      localMaterials.join("\n"),
  );
  assert.deepEqual(
    localMaterialClasses(
      `// className="bg-comment"
      import { cva as variants } from "class-variance-authority";
      const styles = variants("bg-muted", { variants: { active: { true: "hover:backdrop-blur-sm" } } });
      const Control = ({ className }) => <><div data-slot="bg-slot" className={className} /><div className="bg-blend-color h-8 p-2" /></>;`,
      "probe.tsx",
    ).map((entry) => entry.split(" ").slice(1).join(" ")),
    ["bg-muted", "hover:backdrop-blur-sm"],
    "只检查实际默认样式字符串，保留背景混合模式、布局和调用方定制",
  );
});

test("style policy reads actual JSX and nonempty CSS rules", () => {
  const source = `// data-slot="comment-only"
    const example = '<div data-slot="string-only" />';
    export const Control = () => <div data-slot="new-control" data-surface="reading" />;`;
  assert.deepEqual(
    slotsIn(source, "probe.tsx").map(({ slot, surface }) => ({
      slot,
      surface,
    })),
    [{ slot: "new-control", surface: "reading" }],
  );
  assert.deepEqual(
    [
      ...mappedSlots(
        selectorsIn(`
    /* [data-slot="comment-only"] { background: red; } */
    [data-slot="empty-rule"] {}
      :not([data-slot="negative-only"]) { color: CanvasText; }
    @media (forced-colors: active) {
      [data-slot="new-control"] { color: CanvasText; }
    }
    .content::after { content: '[data-slot="string-only"]'; }
  `),
      ),
    ],
    ["new-control"],
  );
});

test("raw application buttons declare their material instead of inheriting native primary geometry", async (context) => {
  const probe = `export const Probe = () => <>
    <button /><motion.button /><input type="submit" />
    <button className="ui-buttonish" />
    <Button /><ButtonPrimitive.Root /><input type="checkbox" />
    <button data-surface="transparent" />
    <motion.button data-slot="button" />
    <input type="reset" className={cn("ui-button", "w-full")} />
  </>;`;
  assert.deepEqual(
    rawButtonsIn(probe, "probe.tsx")
      .filter((entry) => !entry.classified)
      .map((entry) => entry.tag),
    ["button", "motion.button", "input", "button"],
    "原生按钮必须显式接线；组件适配器与非按钮输入不应被误报",
  );
  const missing = [];
  let count = 0;
  for (const path of await sourceTsxFiles()) {
    const buttons = rawButtonsIn(await read(path), path);
    count += buttons.length;
    for (const button of buttons)
      if (!button.classified)
        missing.push(`${path}:${button.line} <${button.tag}>`);
  }
  assert.deepEqual(
    missing,
    [],
    "手写按钮未声明材质：添加 data-surface、data-slot 或 ui-button 基础类，避免热区和排序按钮被默认主按钮几何覆盖\n" +
      missing.join("\n"),
  );
  context.diagnostic(`已检查 ${count} 个原生及动效按钮，没有路径豁免。`);
});
