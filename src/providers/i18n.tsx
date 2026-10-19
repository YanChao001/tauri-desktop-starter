import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSettings, type Language } from "@/providers/settings";

/**
 * 轻量 i18n：只在需要的地方查表，不引入 i18next。
 * 每项是 [中文, English]，新增文案时两边都要写，避免漏翻。
 */
const DICT = {
  // ---- 导航与外壳 ----
  "nav.overview": ["概览", "Overview"],
  "nav.components": ["组件", "Components"],
  "nav.motion": ["动效", "Motion"],
  "nav.bridge": ["前端 ↔ Rust", "Frontend ↔ Rust"],
  "nav.settings": ["设置", "Settings"],
  "app.name": ["Tauri Starter", "Tauri Starter"],
  "app.tagline": ["桌面应用基座", "Desktop app starter"],
  "app.native": ["原生窗口", "Native window"],
  "app.preview": ["浏览器预览", "Browser preview"],

  // ---- 标题栏菜单 ----
  "title.file": ["文件", "File"],
  "title.edit": ["编辑", "Edit"],
  "title.view": ["视图", "View"],
  "title.help": ["帮助", "Help"],
  "title.settings": ["设置…", "Settings…"],
  "title.reload": ["重新加载", "Reload"],
  "title.quit": ["退出", "Quit"],
  "title.copyLink": ["复制当前地址", "Copy current URL"],
  "title.selectAll": ["全选", "Select all"],
  "title.light": ["浅色", "Light"],
  "title.dark": ["深色", "Dark"],
  "title.system": ["跟随系统", "System"],
  "title.toggleMenu": ["显示菜单栏", "Show menu bar"],
  "title.fullscreen": ["全屏", "Fullscreen"],
  "title.docs": ["Tauri 文档", "Tauri docs"],
  "title.repo": ["GitHub 仓库", "GitHub repository"],
  "title.about": ["关于", "About"],
  "title.minimize": ["最小化", "Minimize"],
  "title.maximize": ["最大化", "Maximize"],
  "title.restore": ["还原", "Restore"],
  "title.close": ["关闭", "Close"],
  "title.toggleTheme": ["切换主题", "Toggle theme"],
  "title.aboutTitle": ["关于 Tauri Starter", "About Tauri Starter"],
  "title.aboutBody": [
    "一个可复用的桌面应用基座：Tauri 2 负责原生窗口与系统能力，React 19 负责界面。改掉名字就能开始写业务。",
    "A reusable desktop foundation: Tauri 2 for the native shell, React 19 for the interface. Rename it and start building.",
  ],

  // ---- 通用 ----
  "common.copy": ["复制", "Copy"],
  "common.copied": ["已复制到剪贴板", "Copied to clipboard"],
  "common.copyFailed": [
    "复制失败，请手动选择文本",
    "Copy failed, select the text manually",
  ],
  "common.reset": ["恢复默认设置", "Reset to defaults"],
  "common.resetDone": ["已恢复默认设置", "Settings reset"],
  "common.sampleData": ["示例数据", "Sample data"],
  "common.cancel": ["取消", "Cancel"],
  "common.close": ["关闭", "Close"],
  "common.language": ["语言", "Language"],
  "common.docs": ["查看文档", "View docs"],
  "common.repo": ["GitHub", "GitHub"],

  // ---- 概览 ----
  "overview.title": ["桌面应用基座已就绪", "Your desktop foundation is ready"],
  "overview.subtitle": [
    "窗口、主题、多语言、安装器与发布流水线都已接好。这个页面演示一套完整的桌面仪表盘可以长什么样，业务页面可以从这里往下长。",
    "Window, themes, i18n, installers and the release pipeline are wired up. This page shows what a complete desktop dashboard can look like.",
  ],
  "overview.cta.components": ["浏览组件", "Browse components"],
  "overview.cta.settings": ["打开设置", "Open settings"],
  "overview.badge": [
    "Tauri 2 · React 19 · Tailwind 4",
    "Tauri 2 · React 19 · Tailwind 4",
  ],
  "overview.stats.tests": ["自动化测试", "Automated tests"],
  "overview.stats.testsHint": ["前端 + Rust", "Frontend + Rust"],
  "overview.stats.platforms": ["CI 平台", "CI platforms"],
  "overview.stats.platformsHint": [
    "Windows · macOS · Linux",
    "Windows · macOS · Linux",
  ],
  "overview.stats.bundle": ["前端产物", "Frontend bundle"],
  "overview.stats.bundleHint": ["gzip 后", "After gzip"],
  "overview.stats.installer": ["NSIS 安装包", "NSIS installer"],
  "overview.stats.installerHint": ["x64", "x64"],
  "overview.recent": ["最近动态", "Recent activity"],
  "overview.recentHint": [
    "示例数据，演示时间线布局",
    "Sample data for the timeline layout",
  ],
  "overview.quick": ["快速开始", "Quick start"],
  "overview.quickHint": ["从安装依赖到产出安装包", "From install to installer"],
  "overview.quickInstall": ["安装依赖", "Install dependencies"],
  "overview.quickDev": ["启动开发模式", "Start dev mode"],
  "overview.quickBuild": ["产出安装包", "Build installers"],
  "overview.status": ["工程状态", "Project health"],
  "overview.statusHint": [
    "示例数据，演示进度与指标",
    "Sample data for progress and metrics",
  ],
  "overview.activity.build": ["构建通过", "Build passed"],
  "overview.activity.buildMeta": ["Windows · 2 分 12 秒", "Windows · 2m 12s"],
  "overview.activity.release": ["安装包已生成", "Installer generated"],
  "overview.activity.releaseMeta": ["NSIS · 1.41 MB", "NSIS · 1.41 MB"],
  "overview.activity.tests": ["测试全绿", "All tests green"],
  "overview.activity.testsMeta": ["21 个用例", "21 cases"],
  "overview.activity.docs": ["文档已同步", "Docs updated"],
  "overview.activity.docsMeta": ["14 份工程文档", "14 documents"],
  "overview.health.build": ["构建健康度", "Build health"],
  "overview.health.coverage": ["检查项通过率", "Checks passing"],
  "overview.health.bundle": ["体积预算", "Size budget"],
  "overview.health.deps": ["依赖审计", "Dependency audit"],
  "overview.health.value": ["{value}%", "{value}%"],

  // ---- 组件页 ----
  "components.title": ["组件与控件", "Components & controls"],
  "components.subtitle": [
    "常用的桌面控件都在这里：按钮、表单、浮层、数据展示。它们共享同一套主题变量，切换主题色与圆角时会一起变化。",
    "The everyday desktop controls: buttons, forms, overlays and data display. They share the same theme tokens, so accent and radius changes apply everywhere.",
  ],
  "components.buttons": ["按钮与徽标", "Buttons & badges"],
  "components.buttonsHint": [
    "主要、次要、描边、幽灵、危险五种语气",
    "Five tones: primary, secondary, outline, ghost and destructive",
  ],
  "components.primary": ["主要", "Primary"],
  "components.secondary": ["次要", "Secondary"],
  "components.outline": ["描边", "Outline"],
  "components.ghost": ["幽灵", "Ghost"],
  "components.destructive": ["危险", "Destructive"],
  "components.loading": ["加载中", "Loading"],
  "components.inputs": ["输入与选择", "Inputs & selection"],
  "components.inputsHint": [
    "输入框、下拉、开关、滑块与单选",
    "Input, select, switch, slider and radio",
  ],
  "components.name": ["名称", "Name"],
  "components.namePlaceholder": ["输入项目名称", "Project name"],
  "components.email": ["邮箱", "Email"],
  "components.role": ["角色", "Role"],
  "components.roleAdmin": ["管理员", "Admin"],
  "components.roleEditor": ["编辑", "Editor"],
  "components.roleViewer": ["访客", "Viewer"],
  "components.notifications": ["通知", "Notifications"],
  "components.notificationsHint": [
    "接收构建结果与发布提醒",
    "Get build and release updates",
  ],
  "components.volume": ["音量", "Volume"],
  "components.plan": ["套餐", "Plan"],
  "components.planBasic": ["基础", "Basic"],
  "components.planPro": ["专业", "Pro"],
  "components.planTeam": ["团队", "Team"],
  "components.overlays": ["浮层与反馈", "Overlays & feedback"],
  "components.overlaysHint": [
    "对话框、气泡、下拉、提示与 Toast",
    "Dialog, popover, dropdown, tooltip and toast",
  ],
  "components.dialog": ["打开对话框", "Open dialog"],
  "components.dialogTitle": ["确认发布？", "Publish now?"],
  "components.dialogBody": [
    "这是一个示例对话框。真实业务里可以在这里放发布说明、风险提示或二次确认。",
    "A sample dialog. Use it for release notes, warnings or destructive confirmations.",
  ],
  "components.popover": ["气泡卡片", "Popover"],
  "components.popoverBody": [
    "浮层可以放任意内容，点击外部会自动关闭。",
    "Popovers can hold anything and close on outside click.",
  ],
  "components.toast": ["触发通知", "Show toast"],
  "components.toastMessage": [
    "构建已完成，耗时 1.2s",
    "Build finished in 1.2s",
  ],
  "components.tooltip": ["悬停提示", "Tooltip"],
  "components.tooltipBody": ["这是一条提示", "A short hint"],
  "components.data": ["数据展示", "Data display"],
  "components.dataHint": [
    "表格、头像、徽标、进度与骨架屏",
    "Table, avatars, badges, progress and skeleton",
  ],
  "components.team": ["成员列表", "Team members"],
  "components.member": ["成员", "Member"],
  "components.status": ["状态", "Status"],
  "components.active": ["在线", "Active"],
  "components.invited": ["已邀请", "Invited"],
  "components.progress": ["发布进度", "Release progress"],
  "components.skeletonHint": ["加载占位", "Loading placeholder"],
  "components.tabs": ["标签页与折叠", "Tabs & accordion"],
  "components.tabsHint": [
    "把内容分组，避免页面过长",
    "Group content to keep pages short",
  ],
  "components.toggleGroup": ["视图切换", "View switch"],
  "components.tabOverview": ["概览", "Overview"],
  "components.tabActivity": ["活动", "Activity"],
  "components.tabSettings": ["设置", "Settings"],
  "components.tabOverviewBody": [
    "标签页适合在同一层级切换视图，不改变路由。",
    "Tabs switch views within a level without changing the route.",
  ],
  "components.tabActivityBody": [
    "这里可以放时间线、日志或变更记录。",
    "Use this area for timelines, logs or changelogs.",
  ],
  "components.tabSettingsBody": [
    "表单类内容放在标签页里也很常见。",
    "Forms are another common tab content.",
  ],
  "components.faq": ["常见问题", "FAQ"],
  "components.faqQ1": ["如何新增页面？", "How do I add a page?"],
  "components.faqA1": [
    "在 src/routes.tsx 的 APP_ROUTES 里加一条记录，路由、侧边栏和标题会自动更新。",
    "Add an entry to APP_ROUTES in src/routes.tsx; routing, sidebar and title update automatically.",
  ],
  "components.faqQ2": ["如何新增 Rust 命令？", "How do I add a Rust command?"],
  "components.faqA2": [
    "在 commands.rs 里写函数并注册到 invoke_handler，再在 lib/tauri.ts 里包一层类型化函数。",
    "Add the function in commands.rs, register it in invoke_handler, then wrap it in lib/tauri.ts.",
  ],
  "components.faqQ3": ["主题色能改吗？", "Can I change the accent?"],
  "components.faqA3": [
    "可以。设置页提供 7 种主题色、3 档圆角、4 种字体与 4 种背景。",
    "Yes. Settings offers 7 accents, 3 radii, 4 fonts and 4 backgrounds.",
  ],

  // ---- 动效页 ----
  "motion.title": ["动效与过渡", "Motion & transitions"],
  "motion.subtitle": [
    "动效不是装饰：它负责交代状态从哪来、到哪去。这里的示例都用 CSS 与 View Transitions 实现，没有引入动画库。",
    "Motion explains where state comes from and where it goes. Everything here uses CSS and View Transitions, no animation library.",
  ],
  "motion.theme": ["主题圆形扩散", "Circular theme reveal"],
  "motion.themeHint": [
    "点击按钮时，新主题从鼠标位置以圆形扩散到整个窗口。关闭动效后会直接切换。",
    "On click, the new theme expands from the pointer as a circle. With motion disabled it switches instantly.",
  ],
  "motion.toggleTheme": ["点我切换主题", "Toggle theme"],
  "motion.stagger": ["列表错峰入场", "Staggered list"],
  "motion.staggerHint": [
    "每项延迟 40ms，让列表有节奏地出现。",
    "Each row is delayed 40ms for a sense of rhythm.",
  ],
  "motion.item": ["动效条目 {index}", "Motion item {index}"],
  "motion.hover": ["悬停浮起", "Hover lift"],
  "motion.hoverHint": [
    "卡片在悬停时轻微上浮并加深阴影。",
    "Cards lift slightly and deepen their shadow on hover.",
  ],
  "motion.skeleton": ["骨架屏微光", "Skeleton shimmer"],
  "motion.skeletonHint": [
    "加载中的占位，比转圈更少打断阅读。",
    "A loading placeholder that interrupts reading less than a spinner.",
  ],
  "motion.progress": ["进度动画", "Animated progress"],
  "motion.progressHint": [
    "数值变化时宽度平滑过渡。",
    "The bar eases to its new value.",
  ],
  "motion.marquee": ["滚动横幅", "Marquee"],
  "motion.marqueeHint": [
    "适合放构建状态或公告，鼠标悬停会暂停。",
    "Good for build status or notices; hover to pause.",
  ],
  "motion.marqueeText": [
    "构建 #128 通过 · 安装包 1.41 MB · 21 个测试全绿 · 文档 14 份 · ",
    "Build #128 passed · installer 1.41 MB · 21 tests green · 14 docs · ",
  ],
  "motion.motionOff": ["动效已关闭", "Motion is off"],
  "motion.motionOffHint": [
    "当前设置为精简动效，动画会直接跳到终态。可以在设置里重新开启。",
    "Motion is set to reduced, so animations jump to the end. Re-enable it in Settings.",
  ],

  // ---- 设置页 ----
  "settings.title": ["设置", "Settings"],
  "settings.subtitle": [
    "所有选项即时生效，并保存在本地。换台机器不会同步——这是桌面应用的本地偏好，不是账号设置。",
    "Every option applies instantly and is stored locally. These are device preferences, not account settings.",
  ],
  "settings.appearance": ["外观", "Appearance"],
  "settings.appearanceHint": [
    "主题、主题色、圆角、字体与背景",
    "Theme, accent, radius, font and background",
  ],
  "settings.theme": ["主题", "Theme"],
  "settings.accent": ["主题色", "Accent"],
  "settings.accentHint": [
    "影响按钮、选中态与强调元素",
    "Affects buttons, selections and highlights",
  ],
  "settings.radius": ["圆角", "Corner radius"],
  "settings.radiusSharp": ["直角", "Sharp"],
  "settings.radiusSoft": ["柔和", "Soft"],
  "settings.radiusRound": ["圆润", "Round"],
  "settings.font": ["字体", "Font"],
  "settings.fontGeist": ["Geist（默认）", "Geist (default)"],
  "settings.fontSystem": ["系统字体", "System"],
  "settings.fontSerif": ["衬线", "Serif"],
  "settings.fontMono": ["等宽", "Mono"],
  "settings.fontSize": ["字号", "Font size"],
  "settings.fontSizeSm": ["小", "Small"],
  "settings.fontSizeMd": ["中", "Medium"],
  "settings.fontSizeLg": ["大", "Large"],
  "settings.background": ["背景", "Background"],
  "settings.bgPlain": ["纯色", "Plain"],
  "settings.bgGradient": ["渐变", "Gradient"],
  "settings.bgGrid": ["网格", "Grid"],
  "settings.bgDots": ["圆点", "Dots"],
  "settings.motion": ["动效", "Motion"],
  "settings.motionHint": [
    "精简模式会减少过渡与动画",
    "Reduced mode shortens transitions and animations",
  ],
  "settings.motionFull": ["完整", "Full"],
  "settings.motionReduced": ["精简", "Reduced"],
  "settings.window": ["窗口", "Window"],
  "settings.menuBar": ["显示菜单栏", "Show menu bar"],
  "settings.menuBarHint": [
    "标题栏中的文件 / 编辑 / 视图 / 帮助",
    "File / Edit / View / Help in the title bar",
  ],
  "settings.customTitlebar": ["自定义标题栏", "Custom title bar"],
  "settings.customTitlebarHint": [
    "窗口边框由前端绘制：拖拽区域、双击最大化、最小化 / 最大化 / 关闭都已接好。macOS 使用系统红绿灯，按钮会自动隐藏。",
    "The window frame is drawn by the frontend: drag region, double-click maximize, and window buttons. macOS keeps its native traffic lights and the custom buttons hide themselves.",
  ],
  "settings.enabled": ["已启用", "Enabled"],
  "settings.runtime": ["运行时信息", "Runtime"],
  "settings.runtimeHint": [
    "来自 Rust 侧，浏览器预览时不可用",
    "Comes from Rust and is unavailable in browser preview",
  ],
  "settings.appVersion": ["应用版本", "App version"],
  "settings.tauriVersion": ["Tauri 版本", "Tauri version"],
  "settings.environment": ["运行环境", "Environment"],
  "settings.links": ["相关链接", "Links"],
  "settings.linksHint": [
    "点击后由系统默认浏览器打开",
    "Opens in your default browser",
  ],
  "settings.resetHint": [
    "只清空本应用的界面偏好，不影响业务数据",
    "Only clears UI preferences, not business data",
  ],

  // ---- 桥接页 ----
  "bridge.title": ["前端 ↔ Rust 通信", "Frontend ↔ Rust"],
  "bridge.subtitle": [
    "前端通过 invoke 调用 Rust 命令，返回值自动序列化为 TypeScript 类型。这是所有系统能力的入口。",
    "The frontend calls Rust via invoke and gets typed results back. This is the entry point for every system capability.",
  ],
  "bridge.demo": ["调用示例", "Call example"],
  "bridge.demoHint": [
    "修改参数后点按钮。名称留空会命中 Rust 侧的校验，用来演示错误如何跨 IPC 传回前端。",
    "Change the name and click. An empty name hits the Rust-side validation to show how errors cross IPC.",
  ],
  "bridge.name": ["名称", "Name"],
  "bridge.namePlaceholder": ["输入一个名字", "Enter a name"],
  "bridge.call": ["调用 greet", "Call greet"],
  "bridge.result": ["返回结果", "Result"],
  "bridge.notCalled": ["尚未调用", "Not called yet"],
  "bridge.success": ["Rust 命令执行成功", "Rust command succeeded"],
  "bridge.failed": ["调用失败：{error}", "Call failed: {error}"],
  "bridge.browserOnly": [
    "浏览器预览模式下无法调用，请用 pnpm app:dev 启动",
    "Not available in browser preview. Run pnpm app:dev.",
  ],
  "bridge.frontend": ["前端调用", "Frontend call"],
  "bridge.note": [
    "新增命令时记得把它注册进 invoke_handler，否则前端调用会报 “command not found”。",
    "Register new commands in invoke_handler, or the frontend will get “command not found”.",
  ],
} as const;

export type DictKey = keyof typeof DICT;

type I18nContextValue = {
  language: Language;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const language = settings.language;

  const value = useMemo<I18nContextValue>(() => {
    const t: I18nContextValue["t"] = (key, vars) => {
      const entry = DICT[key];
      let text: string = entry[language === "zh" ? 0 : 1];
      if (vars) {
        for (const [name, replacement] of Object.entries(vars)) {
          text = text.split(`{${name}}`).join(String(replacement));
        }
      }
      return text;
    };
    return { language, t };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n 必须在 I18nProvider 内使用");
  return context;
}
