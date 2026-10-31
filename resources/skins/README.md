# 窗口皮肤资源

这里维护窗口皮肤的透明线条 SVG。应用图标与安装器素材由 [branding](../branding/) 维护，使用独立的生成流程。

## 加载与维护

- [skin-artwork.tsx](../../src/components/skin-artwork.tsx) 通过 Vite 导入本地 SVG URL，窗口和设置缩略图使用同一份 CSS 蒙版。SVG 不注入页面 DOM，不加载远端资源。
- SVG 只画透明背景上的线条；[window-skins.css](../../src/styles/window-skins.css) 用当前主题的前景色与强调色混合着色。明暗与强调色切换即时生效，不需要为每款图形复制调色板。
- 图形围绕窗口边缘分布，中间留白；使用圆角线帽、少量曲线与疏朗点缀，保持静态线稿。
- 使用 `defs` / `use` 复用主体，资源保持自包含；位图、脚本、外链、动画、滤镜与体积 / 节点预算由现有 [资源检查](../../src/components/window-background.test.tsx) 约束。
- [backgrounds.ts](../../src/lib/backgrounds.ts) 的持久化 ID 保持稳定，展示名称和资源文件名独立维护。纯色选项不加载纹理。
- 新增皮肤时同步注册表、绘制映射和中英名称；修改图形后检查窗口与缩略图，特别是最强档位下的明暗阅读表面、窄屏裁剪及高对比度降级。共同材质规则见 [界面规范](../../docs/conventions/ui-guidelines.md#主题插画与轻量资源)。
- 用户照片由“我的壁纸”图库管理，保留照片颜色。当前存储边界见[架构说明](../../docs/architecture.md#数据存储)，分离图库与当前背景的决策见 [ADR 0004](../../docs/adr/0004-wallpaper-library.md)。

## 图形与资源

稳定 ID 用于设置存储，名称与图形可独立调整。

| 皮肤 / 稳定 ID        | SVG 源                                     | 主体                   |
| --------------------- | ------------------------------------------ | ---------------------- |
| 猫咪涂鸦 / aurora     | [cat-doodles.svg](./cat-doodles.svg)       | 猫咪轮廓、爪印         |
| 咖啡时光 / dune       | [coffee-break.svg](./coffee-break.svg)     | 咖啡杯、蒸汽、可颂     |
| 远山手记 / inkwash    | [mountain-notes.svg](./mountain-notes.svg) | 山峰、日出、小屋       |
| 星星手帐 / starlight  | [star-notes.svg](./star-notes.svg)         | 圆角星星、小闪光       |
| 云朵晴空 / sakura     | [cloud-notes.svg](./cloud-notes.svg)       | 云朵、太阳、雨丝       |
| 月相漫游 / moonlit    | [moon-orbits.svg](./moon-orbits.svg)       | 弯月、环形星球         |
| 枝叶小笺 / botanical  | [leaf-notes.svg](./leaf-notes.svg)         | 枝叶、花朵             |
| 纸上飞行 / cloudscape | [paper-flights.svg](./paper-flights.svg)   | 纸飞机、信封、虚线轨迹 |
