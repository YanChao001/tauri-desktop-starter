const { document } = globalThis;
const root = document.documentElement;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const reducedMotion = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
const narrowSidebar = globalThis.matchMedia(
  "(max-width: 650px), (min-width: 901px) and (max-width: 1150px)",
);
const desktop = $("#desktop-preview");
const announcement = $("#announcement");
let language = "zh";
let motionEnabled = !reducedMotion.matches;
let previewVisible = true;
let galleryIndex = 0;
let layer = "ui";
let command = "run";
let galleryRequest = 0;
let copyTimer;
let noteSequence = 2;
const notes = [
  { id: 1, zh: "给下一个作品留一点空间", en: "Make space for the next idea" },
  { id: 2, zh: "把灵感写下来", en: "Write down that passing thought" },
];
const text = (zh, en) => (language === "en" ? en : zh);
const announce = (value) => {
  announcement.textContent = value;
};

const captures = [
  {
    source: "showroom-desktop.png",
    title: ["创意展厅", "Showroom"],
    alt: [
      "原生桌面应用的深色创意展厅，包含原创 SVG 与樱花窗口皮肤",
      "The desktop showroom with original SVG artwork and a cherry blossom window skin",
    ],
    tag: ["体验层", "EXPERIENCE"],
    description: [
      "原创 SVG、窗口皮肤、命令面板与主题联动。展示模式可以切换为精简模式，按产品需要保留和替换。",
      "Original SVG art, window skins, a command palette, and coordinated themes. Switch from showcase to minimal mode, keeping and replacing what your product needs.",
    ],
  },
  {
    source: "components-desktop.png",
    title: ["组件创作", "Creative studio"],
    alt: [
      "原生桌面应用的组件创作场景，表单控件联动右侧创意卡片",
      "The desktop creative studio with form controls and a live creative card",
    ],
    tag: ["交互场景", "INTERACTION"],
    description: [
      "作品名称、调色板、构图与视觉强度联动实时画布；另有叠层反馈与资源筛选场景，展示控件如何协作。",
      "Project names, palettes, composition, and visual energy drive a live canvas. Overlay feedback and resource filtering scenes show how components work together.",
    ],
  },
  {
    source: "motion-desktop.png",
    title: ["动效实验室", "Motion lab"],
    alt: [
      "原生桌面应用的 SVG 路径实验，包含播放控制和参数调节",
      "The desktop SVG path experiment with playback controls and adjustable parameters",
    ],
    tag: ["运动与反馈", "MOTION"],
    description: [
      "四组实验连接弹簧、布局、光影与路径。播放状态、可见性与减少动态效果偏好共同决定场景何时运行。",
      "Four experiments connect springs, layout, light, and paths. Playback state, visibility, and reduced-motion preferences determine when each scene runs.",
    ],
  },
  {
    source: "database-desktop.png",
    title: ["本地数据库", "Local database"],
    alt: [
      "原生 SQLite 笔记页面，包含搜索、标题、正文和保存入口",
      "The native SQLite notes page with search, a title and body editor, and save controls",
    ],
    tag: ["原生持久化", "PERSISTENCE"],
    description: [
      "Rust 管理 SQLite 笔记，支持创建、搜索、修改和删除。参数化查询、版本冲突检测与跨窗口事件同步构成完整的数据操作示例。",
      "Rust manages SQLite notes with create, search, update, and delete. Parameterized queries, version conflict detection, and cross-window events complete the data workflow.",
    ],
  },
  {
    source: "diagnostics-desktop.png",
    title: ["诊断与日志", "Diagnostics"],
    alt: [
      "原生应用的诊断页面，展示版本、平台、窗口状态与脱敏日志",
      "The native diagnostics page showing versions, platform, window state, and redacted logs",
    ],
    tag: ["运行可观测", "OBSERVABILITY"],
    description: [
      "集中查看平台、窗口、存储和更新状态，按需复制脱敏诊断。前端与原生错误进入日志，诊断内容不包含笔记正文和完整用户路径。",
      "Inspect platform, window, storage, and update state, then explicitly copy redacted diagnostics. Frontend and native errors are logged; copied diagnostics exclude note bodies and full user paths.",
    ],
  },
  {
    source: "settings-desktop.png",
    title: ["窗口与设置", "Window & settings"],
    alt: [
      "原生应用的设置页面，展示常用窗口尺寸预设、启动位置与恢复设置入口",
      "The native settings page with common window size presets, startup placement, and reset preferences",
    ],
    tag: ["个性化设置", "PERSONALIZATION"],
    description: [
      "从常用尺寸预设中选择窗口大小，标准尺寸自动适应当前屏幕。启动位置可记住上次位置或居中，下次开窗生效。恢复设置同时恢复默认大小；主题、皮肤与布局支持本地保存、迁移、跨窗口同步与失败重试。",
      "Choose a common window size preset, with the standard size fitted to the current screen. Remember the previous position or center newly opened windows. Reset preferences also restores the default size. Themes, skins, and layout support local saves, migrations, cross-window sync, and retries.",
    ],
  },
];
const layers = {
  ui: {
    file: "src/pages/ · src/providers/",
    title: ["页面负责表达意图。", "The interface expresses intent."],
    description: [
      "交互组件组织页面，设置和命令通过统一入口协作。业务页面调用原生门面，保持与平台细节的边界。",
      "Components compose pages; settings and commands share deliberate entry points. Pages call the native facade, keeping platform details behind a clear boundary.",
    ],
  },
  contract: {
    file: "src/lib/tauri.ts · src/lib/generated/bindings.ts",
    title: ["契约连接两端。", "A contract connects both sides."],
    description: [
      "Rust 导出 TypeScript IPC 绑定，前端门面统一原生调用与事件。结构化错误保留稳定错误码与重试语义，绑定检查发现契约漂移。",
      "Rust generates TypeScript IPC bindings. The facade centralizes native calls and events. Structured errors retain stable codes and retry semantics; binding checks detect contract drift.",
    ],
  },
  native: {
    file: "src-tauri/src/commands.rs · database.rs",
    title: ["系统能力留在原生侧。", "Native services own system work."],
    description: [
      "命令边界校验输入并编排服务。数据库负责迁移、事务和并发版本；存储负责原子设置，阻塞操作进入任务池。事件将已提交的变化同步给窗口。",
      "Commands validate input and orchestrate services. The database owns migrations, transactions, and revision checks; storage owns atomic settings. Blocking work uses a worker pool, and events synchronize committed changes.",
    ],
  },
};
const commands = {
  run: {
    lines: [
      "# 获取源码",
      "git clone https://github.com/YanChao001/tauri-desktop-starter.git",
      "cd tauri-desktop-starter",
      "",
      "# 安装依赖，检查环境，启动原生应用",
      "pnpm install --frozen-lockfile",
      "rustup toolchain install",
      "pnpm run doctor",
      "pnpm app:dev",
    ],
    note: [
      "首次运行会编译 Rust 依赖；后续复用编译缓存，前端支持 Vite 热更新。",
      "The first run compiles Rust dependencies. Later runs reuse the cache, with Vite hot reload for the interface.",
    ],
  },
  brand: {
    lines: [
      "# 先准备品牌配置，参照开发指南的 JSON 示例",
      "# 预览应用身份与包名的同步差异",
      "pnpm init:project --config ../my-app.json --dry-run",
      "",
      "# 核对后应用，可附加 --minimal 使用精简模式",
      "pnpm init:project --config ../my-app.json",
      "",
      "# 修改 resources/branding/*.svg 后生成资源",
      "pnpm branding:generate",
      "pnpm branding:check",
    ],
    note: [
      "应用身份集中配置，品牌资源从 SVG 设计源生成；更新公钥与代码签名另行配置。",
      "Application identity is centralized; branding is generated from SVG sources. Update keys and code signing require separate configuration.",
    ],
  },
  verify: {
    lines: [
      "# 前端、工程脚本、类型、品牌、版本与构建检查",
      "pnpm verify",
      "",
      "# Rust 格式、静态检查与测试",
      "cargo fmt --manifest-path src-tauri/Cargo.toml -- --check",
      "cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings",
      "cargo test --manifest-path src-tauri/Cargo.toml",
      "",
      "# 真实桌面 E2E 的平台配置见测试指南",
    ],
    note: [
      "单元测试、原生检查与真实安装验收各自覆盖不同层次；具体平台和 E2E 前置条件见测试文档。",
      "Unit tests, native checks, and installation acceptance cover different layers. See the testing guide for platform and desktop E2E prerequisites.",
    ],
  },
  build: {
    lines: [
      "# 生成当前平台安装包",
      "pnpm app:build",
      "",
      "# 生成当前平台的便携交付目录",
      "pnpm app:portable",
      "",
      "# 发布前核对四处版本",
      "pnpm version:check",
      "",
      "# 三端构建、安装包清单与签名配置见发布指南",
    ],
    note: [
      "仓库提供 Windows、macOS、Linux 构建工作流。可下载版本、平台与签名状态以实际 Releases 为准。",
      "The repository includes Windows, macOS, and Linux build workflows. Available downloads, target platforms, and signing status depend on published Releases.",
    ],
  },
};

