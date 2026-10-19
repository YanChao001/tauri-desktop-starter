# 界面规范

> 目标是"看起来是同一个产品"，而不是"每个人都发挥一下审美"。
> 所有取值都来自 `src/index.css` 的 CSS 变量和 Tailwind 刻度，不要引入新的魔法数字。

## 设计基础

- 组件库：shadcn/ui（`radix-nova` 风格），配置在 `components.json`
- 基础样式：`src/styles/shadcn.css`（内置自上游，勿手改；升级方式见文件头注释）
- 字体：默认 Geist Variable；设置页可切到系统字体 / 衬线 / 等宽
- 圆角：`--radius` 变量派生，组件里用 `rounded-md` / `rounded-lg`，不要写 `rounded-[7px]`
- 主题：`next-themes` + `.dark` class；颜色全部走 CSS 变量

## 外观设置

外观由 `<html>` 上的 data 属性驱动，组件只写语义 token，不判断当前设置：

| 属性              | 取值                                                      | 作用                                                         |
| ----------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| `data-accent`     | neutral / indigo / blue / emerald / amber / rose / violet | 覆盖 `--primary`、`--ring`、`--chart-1`、`--sidebar-primary` |
| `data-radius`     | sharp / soft / round                                      | 改写 `--radius`                                              |
| `data-font`       | geist / system / serif / mono                             | 改写 `--font-sans`                                           |
| `data-font-size`  | sm / md / lg                                              | 根字号 14 / 16 / 17px                                        |
| `data-background` | plain / gradient / grid / dots                            | body 背景纹理                                                |
| `data-motion`     | full / reduced                                            | 全局压缩动画与过渡                                           |

**加一个外观项的顺序**：`providers/settings.tsx` 加类型、默认值、校验 →
`applySettings` 写 data 属性 → `index.css` 写对应规则 → 设置页加控件。
不要在业务组件里读 `useSettings()` 来决定颜色。

## 标题栏

- 高度 40px（`h-10`），自绘：左侧应用名与菜单，右侧主题切换与窗口按钮。
- 拖拽区域用 `data-tauri-drag-region`，只加在空白容器上；按钮与菜单不要加。
- 窗口按钮只在 Tauri 原生窗口显示；浏览器预览显示「浏览器预览」小标签。
- macOS 保留系统红绿灯（`tauri.macos.conf.json`），标题栏左侧留 `pl-[78px]` 并隐藏自绘按钮。
- 平台判断统一走 `lib/platform.ts`，不要在组件里解析 UA。

## 颜色：只用语义 token

| Token                                    | 用在哪                               |
| ---------------------------------------- | ------------------------------------ |
| `bg-background` / `text-foreground`      | 页面底色与主文字                     |
| `bg-card` / `text-card-foreground`       | 卡片                                 |
| `bg-muted` / `text-muted-foreground`     | 次级区块（代码块、只读区）、次要文字 |
| `bg-primary` / `text-primary-foreground` | 主按钮、强调元素                     |
| `bg-destructive`                         | 删除、不可逆操作                     |
| `border` / `border-sidebar-border`       | 分隔线                               |
| `bg-sidebar` / `text-sidebar-foreground` | 侧边栏                               |

**禁止**：

```tsx
// 错：写死颜色，切到深色模式就废了
<div className="bg-white text-gray-600 border-gray-200" />
<div className="text-[#333]" />

// 对：语义 token
<div className="bg-card text-muted-foreground border" />
```

例外只有两处：图表配色、第三方组件无法覆盖时。遇到例外在 PR 里说明。

## 布局常量

| 区域         | 值      | 类名                      |
| ------------ | ------- | ------------------------- |
| 标题栏高度   | 40px    | `h-10`                    |
| 页面标题栏   | 44px    | `h-11`                    |
| 侧边栏宽度   | 224px   | `w-56`                    |
| 内容最大宽度 | 1024px  | `max-w-5xl`               |
| 内容区内边距 | 24px    | `px-6 py-6`               |
| 卡片之间     | 12px    | `gap-3`                   |
| 页面区块之间 | 20–24px | `space-y-5` / `space-y-6` |

窗口最小尺寸 880×600（`tauri.conf.json`）。新增页面要在这个尺寸下检查，不要只在最大化时看效果。

## 字号层级

