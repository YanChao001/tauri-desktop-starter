import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--interactive"))
  throw new Error("用法: pnpm test:installer --interactive");

function nsisFixture(t) {
  if (!args.includes("--interactive")) {
    t.skip(
      "Native installer executable tests require pnpm test:installer --interactive in an isolated environment",
    );
    return undefined;
  }
  const compiler =
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "tauri", "NSIS", "makensis.exe")
      : "";
  assert.ok(
    compiler && existsSync(compiler),
    "Requires Windows and the NSIS toolchain cached by a Tauri NSIS build",
  );
  const base = realpathSync(tmpdir());
  const fixture = mkdtempSync(join(base, "starter-installer-test-"));
  t.after(() => {
    assert.equal(dirname(fixture), base);
    rmSync(fixture, { recursive: true, force: true });
  });
  return { compiler, fixture };
}

const quote = (value) =>
  value.replaceAll("$", () => "$$").replaceAll('"', () => '$\\"');

function productionMacro(name) {
  const template = readFileSync(
    new URL("../src-tauri/installer/installer.nsi", import.meta.url),
    "utf8",
  );
  const macro = template.match(
    new RegExp(`!macro ${name} [^\\r\\n]+\\r?\\n[\\s\\S]*?!macroend`),
  )?.[0];
  assert.ok(
    macro,
    "Use the same macro as the installer, not a JavaScript reimplementation",
  );
  assert.doesNotMatch(
    template,
    /rR\d/,
    "System uses R0–R9 or r10–r19 for NSIS $R0–$R9",
  );
  return macro;
}