function replaceText(element, value) {
  const parts = value.split("\\n");
  element.replaceChildren(
    ...parts.flatMap((part, index) =>
      index
        ? [document.createElement("br"), document.createTextNode(part)]
        : [document.createTextNode(part)],
    ),
  );
}
function selected(selector, attribute, value) {
  for (const button of $$(selector)) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset[attribute] === value),
    );
  }
}
function updateMotion() {
  root.dataset.motion = motionEnabled ? "on" : "off";
  root.dataset.pageHidden = String(document.hidden);
  desktop.dataset.running = String(
    motionEnabled && previewVisible && !document.hidden,
  );
  $("#motion-toggle").setAttribute("aria-pressed", String(motionEnabled));
  $("#motion-toggle").setAttribute(
    "aria-label",
    motionEnabled
      ? text("暂停所有动效", "Pause all motion")
      : text("开启动效", "Enable motion"),
  );
  $("#motion-label").textContent = motionEnabled
    ? text("暂停动效", "Pause motion")
    : text("开启动效", "Enable motion");
  $(".motion-symbol").textContent = motionEnabled ? "Ⅱ" : "▷";
}
function renderNotes() {
  $("#note-list").replaceChildren(
    ...notes.map((note) => {
      const item = document.createElement("li");
      const icon = document.createElement("span");
      icon.textContent = "▤";
      icon.setAttribute("aria-hidden", "true");
      const title = document.createElement("span");
      title.className = "note-title";
      title.textContent = note.value ?? text(note.zh, note.en);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "note-remove";
      remove.textContent = "×";
      remove.dataset.removeNote = String(note.id);
      remove.setAttribute(
        "aria-label",
        `${text("删除示例笔记", "Remove demo note")}: ${title.textContent}`,
      );
      item.append(icon, title, remove);
      return item;
    }),
  );
}
function setView(view, focus = false) {
  if (!$("[data-scene='" + view + "']")) return;
  desktop.dataset.view = view;
  for (const scene of $$("[data-scene]"))
    scene.hidden = scene.dataset.scene !== view;
  selected(".app-navigation button", "view", view);
  if (focus) {
    desktop.scrollIntoView({
      behavior: motionEnabled ? "smooth" : "instant",
      block: "center",
    });
    $(`.app-navigation [data-view="${view}"]`).focus({ preventScroll: true });
  }
}
function renderGallery() {
  const capture = captures[galleryIndex];
  $("#preview-image").alt = text(...capture.alt);
  $("#preview-counter").textContent =
    `${String(galleryIndex + 1).padStart(2, "0")} / ${String(captures.length).padStart(2, "0")}`;
  $("#preview-caption").textContent =
    `${text(...capture.title)} · ${text("原生桌面截图", "Native desktop capture")}`;
  $("#gallery-tag").textContent = text(...capture.tag);
  $("#gallery-copy").textContent = text(...capture.description);
  selected("[data-gallery]", "gallery", String(galleryIndex));
  for (const button of $$("[data-gallery]"))
    button.textContent = text(
      ...captures[Number(button.dataset.gallery)].title,
    );
  if ($("#image-dialog").open) {
    $("#dialog-caption").textContent = $("#preview-caption").textContent;
    $("#dialog-image").alt = text(...capture.alt);
  }
}
async function setGallery(index) {
  if (!captures[index]) return;
  const request = ++galleryRequest;
  const capture = captures[index];
  const source = `./assets/${capture.source}`;
  const preload = new globalThis.Image();
  preload.src = source;
  try {
    await preload.decode();
    if (request !== galleryRequest) return;
    galleryIndex = index;
    $("#preview-image").src = source;
    renderGallery();
    if (motionEnabled)
      $("#preview-image").animate([{ opacity: 0.45 }, { opacity: 1 }], {
        duration: 280,
      });
  } catch {
    if (request === galleryRequest)
      announce(
        text(
          "截图暂时无法载入，请稍后重试。",
          "The screenshot could not load. Please try again.",
        ),
      );
  }
}
function renderLayer() {
  $("#layer-file").textContent = layers[layer].file;
  $("#layer-title").textContent = text(...layers[layer].title);
  $("#layer-copy").textContent = text(...layers[layer].description);
  selected("[data-layer]", "layer", layer);
}
function renderCommand() {
  globalThis.clearTimeout(copyTimer);
  $("#terminal-title").textContent = `TERMINAL / ${command.toUpperCase()}`;
  const fragment = document.createDocumentFragment();
  for (const line of commands[command].lines) {
    const span = document.createElement("span");
    span.textContent = `${line}\n`;
    if (line.startsWith("#")) span.className = "command-comment";
    fragment.append(span);
  }
  $("#start-command").replaceChildren(fragment);
  $("#command-note").textContent = text(...commands[command].note);
  $("#copy-command").textContent = text("复制", "Copy");
  selected("[data-command]", "command", command);
}
function setLanguage(value, persist = false) {
  language = value === "en" ? "en" : "zh";
  root.lang = language === "en" ? "en" : "zh-CN";
  for (const element of $$("[data-zh][data-en]"))
    replaceText(element, element.dataset[language]);
  for (const element of $$("[data-label-zh]"))
    element.setAttribute(
      "aria-label",
      element.dataset[language === "en" ? "labelEn" : "labelZh"],
    );
  for (const element of $$("[data-placeholder-zh]"))
    element.placeholder =
      element.dataset[language === "en" ? "placeholderEn" : "placeholderZh"];
  for (const button of $$(".app-navigation button")) {
    button.setAttribute(
      "aria-label",
      button.querySelector("[data-zh]").textContent,
    );
  }
  $("#language").textContent = language === "en" ? "中" : "EN";
  $("#language").setAttribute(
    "aria-label",
    text("Switch to English", "切换为简体中文"),
  );
  document.title = text(
    "Tauri Desktop Starter · 从灵感到桌面",
    "Tauri Desktop Starter · Your next idea, on desktop",
  );
  $('meta[name="description"]').content = text(
    "可探索的桌面应用起点。Tauri 2、React 19 与 Rust，连接原创界面、原生能力和完整工程流程。",
    "An interactive desktop application foundation. Tauri 2, React 19, and Rust connect original interfaces, native capabilities, and engineering workflows.",
  );
  if (!$("#project-name").dataset.edited) {
    $("#project-name").value = text("下一份灵感", "The next spark");
    $("#studio-name").textContent = $("#project-name").value;
  }
  renderNotes();
  renderGallery();
  renderLayer();
  renderCommand();
  updateMotion();
  if (persist) {
    try {
      globalThis.localStorage.setItem("starter-website-language", language);
    } catch {
      /* 存储不可用时，语言选择仍在当前页面生效。 */
    }
    announce(text("已切换为简体中文。", "Language switched to English."));
  }
}

