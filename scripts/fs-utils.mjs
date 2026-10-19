import { lstatSync, realpathSync, rmSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

function inside(root, path) {
  const offset = relative(root, path);
  return (
    offset !== "" &&
    offset !== ".." &&
    !offset.startsWith(`..${sep}`) &&
    !isAbsolute(offset)
  );
}

/** 只删除项目内路径；祖先 junction/symlink 不得把删除导向项目外。 */
export function removeProjectPath(root, path) {
  const base = realpathSync(root);
  const target = resolve(base, path);
  if (!inside(base, target)) throw new Error(`拒绝删除项目外路径：${target}`);
  try {
    lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  const parent = realpathSync(dirname(target));
  if (parent !== base && !inside(base, parent)) {
    throw new Error(`拒绝通过目录链接删除项目外路径：${target}`);
  }
  // rmSync 删除顶层链接本身，不遍历链接目标。
  rmSync(target, { recursive: true, force: true });
  return true;
}
