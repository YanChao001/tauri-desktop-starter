import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { applyFileChanges, projectFile } from "./fs-utils.mjs";

const PREVIEWS = [
  ["desktop-light.png", "preview-light.png"],
  ["desktop-dark.png", "preview-dark.png"],
  ["desktop-skins-dark.png", "skins-dark.png"],
];
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readScreenshot(root, path) {
  let file;
  try {
    file = projectFile(root, path);
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error(
        `缺少截图：${path}。请运行 pnpm docs:capture --interactive，或将 CI 的 readme-previews-windows 产物下载到 artifacts/e2e/previews/ 后运行 pnpm docs:previews。`,
        { cause: error },
      );
    throw error;
  }
  if (lstatSync(file).size > 20 * 1024 * 1024)
    throw new Error(`原生截图超过 20 MiB：${path}`);
  const content = readFileSync(file);
  if (
    content.length < 45 ||
    !content.subarray(0, 8).equals(PNG_SIGNATURE) ||
    content.readUInt32BE(8) !== 13 ||
    content.toString("ascii", 12, 16) !== "IHDR" ||
    content.readUInt32BE(content.length - 12) !== 0 ||
    content.toString("ascii", content.length - 8, content.length - 4) !== "IEND"
  )
    throw new Error(`原生截图不是完整的 PNG：${path}`);
  const width = content.readUInt32BE(16);
  const height = content.readUInt32BE(20);
  if (width < 880 || height < 600 || width > 8192 || height > 8192)
    throw new Error(
      `原生截图尺寸不符合桌面窗口范围：${path}（${width}×${height}）`,
    );
  return { content, width, height };
}

function checkWindowSizes(screenshots) {
  if (
    screenshots[0].width !== screenshots[1].width ||
    screenshots[0].height !== screenshots[1].height
  )
    throw new Error("README 明暗截图的窗口尺寸不一致，请重新采集同一轮截图。");
}

/** 只检查已提交图片的格式和尺寸，不要求采集产物，也不判断画面是否过时。 */
export function validateReadmePreviews(root) {
  const screenshots = PREVIEWS.map(([, destination]) =>
    readScreenshot(root, `docs/assets/${destination}`),
  );
  checkWindowSizes(screenshots);
}

/** 只同步约定的原生截图；先验证全部输入，避免缺图时更新到一半。 */
export function updateReadmePreviews(root, { check = false } = {}) {
  const screenshots = PREVIEWS.map(([source]) =>
    readScreenshot(root, `artifacts/e2e/previews/${source}`),
  );
  checkWindowSizes(screenshots);
  const changes = PREVIEWS.map(([, destination], index) => {
    const path = `docs/assets/${destination}`;
    return {
      path,
      before: readFileSync(projectFile(root, path)),
      content: screenshots[index].content,
    };
  }).filter(({ before, content }) => !before.equals(content));
  if (check && changes.length)
    throw new Error(
      `README 截图与原生结果不一致，请运行 pnpm docs:previews：\n${changes.map(({ path }) => `  ${path}`).join("\n")}`,
    );
  if (!check) applyFileChanges({ root, changes });
  return changes.map(({ path }) => path);
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const args = process.argv.slice(2);
    if (
      args.some(
        (arg) => !["--check", "--validate", "--help", "-h"].includes(arg),
      ) ||
      (args.includes("--check") && args.includes("--validate"))
    )
      throw new Error("用法: pnpm docs:previews [--check | --validate]");
    if (args.includes("--help") || args.includes("-h"))
      console.log(
        "将 artifacts/e2e/previews/ 的 Windows 原生截图同步到 docs/assets/。--check 比较采集结果，不写文件；--validate 只检查 docs/assets/ 图片格式和尺寸。此命令不启动应用。",
      );
    else if (args.includes("--validate")) {
      validateReadmePreviews(resolve(import.meta.dirname, ".."));
      console.log("README 截图格式与尺寸检查通过。");
    } else {
      const changed = updateReadmePreviews(resolve(import.meta.dirname, ".."), {
        check: args.includes("--check"),
      });
      console.log(
        `README 截图${args.includes("--check") ? "检查通过" : "同步完成"}：${changed.length} 个文件更新。`,
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