$("#language").addEventListener("click", () =>
  setLanguage(language === "zh" ? "en" : "zh", true),
);
$("#motion-toggle").addEventListener("click", () => {
  motionEnabled = !motionEnabled;
  updateMotion();
  announce(
    motionEnabled
      ? text("已开启动效。", "Motion enabled.")
      : text("已暂停所有动效。", "All motion paused."),
  );
});
reducedMotion.addEventListener("change", (event) => {
  motionEnabled = !event.matches;
  updateMotion();
});
document.addEventListener("visibilitychange", updateMotion);
$("#preview-theme").addEventListener("click", () => {
  desktop.dataset.theme = desktop.dataset.theme === "dark" ? "light" : "dark";
  announce(
    desktop.dataset.theme === "dark"
      ? text("预览已切换为深色。", "Preview switched to dark theme.")
      : text("预览已切换为浅色。", "Preview switched to light theme."),
  );
});
function syncSidebar(collapsed = narrowSidebar.matches) {
  desktop.classList.toggle("sidebar-collapsed", collapsed);
  $("#sidebar-toggle").setAttribute("aria-expanded", String(!collapsed));
}
$("#sidebar-toggle").addEventListener("click", () =>
  syncSidebar(!desktop.classList.contains("sidebar-collapsed")),
);
narrowSidebar.addEventListener("change", () => syncSidebar());
$(".app-navigation").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (button) setView(button.dataset.view);
});
for (const button of $$("[data-open-view]"))
  button.addEventListener("click", () =>
    setView(button.dataset.openView, true),
  );
