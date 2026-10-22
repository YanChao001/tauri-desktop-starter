import { expect, it } from "vitest";
import {
  reorderAssets,
  workspaceReducer,
  type SampleAsset,
} from "./workspace-model";
const assets: readonly SampleAsset[] = [
  {
    id: "one",
    name: "one.md",
    content: "keep this",
    kind: "document",
    folder: "design",
  },
  {
    id: "two",
    name: "two.ts",
    content: "export {}",
    kind: "source",
    folder: "code",
  },
];
it("跨文件夹移动保留内容、顺序和唯一标识，非法拖放保持原状态", () => {
  const moved = reorderAssets(assets, "one", "two");
  expect(moved.map((item) => [item.id, item.folder, item.content])).toEqual([
    ["one", "code", "keep this"],
    ["two", "code", "export {}"],
  ]);
  expect(assets[0]?.folder).toBe("design");
  expect(reorderAssets(assets, "unknown", "two")).toBe(assets);
  expect(reorderAssets(assets, "one", "one")).toBe(assets);
});
it("撤销恢复编辑或删除前的快照，重置示例也可撤销", () => {
  const changed = workspaceReducer(
    { assets, previous: null },
    { type: "change", assets: assets.slice(1) },
  );
  const restored = workspaceReducer(changed, { type: "undo" });
  expect(restored.assets).toEqual(assets);
  expect(workspaceReducer(restored, { type: "undo" })).toBe(restored);
  const reset = workspaceReducer(changed, { type: "reset", assets });
  expect(workspaceReducer(reset, { type: "undo" }).assets).toEqual(
    assets.slice(1),
  );
});
