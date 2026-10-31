import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { buildEnvironment } from "./build-lib.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const FRAME_LIMIT = 32 * 1024 * 1024;
const IO_LIMIT = 4 * 1024 * 1024;
const ECHO = `(module
  (import "extism:host/env" "input_offset" (func $offset (result i64)))
  (import "extism:host/env" "input_length" (func $length (result i64)))
  (import "extism:host/env" "output_set" (func $output (param i64 i64)))
  (func (export "run") (result i32)
    (call $output (call $offset) (call $length)) (i32.const 0)))`;

async function executable() {
  if (process.env.STARTER_EXTENSION_TOOL)
    return resolve(process.env.STARTER_EXTENSION_TOOL);
  const build = spawn(
    "cargo",
    [
      "build",
      "--locked",
      "--manifest-path",
      join(ROOT, "src-tauri/Cargo.toml"),
      "--bin",
      "extension-tool",
      "--message-format=json",
    ],
    {
      cwd: ROOT,
      env: buildEnvironment(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  let path;
  const lines = createInterface({ input: build.stdout });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (
      message.reason === "compiler-artifact" &&
      message.target?.name === "extension-tool" &&
      message.executable
    )
      path = message.executable;
  });
  const result = await new Promise((resolve_, reject) => {
    build.on("error", reject);
    build.on("close", resolve_);
  });
  if (result !== 0 || !path)
    throw new Error("无法构建无界面 extension-tool worker");
  return path;
}

const tool = await executable();

function worker() {
  const child = spawn(tool, ["--extension-worker"], {
    cwd: ROOT,
    env: {},
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffered = Buffer.alloc(0);
  const replies = [];
  const waiting = [];
  let closed = false;
  let failure;
  function fail(error) {
    failure = error;
    for (const waiter of waiting.splice(0)) waiter.reject(error);
  }
  child.on("error", fail);
  child.stdout.on("data", (data) => {
    buffered = Buffer.concat([buffered, data]);
    try {
      while (buffered.length >= 4) {
        const length = buffered.readUInt32BE(0);
        assert.ok(length > 0 && length <= FRAME_LIMIT);
        if (buffered.length < length + 4) return;
        const reply = JSON.parse(buffered.subarray(4, length + 4));
        buffered = buffered.subarray(length + 4);
        const waiter = waiting.shift();
        if (waiter) waiter.resolve(reply);
        else replies.push(reply);
      }
    } catch (error) {
      fail(error);
      child.kill();
    }
  });
  const exit = new Promise((resolve_) => {
    child.on("close", (code, signal) => {
      closed = true;
      fail(new Error(`worker 已退出：${code ?? signal}`));
      resolve_({ code, signal });
    });
  });
  // 异常帧测试会在写入同时退出；错误由 exit / reply 统一报告。
  child.stdin.on("error", () => {});
  child.stderr.resume();
  function send(request) {
    const payload = Buffer.from(JSON.stringify(request));
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(payload.length);
    child.stdin.write(prefix);
    child.stdin.write(payload);
  }
  async function reply() {
    if (replies.length) return replies.shift();
    if (failure) throw failure;
    let timer;
    try {
      return await Promise.race([
        new Promise((resolve_, reject) => {
          waiting.push({ resolve: resolve_, reject });
        }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("worker 响应超时")),
            20_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function exited() {
    let timer;
    try {
      return await Promise.race([
        exit,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("worker 退出超时")), 3000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    child,
    send,
    reply,
    exited,
    async close() {
      if (!closed) child.kill();
      await exit;
    },
  };
}

function request(module, operation) {
  return { module: Buffer.from(module).toString("base64"), operation };
}

function run(
  module = ECHO,
  input = "Hello 世界",
  function_ = "run",
  executionBudget = "standard",
) {
  return request(module, {
    action: "run",
    function: function_,
    input: Buffer.from(input).toString("base64"),
    executionBudget,
  });
}

await test("固定 worker 复用进程、隔离实例并承载完整 4 MiB 输入输出", async (t) => {
  const session = worker();
  t.after(() => session.close());
  session.send(run());
  assert.deepEqual(await session.reply(), { Ok: "Hello 世界" });
  const input = "x".repeat(IO_LIMIT);
  session.send(run(ECHO, input));
  assert.deepEqual(await session.reply(), { Ok: input });
  session.send(run(ECHO, `${input}x`));
  assert.equal((await session.reply()).Err.kind, "failed");
  // 连续切换不同模块，覆盖编译缓存淘汰后的重新执行。
  for (let number = 0; number < 6; number += 1) {
    const module = `(module (global $count (mut i32) (i32.const ${number}))
      (func (export "run") (result i32) (global.set $count (i32.add (global.get $count) (i32.const 1)))
      (i32.sub (global.get $count) (i32.const ${number + 1}))))`;
    for (let invocation = 0; invocation < 2; invocation += 1) {
      session.send(run(module, ""));
      assert.deepEqual(await session.reply(), { Ok: "" });
    }
  }
  session.child.stdin.end();
  assert.equal((await session.exited()).code, 0);
});

await test("编译预热不执行初始化，后续调用仍使用隔离实例", async (t) => {
  const session = worker();
  t.after(() => session.close());
  const initializer = `(module (func $init unreachable) (start $init)
    (func (export "run") (result i32) (i32.const 0)))`;
  session.send(request(initializer, { action: "prepare" }));
  assert.deepEqual(await session.reply(), { Ok: "" });
  session.send(run(initializer));
  assert.match((await session.reply()).Err.message, /initialize/);

  const counter = `(module (global $count (mut i32) (i32.const 0))
    (func (export "run") (result i32)
      (global.set $count (i32.add (global.get $count) (i32.const 1)))
      (i32.sub (global.get $count) (i32.const 1))))`;
  session.send(request(counter, { action: "prepare" }));
  assert.deepEqual(await session.reply(), { Ok: "" });
  for (let invocation = 0; invocation < 2; invocation += 1) {
    session.send(run(counter, ""));
    assert.deepEqual(await session.reply(), { Ok: "" });
  }
  session.send(request("not wasm", { action: "prepare" }));
  assert.match((await session.reply()).Err.message, /compile/);
  session.send(run());
  assert.deepEqual(await session.reply(), { Ok: "Hello 世界" });
});

await test("预检不执行初始化，并提供脱敏的编译、导出及 fuel 诊断", async (t) => {
  const session = worker();
  t.after(() => session.close());
  const initializer = `(module (func $init unreachable) (start $init)
    (func (export "run") (result i32) (i32.const 0)))`;
  session.send(request(initializer, { action: "validate", exports: ["run"] }));
  assert.deepEqual(await session.reply(), { Ok: "" });
  session.send(run(initializer));
  assert.match((await session.reply()).Err.message, /initialize/);
  session.send(run("not wasm"));
  assert.match((await session.reply()).Err.message, /compile/);
  session.send(run(ECHO, "", "missing"));
  assert.match((await session.reply()).Err.message, /export/);
  session.send(
    run(`(module (func (export "run") (result i32)
      (loop $spin (br $spin)) (i32.const 0)))`),
  );
  assert.match((await session.reply()).Err.message, /fuel/);
  session.send(run());
  assert.deepEqual(await session.reply(), { Ok: "Hello 世界" });
});

await test("compute 预算支持有界重放，后续 standard 不继承放大的 fuel", async (t) => {
  const session = worker();
  t.after(() => session.close());
  const module = `(module
    (func (export "run") (result i32) (local $remaining i32)
      (local.set $remaining (i32.const 20000000))
      (loop $work
        (local.set $remaining (i32.sub (local.get $remaining) (i32.const 1)))
        (br_if $work (local.get $remaining)))
      (i32.const 0)))`;
  session.send(
    request(module, { action: "prepare", executionBudget: "compute" }),
  );
  assert.deepEqual(await session.reply(), { Ok: "" });
  session.send(run(module, ""));
  assert.match((await session.reply()).Err.message, /fuel/);
  session.send(run(module, "", "run", "compute"));
  assert.deepEqual(await session.reply(), { Ok: "" });
  session.send(run(module, ""));
  assert.match((await session.reply()).Err.message, /fuel/);
  session.send(run());
  assert.deepEqual(await session.reply(), { Ok: "Hello 世界" });
});

await test("异常、超长和未定义协议帧立即退出，不启动桌面应用", async (t) => {
  for (const frame of [
    Buffer.alloc(4),
    Buffer.from([255, 255, 255, 255]),
    Buffer.from([0, 0, 0, 1, 123]),
  ]) {
    const session = worker();
    t.after(() => session.close());
    session.child.stdin.write(frame);
    assert.equal((await session.exited()).code, 2);
  }
  const session = worker();
  t.after(() => session.close());
  session.send({
    module: "AA==",
    operation: { action: "shell", command: "never-run" },
  });
  assert.equal((await session.exited()).code, 2);
  const unknownBudget = worker();
  t.after(() => unknownBudget.close());
  unknownBudget.send(
    request(ECHO, {
      action: "run",
      function: "run",
      input: "",
      executionBudget: "unlimited",
    }),
  );
  assert.equal((await unknownBudget.exited()).code, 2);
});

await test("父进程关闭输入管道时中止正在处理的模块", async (t) => {
  const session = worker();
  t.after(() => session.close());
  session.send(
    run(`(module (func $init (loop $spin (br $spin))) (start $init)
      (func (export "run") (result i32) (i32.const 0)))`),
  );
  session.child.stdin.end();
  assert.equal((await session.exited()).code, 0);
});

await test("CLI 取消回收宿主 worker 并核验错误，不继承 WASI 输出环境", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-extension-worker-"));
  try {
    const manifest = JSON.parse(
      await readFile(
        join(ROOT, "src-tauri/test-fixtures/extension-runtime/extension.json"),
        "utf8",
      ),
    );
    manifest.commands = [
      { ...manifest.commands[0], id: "run", function: "run" },
      {
        ...manifest.commands[0],
        id: "warm-compute",
        function: "run",
        executionBudget: "compute",
      },
      {
        ...manifest.commands[0],
        id: "spin",
        function: "spin",
        executionBudget: "compute",
      },
    ];
    manifest.minHostVersion = "0.1.7";
    const manifestPath = join(directory, "extension.json");
    const modulePath = join(directory, "plugin.wasm");
    const fixturePath = join(directory, "fixture.json");
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(
      modulePath,
      `${ECHO.slice(0, -1)} (func (export "spin") (result i32)
        (loop $spin (br $spin)) (i32.const 0)))`,
    );
    await writeFile(
      fixturePath,
      JSON.stringify([
        { command: "run", input: "before", expectOutput: "before" },
        { command: "warm-compute", input: "ready", expectOutput: "ready" },
        {
          command: "spin",
          input: "",
          // Warm the exact compute variant before testing cancellation while
          // its spin runs; a standard compilation has a different cache key.
          cancelAfterMs: 150,
          expectError: "USER_CANCELLED",
        },
        { command: "run", input: "after", expectOutput: "after" },
      ]),
    );
    async function fixture() {
      const child = spawn(
        tool,
        [
          "test",
          "--manifest",
          manifestPath,
          "--wasm",
          modulePath,
          "--fixture",
          fixturePath,
        ],
        {
          cwd: ROOT,
          env: { ...process.env, EXTISM_ENABLE_WASI_OUTPUT: "1" },
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const chunks = [];
      const errors = [];
      child.stdout.on("data", (chunk) => chunks.push(chunk));
      child.stderr.on("data", (chunk) => errors.push(chunk));
      const timer = setTimeout(() => child.kill(), 25_000);
      try {
        const code = await new Promise((resolve_, reject) => {
          child.on("error", reject);
          child.on("close", resolve_);
        });
        assert.equal(code, 0, Buffer.concat(errors).toString());
        return JSON.parse(Buffer.concat(chunks));
      } finally {
        clearTimeout(timer);
      }
    }
    const sequence = (await fixture()).smoke;
    assert.equal(sequence.length, 4);
    assert.ok(sequence.every((result) => result.passed));
    assert.equal(sequence[1].output, "ready");
    assert.equal(sequence[2].error.code, "USER_CANCELLED");
    assert.equal(sequence[3].output, "after");
    // fd_write 不能把 guest 输出注入 worker 的长度帧或 CLI JSON。
    manifest.commands.pop();
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(
      modulePath,
      `(module
        (import "wasi_snapshot_preview1" "fd_write" (func $write (param i32 i32 i32 i32) (result i32)))
        (memory (export "memory") 1) (data (i32.const 8) "private")
        (func (export "run") (result i32)
          (i32.store (i32.const 0) (i32.const 8))
          (i32.store (i32.const 4) (i32.const 7))
          (drop (call $write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 32)))
          (i32.const 0)))`,
    );
    await writeFile(
      fixturePath,
      JSON.stringify({ command: "run", input: "", expectOutput: "" }),
    );
    assert.equal((await fixture()).smoke.output, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