$(".skin-controls").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-skin]");
  if (!button) return;
  desktop.dataset.skin = button.dataset.skin;
  desktop.dataset.theme =
    button.dataset.skin === "starlight" ? "dark" : "light";
  selected(".skin-controls button", "skin", button.dataset.skin);
  announce(
    `${text("已应用预览皮肤", "Preview skin applied")}: ${button.textContent.trim()}`,
  );
});
$("#project-name").addEventListener("input", (event) => {
  event.target.dataset.edited = "true";
  $("#studio-name").textContent =
    event.target.value.trim() || text("未命名作品", "Untitled project");
});
// 指针改变矢量雕塑的角度；只在实际交互时更新，不创建持续渲染循环。
desktop.addEventListener("pointermove", (event) => {
  if (!motionEnabled || reducedMotion.matches || event.pointerType === "touch")
    return;
  const bounds = desktop.getBoundingClientRect();
  const horizontal = (event.clientX - bounds.left) / bounds.width - 0.5;
  const vertical = (event.clientY - bounds.top) / bounds.height - 0.5;
  desktop.style.setProperty("--art-x", `${horizontal * 10}px`);
  desktop.style.setProperty("--art-y", `${vertical * 7}px`);
  desktop.style.setProperty("--art-rotate", `${horizontal * 8}deg`);
});
desktop.addEventListener("pointerleave", () => {
  for (const name of ["--art-x", "--art-y", "--art-rotate"])
    desktop.style.removeProperty(name);
});
$("#motion-speed").addEventListener("input", (event) => {
  const speed = Number(event.target.value);
  desktop.style.setProperty("--motion-duration", `${6 / speed}s`);
  $("#speed-output").textContent = `${speed}×`;
});
$("#motion-replay").addEventListener("click", () => {
  for (const animation of $("#motion-path").getAnimations())
    animation.currentTime = 0;
  announce(text("路径已重置。", "The path has been reset."));
});
$("#note-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const value = $("#note-input").value.trim();
  if (!value) {
    $("#note-input").focus();
    return;
  }
  if (notes.length >= 12) {
    announce(
      text(
        "示例最多保留 12 条，请先删除一条。",
        "This demo holds up to 12 notes. Remove one to add another.",
      ),
    );
    return;
  }
  notes.unshift({ id: ++noteSequence, value });
  $("#note-input").value = "";
  renderNotes();
  announce(
    text("示例笔记已添加到页面内存。", "Demo note added to page memory."),
  );
});
$("#note-list").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-remove-note]");
  if (!button) return;
  const index = notes.findIndex(
    (note) => note.id === Number(button.dataset.removeNote),
  );
  if (index < 0) return;
  notes.splice(index, 1);
  renderNotes();
  const remaining = $$(".note-remove");
  (
    remaining[Math.min(index, remaining.length - 1)] ?? $("#note-input")
  ).focus();
  announce(text("示例笔记已删除。", "Demo note removed."));
});

