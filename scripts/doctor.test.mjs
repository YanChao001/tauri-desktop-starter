import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { diagnose, supportsNode } from "./doctor-lib.mjs";

test("Node engine ranges honor minimum patch and supported major releases", () => {
  const range = "^22.22.2 || ^24.15.0 || >=26.0.0";
  for (const version of ["v22.22.2", "24.15.0", "v26.0.1", "v28.0.0"])
    assert.equal(supportsNode(version, range), true);
  for (const version of ["v22.22.1", "v23.2.0", "v24.14.0", "v25.0.0"])
    assert.equal(supportsNode(version, range), false);
});

function options(overrides = {}) {
  return {
    platform: "win32",
    env: {},
    nodeVersion: "v22.22.2",
    exists: () => true,
    read(path) {
      return path.endsWith("package.json")
        ? JSON.stringify({
            engines: { node: "^22.22.2" },
            packageManager: "pnpm@12.14.0",
          })
        : '[toolchain]\nchannel = "1.99.1"';
    },
    probe(command) {
      if (/pnpm/.test(command)) return { ok: true, output: "12.14.0" };
      if (/rustc/.test(command))
        return { ok: true, output: "rustc 1.99.1 (hash date)" };
      if (/cargo/.test(command))
        return { ok: true, output: "cargo 1.99.1 (hash date)" };
      if (/vswhere/.test(command))
        return { ok: true, output: "C:\\BuildTools" };
      if (/powershell/.test(command))
        return { ok: true, output: '{"sdk":true,"webview":["150.0.1.2"]}' };
      return { ok: true, output: "git version 2.50.0" };
    },
    ...overrides,
  };
}

test("Windows readiness requires actual compiler, SDK and runtime probes", () => {
  const ready = diagnose(join("project"), options());
  assert.equal(ready.ok, true);
  const absent = diagnose(
    join("project"),
    options({ probe: () => ({ ok: false, output: "" }) }),
  );
  assert.equal(absent.ok, false);
  for (const name of [
    "pnpm",
    "rustc",
    "cargo",
    "MSVC C++ 工具",
    "Windows SDK",
    "WebView2 Runtime",
  ]) {
    const item = absent.checks.find((check) => check.name === name);
    assert.equal(item.status, "error");
    assert.ok(item.remedy);
  }
});

test("headless Linux is a warning while missing libraries remain errors", () => {
  const report = diagnose("project", options({ platform: "linux", env: {} }));
  assert.equal(report.ok, true);
  assert.equal(
    report.checks.find((item) => item.name === "桌面会话").status,
    "warning",
  );
  const missing = diagnose(
    "project",
    options({ platform: "linux", probe: () => ({ ok: false, output: "" }) }),
  );
  assert.equal(
    missing.checks.find((item) => item.name === "webkit2gtk-4.1").status,
    "error",
  );
});

test("Linux accepts the supported legacy AppIndicator development package", () => {
  const initial = options();
  const report = diagnose(
    "project",
    options({
      platform: "linux",
      probe(command, args) {
        if (args.includes("ayatana-appindicator3-0.1"))
          return { ok: false, output: "missing" };
        if (args.includes("appindicator3-0.1"))
          return { ok: true, output: "12.10.1" };
        return initial.probe(command, args);
      },
    }),
  );
  assert.equal(report.ok, true);
  assert.equal(
    report.checks.find((item) => item.name.includes("appindicator3")).detail,
    "12.10.1",
  );
});
