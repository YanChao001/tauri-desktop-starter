export type DiffBlock = {
  id: number;
  changed: boolean;
  local: string[];
  remote: string[];
};
export type DiffChoices = Readonly<Record<number, "local" | "remote">>;
const lines = (text: string) => (text === "" ? [] : text.split("\n"));

/** 行级 LCS 有面积上限；大文本保留完整变更块，避免二次方内存占用。 */
export function textDiff(local: string, remote: string): DiffBlock[] {
  if (local.length > 200000 || remote.length > 200000)
    return [
      {
        id: 0,
        changed: local !== remote,
        local: local === "" ? [] : [local],
        remote: remote === "" ? [] : [remote],
      },
    ];
  const a = lines(local),
    b = lines(remote);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  const result: DiffBlock[] = [];
  const add = (changed: boolean, left: string[], right: string[]) => {
    if (left.length || right.length)
      result.push({ id: result.length, changed, local: left, remote: right });
  };
  add(false, a.slice(0, start), b.slice(0, start));
  const left = a.slice(start, a.length - end),
    right = b.slice(start, b.length - end);
  if (left.length * right.length > 250000 || left.length + right.length > 2000)
    add(true, left, right);
  else {
    const width = right.length + 1;
    const matrix = new Uint16Array((left.length + 1) * width);
    for (let i = left.length - 1; i >= 0; i--)
      for (let j = right.length - 1; j >= 0; j--) {
        matrix[i * width + j] =
          left[i] === right[j]
            ? (matrix[(i + 1) * width + j + 1] ?? 0) + 1
            : Math.max(
                matrix[(i + 1) * width + j] ?? 0,
                matrix[i * width + j + 1] ?? 0,
              );
      }
    let i = 0,
      j = 0;
    let same: string[] = [],
      old: string[] = [],
      next: string[] = [];
    const flushChange = () => {
      add(true, old, next);
      old = [];
      next = [];
    };
    const flushSame = () => {
      add(false, same, same);
      same = [];
    };
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) {
        flushChange();
        same.push(left[i] ?? "");
        i++;
        j++;
      } else {
        flushSame();
        if (
          i < left.length &&
          (j === right.length ||
            (matrix[(i + 1) * width + j] ?? 0) >=
              (matrix[i * width + j + 1] ?? 0))
        )
          old.push(left[i++] ?? "");
        else next.push(right[j++] ?? "");
      }
    }
    flushChange();
    flushSame();
  }
  if (end) add(false, a.slice(a.length - end), b.slice(b.length - end));
  return result;
}

export function mergeTextDiff(
  blocks: readonly DiffBlock[],
  choices: DiffChoices,
): string {
  return blocks
    .flatMap((block) =>
      block.changed && choices[block.id] === "remote"
        ? block.remote
        : block.local,
    )
    .join("\n");
}