for (const [index, capture] of captures.entries()) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.gallery = String(index);
  button.textContent = capture.title[0];
  button.addEventListener("click", () => void setGallery(index));
  $("#gallery-tabs").append(button);
}
for (const button of $$("[data-layer]"))
  button.addEventListener("click", () => {
    layer = button.dataset.layer;
    renderLayer();
  });
for (const button of $$("[data-command]"))
  button.addEventListener("click", () => {
    command = button.dataset.command;
    renderCommand();
  });
$("#copy-command").addEventListener("click", async () => {
  globalThis.clearTimeout(copyTimer);
  const copiedCommand = command;
  try {
    await globalThis.navigator.clipboard.writeText(
      $("#start-command").textContent,
    );
    if (command !== copiedCommand) return;
    $("#copy-command").textContent = text("已复制", "Copied");
    announce(text("当前命令已复制。", "Current commands copied."));
  } catch {
    if (command !== copiedCommand) return;
    $("#copy-command").textContent = text("请选中复制", "Select to copy");
    announce(
      text(
        "无法访问剪贴板，请选中命令手动复制。",
        "Clipboard access is unavailable. Select the commands to copy manually.",
      ),
    );
  }
  copyTimer = globalThis.setTimeout(() => {
    $("#copy-command").textContent = text("复制", "Copy");
  }, 2400);
});
$("#gallery-open").addEventListener("click", () => {
  $("#dialog-image").src = $("#preview-image").src;
  $("#dialog-image").alt = $("#preview-image").alt;
  $("#dialog-caption").textContent = $("#preview-caption").textContent;
  $("#image-dialog").showModal();
});
$("#dialog-close").addEventListener("click", () => $("#image-dialog").close());
$("#image-dialog").addEventListener("click", (event) => {
  const bounds = event.currentTarget.getBoundingClientRect();
  if (
    event.target === event.currentTarget &&
    (event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom)
  )
    event.currentTarget.close();
});

