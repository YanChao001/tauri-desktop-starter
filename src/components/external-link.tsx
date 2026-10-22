import type { ComponentProps, MouseEvent } from "react";
import { useOpenExternal } from "@/hooks/use-external-links";
import { isTauri } from "@/lib/tauri";

/** 原生窗口由链接自身打开系统浏览器，浏览器演示保留标准链接行为。 */
export function ExternalLink({
  href,
  target = "_blank",
  rel = "noopener noreferrer",
  onClick,
  onAuxClick,
  ...props
}: ComponentProps<"a"> & { href: string }) {
  const open = useOpenExternal();
  function activate(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || !isTauri()) return;
    event.preventDefault();
    open(event.currentTarget.href);
  }
  return (
    <a
      {...props}
      href={href}
      target={target}
      rel={rel}
      onClick={(event) => {
        onClick?.(event);
        if (event.button === 0) activate(event);
      }}
      onAuxClick={(event) => {
        onAuxClick?.(event);
        if (event.button === 1) activate(event);
      }}
    />
  );
}
