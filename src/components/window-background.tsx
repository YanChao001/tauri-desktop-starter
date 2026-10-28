import { useSettings } from "@/providers/settings";
import { PatternArtwork } from "@/components/skin-artwork";
import { VideoBackground } from "@/components/video-background";

export { PatternArtwork } from "@/components/skin-artwork";

/** 装饰固定铺满窗口，不参与滚动、点击、拖拽或键盘焦点。 */
export function WindowBackground({
  videoPlayback = true,
}: { videoPlayback?: boolean } = {}) {
  const { settings } = useSettings();
  return (
    <div
      className="window-background"
      data-window-background
      aria-hidden="true"
    >
      {settings.background === "custom" ? (
        settings.customBackground ? (
          settings.customBackground.video && videoPlayback ? (
            <VideoBackground
              key={settings.customBackground.video.id}
              background={settings.customBackground}
              enabled={settings.backgroundIntensity > 0}
            />
          ) : (
            <img
              className="custom-background-image"
              data-custom-background
              src={settings.customBackground.dataUrl}
              alt=""
              draggable={false}
              style={{ objectFit: settings.customBackground.fit }}
            />
          )
        ) : null
      ) : (
        <PatternArtwork kind={settings.background} />
      )}
    </div>
  );
}
