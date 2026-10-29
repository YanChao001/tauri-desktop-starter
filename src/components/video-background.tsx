import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDemoMotion } from "@/hooks/use-demo-motion";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import type { CustomBackground } from "@/lib/background-image";
import { resolveWallpaperVideo } from "@/lib/video-wallpaper";

type VideoBackgroundProps = {
  background: CustomBackground;
  enabled: boolean;
};

/** 动态装饰只在可见且允许动效时播放，静止状态使用已保存的封面。 */
export function VideoBackground({ background, enabled }: VideoBackgroundProps) {
  const surface = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const session = useRef(0);
  const reported = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const { active } = useDemoMotion(surface, enabled);
  const translateLatest = useLatestTranslator();
  const videoId = background.video?.id;
  const videoMime = background.video?.mime;

  useEffect(() => {
    const element = player.current;
    if (!element || !videoId || !videoMime || !active || failed) return;
    const attempt = ++session.current;
    let stopped = false;
    let release: (() => void) | undefined;
    const fail = () => {
      if (stopped || reported.current) return;
      reported.current = true;
      element.pause();
      setPlaying(false);
      setFailed(true);
      toast.error(translateLatest("settings.videoPlaybackError"));
    };
    element.addEventListener("error", fail);
    void resolveWallpaperVideo({ id: videoId, mime: videoMime })
      .then(async (resource) => {
        if (stopped) {
          resource.release();
          return;
        }
        release = resource.release;
        element.src = resource.url;
        element.muted = true;
        await element.play();
        if (stopped) {
          // 新一轮播放已接管同一元素时，旧回执不能暂停它。
          if (session.current === attempt) element.pause();
          return;
        }
        if (document.visibilityState === "hidden") {
          element.pause();
          return;
        }
        setPlaying(true);
      })
      .catch(fail);
    return () => {
      stopped = true;
      setPlaying(false);
      element.removeEventListener("error", fail);
      element.pause();
      element.removeAttribute("src");
      element.load();
      release?.();
    };
  }, [active, failed, videoId, videoMime, translateLatest]);

  const showVideo = active && playing && !failed;
  return (
    <div ref={surface} className="relative size-full" aria-hidden="true">
      {!showVideo ? (
        <img
          className="custom-background-image absolute inset-0"
          data-custom-background
          src={background.dataUrl}
          alt=""
          draggable={false}
          style={{ objectFit: background.fit }}
        />
      ) : null}
      <video
        ref={player}
        className="custom-background-image absolute inset-0"
        data-video-background
        data-custom-background-video
        data-custom-background={showVideo ? "" : undefined}
        data-playing={showVideo}
        muted
        loop
        playsInline
        crossOrigin="anonymous"
        preload="metadata"
        tabIndex={-1}
        style={{
          objectFit: background.fit,
          visibility: showVideo ? "visible" : "hidden",
        }}
      />
    </div>
  );
}
