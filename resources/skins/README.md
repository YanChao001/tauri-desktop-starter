# 窗口皮肤资源

这里维护八款透明的手绘线条 SVG。应用图标和安装器素材属于品牌身份，放在相邻的 [branding](../branding/)；窗口纹理不参与平台图标与安装器位图生成。

## 加载与维护

- [skin-artwork.tsx](../../src/components/skin-artwork.tsx) 通过 Vite 导入本地 SVG URL，窗口和设置缩略图使用同一份 CSS 蒙版。SVG 不注入页面 DOM，不加载远端资源。
- SVG 只画透明背景上的线条；[window-skins.css](../../src/styles/window-skins.css) 用当前主题的前景色与强调色混合着色。明暗与强调色切换即时生效，不需要为每款图形复制调色板。
- 图形围绕窗口边缘分布，中间留白；圆角线帽、少量曲线、疏朗点缀，不加照片描摹、滤镜、模糊、发光或大面积实色背景。
- 每张源文件不超过 16KiB、80 个 SVG 元素。使用 defs / use 复用主体；禁止嵌入位图、脚本、外部链接或动画。
- [backgrounds.ts](../../src/lib/backgrounds.ts) 的持久化 ID 保持稳定，展示名称和资源文件名独立维护。纯色选项不加载纹理。
- 全窗口覆盖标题栏、侧栏和内容区，阅读表面分别调节透明度。最强档位也需检查浅色 / 深色、不同强调色、窄屏和高对比度下的文字可读性。
- 用户照片由“我的壁纸”图库管理，保留照片颜色。存储、数量和兼容边界见 [ADR 0004](../../docs/adr/0004-wallpaper-library.md)。

## 图形与资源

这些纹理由通用几何图形与手绘曲线构成。

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
