// @vitest-environment node
import { expect, it } from "vitest";
import { mergeTextDiff, textDiff } from "./text-diff";

it("逐块选择可组合两边的修改，默认完整保留本地文本", () => {
  const diff = textDiff(
    "start\nlocal\nmiddle\nkeep\nend\n",
    "start\nother\nmiddle\nnew\nend\n",
  );
  const changes = diff.filter((block) => block.changed);
  expect(changes).toHaveLength(2);
  expect(mergeTextDiff(diff, { [changes[0]!.id]: "remote" })).toBe(
    "start\nother\nmiddle\nkeep\nend\n",
  );
});

it("空文本、空行、CRLF、删除和尾换行均可无损选择任一侧", () => {
  const samples = [
    "",
    "\n",
    "a",
    "a\n",
    "a\r\nb\r\n",
    "中文\n\n结尾",
    "a\nb\na",
  ];
  for (const local of samples)
    for (const remote of samples) {
      const diff = textDiff(local, remote);
      expect(mergeTextDiff(diff, {})).toBe(local);
      expect(
        mergeTextDiff(
          diff,
          Object.fromEntries(diff.map((block) => [block.id, "remote"])),
        ),
      ).toBe(remote);
    }
});

it("大文本退化为完整变更块，显示截断不截断实际合并数据", () => {
  const local = "old\n".repeat(2000),
    remote = "new\n".repeat(2000);
  const diff = textDiff(local, remote);
  expect(diff.filter((block) => block.changed)).toHaveLength(1);
  expect(
    mergeTextDiff(
      diff,
      Object.fromEntries(diff.map((block) => [block.id, "remote"])),
    ),
  ).toBe(remote);
});
