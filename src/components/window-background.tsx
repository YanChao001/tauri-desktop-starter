import { useSettings } from "@/providers/settings";
import { PatternArtwork } from "@/components/skin-artwork";

export { PatternArtwork } from "@/components/skin-artwork";

/** 装饰固定铺满窗口，不参与滚动、点击、拖拽或键盘焦点。 */
export function WindowBackground() {
  const { settings } = useSettings();
  return (
    <div
      className="window-background"
      data-window-background
      aria-hidden="true"
    >
      {settings.background === "custom" ? (
        settings.customBackground ? (
          <img
            className="custom-background-image"
            data-custom-background
            src={settings.customBackground.dataUrl}
            alt=""
            draggable={false}
            style={{ objectFit: settings.customBackground.fit }}
          />
        ) : null
      ) : (
        <PatternArtwork kind={settings.background} />
      )}
    </div>
  );
}
