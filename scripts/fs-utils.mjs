import { randomUUID } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

function inside(root, path) {
  const offset = relative(root, path);
  return (
    offset !== "" &&
    offset !== ".." &&
    !offset.startsWith(`..${sep}`) &&
    !isAbsolute(offset)
  );
}

/** 只允许修改项目内的普通文件，不跟随文件链接或项目外的目录链接。 */
export function projectFile(root, path) {
  const base = realpathSync(root);
  const target = resolve(base, path);
  const info = lstatSync(target);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    !inside(base, target) ||
    !inside(base, realpathSync(target))
  )
    throw new Error(
      `Refusing to modify directory links or files outside the project: ${path}`,
    );
  return target;
}

function contentsEqual(path, expected) {
  return readFileSync(path).equals(
    Buffer.isBuffer(expected) ? expected : Buffer.from(expected, "utf8"),
  );
}

/** 支持文本与 Buffer；先暂存全部文件，失败回滚，并发编辑时保留原件备份。 */
export function applyFileChanges(
  { root, changes },
  { beforeCommit = () => {} } = {},
) {
  root = realpathSync(root);
  const staged = [];
  const committed = [];
  const assertParent = (entry) => {
    if (realpathSync(dirname(entry.target)) !== entry.parent)
      throw new Error(
        `File directory was replaced after preflight: ${entry.path}`,
      );
    if (entry.parent !== root && !inside(root, entry.parent))
      throw new Error(
        `File directory has moved outside the project: ${entry.path}`,
      );
  };
  try {
    for (const change of changes) {
      const target = projectFile(root, change.path);
      if (!contentsEqual(target, change.before))
        throw new Error(`File was modified after preflight: ${change.path}`);
      const token = randomUUID();
      const temporary = join(dirname(target), `.update-${token}.tmp`);
      const backup = join(dirname(target), `.update-${token}.bak`);
      staged.push({
        ...change,
        target,
        temporary,
        backup,
        parent: realpathSync(dirname(target)),
      });
      writeFileSync(temporary, change.content, {
        flag: "wx",
        mode: lstatSync(target).mode,
      });
    }
    for (const [index, entry] of staged.entries()) {
      beforeCommit(index, entry);
      assertParent(entry);
      if (!contentsEqual(projectFile(root, entry.path), entry.before))
        throw new Error(`File was modified before commit: ${entry.path}`);
      renameSync(entry.target, entry.backup);
      committed.push(entry);
      renameSync(entry.temporary, entry.target);
    }
  } catch (error) {
    const failures = [];
    for (const entry of committed.reverse()) {
      try {
        assertParent(entry);
        try {
          if (!contentsEqual(projectFile(root, entry.path), entry.content))
            throw new Error(
              `Rollback target was modified concurrently: ${entry.path}`,
              {
                cause: error,
              },
            );
          unlinkSync(entry.target);
        } catch (failure) {
          if (failure.code !== "ENOENT") throw failure;
        }
        renameSync(entry.backup, entry.target);
      } catch (failure) {
        failures.push(`${entry.backup}: ${failure.message}`);
      }
    }
    if (failures.length)
      throw new Error(
        `${error.message}\nRecovery failed; backups retained: ${failures.join("; ")}`,
        {
          cause: error,
        },
      );
    throw error;
  } finally {
    for (const entry of staged)
      try {
        assertParent(entry);
        unlinkSync(entry.temporary);
      } catch (error) {
        if (error.code !== "ENOENT") console.warn(error.message);
      }
  }
  for (const entry of staged) {
    try {
      assertParent(entry);
      unlinkSync(entry.backup);
    } catch (error) {
      console.warn(
        `File updates completed; the previous backup could not be removed. Check ${entry.backup}: ${error.message}`,
      );
    }
  }
}

/** 只删除项目内路径；祖先 junction/symlink 不得把删除导向项目外。 */
export function removeProjectPath(root, path) {
  const base = realpathSync(root);
  const target = resolve(base, path);
  if (!inside(base, target))
    throw new Error(`Refusing to remove a path outside the project: ${target}`);
  try {
    lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  const parent = realpathSync(dirname(target));
  if (parent !== base && !inside(base, parent)) {
    throw new Error(
      `Refusing to remove a path outside the project through a directory link: ${target}`,
    );
  }
  // rmSync 删除顶层链接本身，不遍历链接目标。
  rmSync(target, { recursive: true, force: true });
  return true;
}