| 层级       | 字号    | 类名                            |
| ---------- | ------- | ------------------------------- |
| 页面大标题 | 24px    | `text-2xl`                      |
| 区块标题   | 16px    | `text-base`                     |
| 卡片标题   | 14px    | `text-sm font-medium`           |
| 正文       | 14px    | `text-sm`                       |
| 辅助说明   | 12px    | `text-xs text-muted-foreground` |
| 代码       | 12–13px | `font-mono text-xs`             |

一屏之内不要超过三个字号层级。正文类文字不小于 12px（`text-xs`），再小在高分屏上会糊；
确实需要更小（如图表刻度）时，只用于非关键信息。

## 组件选择顺序

按这个顺序找，找到就停：

1. `src/components/ui/` 里已有的组件
2. 用已有组件组合（不要为了一个布局装新库）
3. `pnpm dlx shadcn@latest add <name>` 新增
4. 自己写——最后才考虑，写完放进 `src/components/<domain>/`

自己写之前先想清楚：这个组件三个月后会不会有人要改？如果会，尽量用 shadcn 的，至少样式体系是一致的。

## 每个数据区必须有三种状态

| 状态 | 要求                                                     |
| ---- | -------------------------------------------------------- |
| 空   | 说明为什么空 + 下一步动作，不要只写"暂无数据"            |
| 加载 | 骨架屏或 `Loader2Icon` 旋转，超过 300ms 才显示，避免闪烁 |
| 错误 | 说清原因 + 重试按钮，不要吞掉异常                        |

当前工程里的 `bridge.tsx` 是参照实现：调用中禁用按钮、成功弹 toast、失败弹 toast 并保留输入。

## 交互反馈

- 可点击元素必须有 hover 与 focus-visible 反馈，只在 hover 上做反馈会让键盘用户迷路。
- 危险操作（删除、清空）用 `variant="destructive"`，且需要二次确认。
- 按钮禁用时用 `disabled` 属性，不要用 `pointer-events-none` 假装禁用（屏幕阅读器读不到）。
- 表单校验错误显示在字段下方，`text-xs`，不要用 alert。

## 无障碍底线

- 只有图标的按钮必须有 `aria-label`，例如主题切换按钮。
- 不要移除焦点环；需要美化就换颜色，不要 `outline: none`。
- 颜色不能是唯一的信息载体（成功/失败要同时有图标或文字）。
- 弹窗、下拉菜单要能用键盘操作，Esc 能关。
- 图片有 `alt`，装饰性图片用 `alt=""`。

## 深色模式检查清单

每加一个页面，切到深色模式过一遍：

- [ ] 没有写死的浅色背景或深色文字
- [ ] 边框在深色下仍然可见（用 `border` token，不要 `border-gray-200`）
- [ ] 图标与插图在深色下对比度足够
- [ ] 阴影在深色下不会变成"发光的脏块"

## 动效

- 交互反馈 150ms 左右，页面切换不超过 300ms。
- 只动 `transform` 与 `opacity`，不要动 `width`/`height`/`top`（会触发重排）。
- `prefers-reduced-motion` 下应能降级，至少做到不阻塞操作。
- 主题切换用 View Transitions 的圆形裁剪（`hooks/use-theme-switch.ts`）；
  关闭动效时直接切换，不播放动画。
- 列表入场用 `animate-fade-up` + 每项 40ms 延迟，不要给每个元素写一套 keyframes。

## 中文排版

- 中英文之间留一个空格：`打开 WebView 设置`。
- 数字与单位之间不加空格：`3.4MB`、`120ms`。
- 引号用「」或 ""，不要用英文直引号包中文。
- 长文本容器加 `leading-relaxed`，中文行高比英文更需要呼吸感。

## 新增一个页面

三步，缺一不可：

```tsx
// 1. src/pages/reports.tsx —— 默认导出，页面只负责编排
export default function Reports() {
  return <div className="space-y-5">...</div>;
}
```

```tsx
// 2. src/routes.tsx —— 加一条路由，侧边导航会自动出现
{
  path: "/reports",
  label: "报表",
  icon: FileTextIcon,
  component: Reports,
}
```

`routes.tsx` 是路由与导航的唯一数据源，不要再去 `App.tsx` 或 `app-shell.tsx` 里各改一遍。

页面的业务逻辑抽到 `src/lib/` 或 `src/hooks/`，`pages/` 里只做组合，方便以后复用到别处。