function runNsis(compiler, fixture, source) {
  const executable = join(fixture, "test.exe");
  const script = join(fixture, "test.nsi");
  writeFileSync(
    script,
    `Unicode true\nSilentInstall silent\nRequestExecutionLevel user\nOutFile "${quote(executable)}"\n${source}`,
  );
  const compiled = spawnSync(compiler, ["/V2", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  assert.equal(
    compiled.status,
    0,
    compiled.error?.message ?? `${compiled.stderr}\n${compiled.stdout}`,
  );
  assert.doesNotMatch(compiled.stdout, /warning \d+:/i);
  // 无安装动作或可见页面；windowsHide 仅用于隐藏控制台。
  const ran = spawnSync(executable, ["/S"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  assert.equal(ran.status, 0, ran.error?.message ?? ran.stderr);
}

test("NSIS preserves artwork proportions and keeps the sidebar mark visible without letterboxing", (t) => {
  const context = nsisFixture(t);
  if (!context) return;
  const { compiler, fixture } = context;
  const macro = productionMacro("StarterFitBitmap");
  const cases = [
    [150, 57, 450, 171],
    [200, 72, 450, 171],
    [240, 57, 450, 171],
    [150, 114, 450, 171],
    [188, 71, 450, 171],
    [300, 114, 450, 171],
    [164, 314, 492, 942],
    [188, 392, 492, 942],
    [492, 942, 492, 942],
    [1, 1, 450, 171],
    [164, 314, 492, 942, "cover"],
    [188, 392, 492, 942, "cover"],
    [218, 458, 492, 942, "cover"],
    [273, 507, 492, 942, "cover"],
    [328, 628, 492, 942, "cover"],
    [492, 942, 492, 942, "cover"],
  ];
  const sidebar = readFileSync(
    new URL("../resources/branding/installer-sidebar.svg", import.meta.url),
    "utf8",
  );
  const mark = sidebar.match(/<image\b[^>]*href="app-icon\.svg"[^>]*>/)?.[0];
  const viewBox = sidebar.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  assert.ok(mark && viewBox);
  const markBounds = Object.fromEntries(
    ["x", "y", "width", "height"].map((name) => [
      name,
      Number(mark.match(new RegExp(`\\b${name}="([\\d.]+)"`))?.[1]),
    ]),
  );
  const results = join(fixture, "geometry.csv");
  runNsis(
    compiler,
    fixture,
    `!include LogicLib.nsh
${macro}
Var ResultFile
Section
  FileOpen $ResultFile "${quote(results)}" w
${cases.map(([width, height, sourceWidth, sourceHeight, mode = "contain"]) => `  StrCpy $0 101\n  StrCpy $2 ${width}\n  StrCpy $3 ${height}\n  StrCpy $5 ${sourceWidth}\n  StrCpy $6 ${sourceHeight}\n  !insertmacro StarterFitBitmap $2 $3 $5 $6 ${mode}\n  FileWrite $ResultFile "$R7,$R8,$R9,$4,$0$\\r$\\n"`).join("\n")}
  FileClose $ResultFile
SectionEnd
`,
  );
  const text = readFileSync(results, "utf8");
  const rows = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(",").map(Number));
  assert.equal(rows.length, cases.length, JSON.stringify(text));
  rows.forEach(([width, height, x, y, control], index) => {
    assert.equal(control, 101, "preserves the caller's window handle register");
    const [boxWidth, boxHeight, sourceWidth, sourceHeight, mode = "contain"] =
      cases[index];
    const covers = mode === "cover";
    assert.ok(
      width > 0 &&
        height > 0 &&
        (covers
          ? width >= boxWidth && height >= boxHeight
          : width <= boxWidth && height <= boxHeight),
      `fits case ${index}`,
    );
    assert.ok(
      Math.abs(width * sourceHeight - height * sourceWidth) <=
        Math.max(sourceWidth, sourceHeight),
      `uniform scale within one pixel for case ${index}: ${JSON.stringify(rows[index])}`,
    );
    assert.ok(
      (covers ? x <= 0 && y <= 0 : x >= 0 && y >= 0) &&
        Math.abs(boxWidth - width - 2 * x) <= 1 &&
        Math.abs(boxHeight - height - 2 * y) <= 1,
      `centered case ${index}`,
    );
    assert.ok(
      width === boxWidth || height === boxHeight,
      `uses available space case ${index}`,
    );
    if (covers) {
      assert.ok(x + width >= boxWidth && y + height >= boxHeight);
      const svgWidth = Number(viewBox[1]);
      const svgHeight = Number(viewBox[2]);
      assert.ok(
        x + (width * markBounds.x) / svgWidth >= 0 &&
          y + (height * markBounds.y) / svgHeight >= 0 &&
          x + (width * (markBounds.x + markBounds.width)) / svgWidth <=
            boxWidth &&
          y + (height * (markBounds.y + markBounds.height)) / svgHeight <=
            boxHeight,
        `crops decoration without clipping the shared mark in case ${index}`,
      );
    }
  });
});

test("NSIS artwork stays opaque when themed static controls paint and image loading fails safely", (t) => {
  const context = nsisFixture(t);
  if (!context) return;
  const { compiler, fixture } = context;
  const cases = [
    [200, 72, "header.bmp", "contain"],
    [300, 114, "header.bmp", "contain"],
    [188, 392, "sidebar.bmp", "cover"],
    [218, 458, "sidebar.bmp", "cover"],
    [273, 507, "sidebar.bmp", "cover"],
    [328, 628, "sidebar.bmp", "cover"],
  ];
  const results = join(fixture, "pixels.csv");
  // HWND_MESSAGE 的子控件没有桌面表面；不调用 ShowWindow、激活或抢占焦点。
  // 使用与 MUI 相同的 v6 主题和 SS_BITMAP 控件，通过 WM_PRINTCLIENT 检查真实绘制。
  runNsis(
    compiler,
    fixture,
    `XPStyle on
ManifestDPIAware true
!include LogicLib.nsh
!include WinMessages.nsh
!include nsDialogs.nsh
${productionMacro("StarterFitBitmap")}
${productionMacro("StarterSetSharpBitmap")}
Var ResultFile
Var Control
Var Image
Var ScreenDC
Var SourceDC
Var PaintDC
Var PaintBitmap
Var SourcePrevious
Var PaintPrevious
Var Assigned
Section
  FileOpen $ResultFile "${quote(results)}" w
  System::Call 'USER32::GetDC(p0)p.s'
  Pop $ScreenDC
${cases
  .map(([width, height, name, mode], index) => {
    const path = quote(
      fileURLToPath(new URL(`../src-tauri/installer/${name}`, import.meta.url)),
    );
    return `  System::Call 'USER32::CreateWindowEx(i0,t "STATIC",t "",i0x5000010E,i0,i0,i${width},i${height},p-3,p0,p0,p0)p.s'
  Pop $Control
  \${NSD_SetStretchedImage} $Control "${path}" $Image
  !insertmacro StarterSetSharpBitmap $Control "${path}" $Image ${mode}
  SendMessage $Control \${STM_GETIMAGE} \${IMAGE_BITMAP} 0 $Assigned
  System::Call '*(i0,i0,i0,i0,i0,p0)p.r0'
  System::Call 'GDI32::GetObject(p $Assigned,i24,pr0)i.r1'
  System::Call '*$0(i,i.r2,i.r3,i,&i2.r4,&i2.r5)'
  System::Free $0
  FileWrite $ResultFile "meta,${index},$Control,$Image,$Assigned,$1,$2,$3,$5$\\r$\\n"
  System::Call 'GDI32::CreateCompatibleDC(p $ScreenDC)p.s'
  Pop $SourceDC
  System::Call 'GDI32::CreateCompatibleDC(p $ScreenDC)p.s'
  Pop $PaintDC
  System::Call 'GDI32::CreateCompatibleBitmap(p $ScreenDC,i${width},i${height})p.s'
  Pop $PaintBitmap
  System::Call 'GDI32::SelectObject(p $PaintDC,p $PaintBitmap)p.s'
  Pop $PaintPrevious
  SendMessage $Control 0x318 $PaintDC 4
  System::Call 'GDI32::SelectObject(p $SourceDC,p $Assigned)p.s'
  Pop $SourcePrevious
${Array.from({ length: 9 }, (_, y) =>
  Array.from({ length: 9 }, (_, x) => {
    const px = Math.floor(((x + 1) * width) / 10);
    const py = Math.floor(((y + 1) * height) / 10);
    return `  System::Call 'GDI32::GetPixel(p $SourceDC,i${px},i${py})i.r0'
  System::Call 'GDI32::GetPixel(p $PaintDC,i${px},i${py})i.r1'
  FileWrite $ResultFile "pixel,${index},$0,$1$\\r$\\n"`;
  }).join("\n"),
).join("\n")}
  System::Call 'GDI32::GetPixel(p $SourceDC,i${Math.floor(width / 2)},i0)i.r0'
  System::Call 'GDI32::GetPixel(p $SourceDC,i${Math.floor(width / 2)},i${height - 1})i.r1'
  FileWrite $ResultFile "edge,${index},$0,$1$\\r$\\n"
  !insertmacro StarterSetSharpBitmap $Control "${quote(join(fixture, "missing.bmp"))}" $Image ${mode}
  SendMessage $Control \${STM_GETIMAGE} \${IMAGE_BITMAP} 0 $0
  FileWrite $ResultFile "fallback,${index},$Image,$0$\\r$\\n"
  System::Call 'GDI32::SelectObject(p $SourceDC,p $SourcePrevious)'
  System::Call 'GDI32::SelectObject(p $PaintDC,p $PaintPrevious)'
  System::Call 'GDI32::DeleteDC(p $SourceDC)'
  System::Call 'GDI32::DeleteDC(p $PaintDC)'
  System::Call 'GDI32::DeleteObject(p $PaintBitmap)'
  SendMessage $Control \${STM_SETIMAGE} \${IMAGE_BITMAP} 0
  System::Call 'GDI32::DeleteObject(p $Image)'
  System::Call 'USER32::DestroyWindow(p $Control)'`;
  })
  .join("\n")}
  System::Call 'USER32::ReleaseDC(p0,p $ScreenDC)'
  FileClose $ResultFile
SectionEnd`,
  );
  const rows = readFileSync(results, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(","));
  cases.forEach(([width, height, , mode], index) => {
    const selected = rows.filter((row) => Number(row[1]) === index);
    const [, , control, owned, assigned, size, bmpWidth, bmpHeight, bits] =
      selected.find((row) => row[0] === "meta");
    assert.notEqual(Number(control), 0);
    assert.notEqual(Number(owned), 0);
    assert.equal(
      assigned,
      owned,
      "themed controls must not create a transparent alpha copy",
    );
    assert.equal(Number(size), 24);
    assert.deepEqual(
      [Number(bmpWidth), Number(bmpHeight), Number(bits)],
      [width, height, 24],
    );
    const pixels = selected.filter((row) => row[0] === "pixel");
    assert.equal(pixels.length, 81);
    assert.ok(
      pixels.filter((row) => Number(row[2]) !== 0xffffff).length > 12,
      "actual artwork is present",
    );
    pixels.forEach(([, , bitmap, painted]) => {
      assert.notEqual(Number(bitmap), -1);
      assert.equal(
        painted,
        bitmap,
        `case ${index} paints opaque artwork, including the white background`,
      );
    });
    if (mode === "cover") {
      const edges = selected
        .find((row) => row[0] === "edge")
        .slice(2)
        .map(Number);
      assert.ok(
        edges.every((color) => color !== -1 && color !== 0xffffff),
        `sidebar reaches both vertical edges without white bands in case ${index}`,
      );
    }
    assert.deepEqual(selected.find((row) => row[0] === "fallback").slice(2), [
      owned,
      owned,
    ]);
  });
});