// 分组按钮保持原生 Tab 顺序，同时支持方向键快速浏览。
for (const group of $$("[role='group']"))
  group.addEventListener("keydown", (event) => {
    if (
      !event.target.matches("button") ||
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(event.key)
    )
      return;
    const buttons = [...group.querySelectorAll("button")];
    const index = buttons.indexOf(event.target);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index +
              (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) +
              buttons.length) %
            buttons.length;
    event.preventDefault();
    buttons[next].focus();
    buttons[next].click();
  });

// 离屏与后台页面暂停持续动画，滚动进度按需更新，不运行常驻帧循环。
const previewObserver = new IntersectionObserver(
  ([entry]) => {
    previewVisible = entry.isIntersecting;
    updateMotion();
  },
  { threshold: 0.05 },
);
previewObserver.observe(desktop);
const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries)
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
  },
  { threshold: 0.08 },
);
for (const element of $$("[data-reveal]")) revealObserver.observe(element);
let progressFrame = 0;
function updateProgress() {
  progressFrame = 0;
  const range = root.scrollHeight - globalThis.innerHeight;
  $(".scroll-progress").style.transform =
    `scaleX(${range > 0 ? Math.min(1, globalThis.scrollY / range) : 0})`;
}
globalThis.addEventListener(
  "scroll",
  () => {
    if (!progressFrame)
      progressFrame = globalThis.requestAnimationFrame(updateProgress);
  },
  { passive: true },
);
globalThis.addEventListener("resize", updateProgress, { passive: true });

try {
  const requested = new URL(globalThis.location.href).searchParams.get("lang");
  setLanguage(
    requested === "en" || requested === "zh"
      ? requested
      : globalThis.localStorage.getItem("starter-website-language"),
  );
} catch {
  setLanguage("zh");
}
syncSidebar();
updateProgress();
root.classList.add("js");
