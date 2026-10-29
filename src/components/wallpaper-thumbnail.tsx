import { useEffect, useRef, useState } from "react";

/** 卡片按显示尺寸生成平滑预览；壁纸原图和存档内容保持独立。 */
export function WallpaperThumbnail({ dataUrl }: { dataUrl: string }) {
  const element = useRef<HTMLImageElement>(null);
  const [preview, setPreview] = useState<{ source: string; dataUrl: string }>();

  useEffect(() => {
    const target = element.current;
    if (!target) return;
    const image = new Image();
    if (typeof image.decode !== "function") return;
    let cancelled = false;
    let decoded = false;
    let previousSize = "";

    const draw = () => {
      if (cancelled || !decoded) return;
      const { width, height } = target.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const ratio = window.devicePixelRatio || 1;
      const pixelWidth = Math.ceil(width * ratio);
      const pixelHeight = Math.ceil(height * ratio);
      const size = `${pixelWidth}:${pixelHeight}`;
      if (size === previousSize) return;
      previousSize = size;
      const scale = Math.max(
        pixelWidth / image.naturalWidth,
        pixelHeight / image.naturalHeight,
      );
      if (scale >= 1) {
        setPreview(undefined);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      const cropWidth = pixelWidth / scale;
      const cropHeight = pixelHeight / scale;
      context.drawImage(
        image,
        (image.naturalWidth - cropWidth) / 2,
        (image.naturalHeight - cropHeight) / 2,
        cropWidth,
        cropHeight,
        0,
        0,
        pixelWidth,
        pixelHeight,
      );
      setPreview({ source: dataUrl, dataUrl: canvas.toDataURL("image/png") });
      canvas.width = 0;
      canvas.height = 0;
    };

    const observer = new ResizeObserver(draw);
    observer.observe(target);
    window.addEventListener("resize", draw);
    image.src = dataUrl;
    void image
      .decode()
      .then(() => {
        if (cancelled) return;
        decoded = true;
        draw();
      })
      .catch(() => {
        // 解码或重采样不可用时，继续显示已保存的原图。
      });

    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener("resize", draw);
      image.src = "";
    };
  }, [dataUrl]);

  return (
    <img
      ref={element}
      src={preview?.source === dataUrl ? preview.dataUrl : dataUrl}
      alt=""
      draggable={false}
      loading="lazy"
      decoding="async"
    />
  );
}
