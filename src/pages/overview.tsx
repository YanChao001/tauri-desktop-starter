import { useId, useRef, useState, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import { motion, useMotionValue, useSpring } from "motion/react";
import {
  ArrowDownRightIcon,
  ArrowRightIcon,
  CheckIcon,
  CommandIcon,
  LayersIcon,
  MonitorIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SparklesIcon,
  WandSparklesIcon,
} from "lucide-react";
import { toast } from "sonner";
import { JourneyLauncher } from "@/features/journeys/journey-launcher";
import { JOURNEYS, journeyLink } from "@/features/journeys/model";
import { Button } from "@/components/ui/button";
import { PatternArtwork } from "@/components/window-background";
import { useDemoMotion } from "@/hooks/use-demo-motion";
import { useThemeSwitch } from "@/hooks/use-theme-switch";
import { useCommands } from "@/providers/commands";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";
import { isTauri } from "@/lib/tauri";
import type { AppSettings } from "@/lib/settings-model";
import { APP_CONFIG } from "@/config/app";
import "@/styles/showroom.css";

const VIBES = [
  {
    id: "starlight",
    label: "showroom.starlight",
    accent: "violet",
    background: "starlight",
    theme: "dark",
    radius: "round",
  },
  {
    id: "sakura",
    label: "showroom.sakura",
    accent: "rose",
    background: "sakura",
    theme: "light",
    radius: "soft",
  },
  {
    id: "daylight",
    label: "showroom.daylight",
    accent: "blue",
    background: "cloudscape",
    theme: "light",
    radius: "soft",
  },
] as const;
type Appearance = Pick<
  AppSettings,
  "accent" | "background" | "backgroundIntensity" | "theme" | "radius"
>;

/** 原创矢量造型，仅在场景可见时运行环境动效 */
function LightSculpture() {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      viewBox="0 0 420 300"
      className="showroom-sculpture"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={`${id}-fold`}
          x1="88"
          y1="60"
          x2="320"
          y2="275"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="var(--scene-light)" />
          <stop offset=".47" stopColor="var(--scene-main)" />
          <stop offset="1" stopColor="var(--scene-deep)" />
        </linearGradient>
        <linearGradient
          id={`${id}-edge`}
          x1="110"
          y1="70"
          x2="290"
          y2="250"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="white" stopOpacity=".95" />
          <stop offset="1" stopColor="var(--scene-light)" stopOpacity=".15" />
        </linearGradient>
        <radialGradient id={`${id}-halo`}>
          <stop stopColor="var(--scene-main)" stopOpacity=".42" />
          <stop offset="1" stopColor="var(--scene-main)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="210" cy="180" rx="190" ry="118" fill={`url(#${id}-halo)`} />
      <g className="showroom-sculpture-float">
        <path
          d="M210 38 336 116 292 236 170 265 84 170 126 82Z"
          fill={`url(#${id}-fold)`}
        />
        <path
          d="M210 38 232 141 336 116 126 82 170 265 232 141 84 170 292 236 210 38Z"
          fill="white"
          fillOpacity=".14"
        />
        <path
          d="m126 82 106 59 60 95M84 170l148-29 104-25M210 38l22 103-62 124"
          fill="none"
          stroke={`url(#${id}-edge)`}
          strokeWidth="1.3"
        />
        <path
          d="m210 38 126 78-44 120-122 29-86-95 42-88Z"
          fill="none"
          stroke="white"
          strokeOpacity=".3"
        />
        <path
          d="m232 98 7 27 27 8-27 8-7 27-8-27-26-8 26-8Z"
          fill="white"
          fillOpacity=".85"
        />
      </g>
      <g fill="none" stroke="var(--scene-light)" strokeOpacity=".5">
        <ellipse
          cx="210"
          cy="170"
          rx="180"
          ry="55"
          transform="rotate(-22 210 170)"
        />
        <ellipse
          cx="210"
          cy="170"
          rx="166"
          ry="70"
          transform="rotate(28 210 170)"
        />
      </g>
      <g className="showroom-sparks" fill="var(--scene-light)">
        <circle cx="57" cy="139" r="3" />
        <circle cx="357" cy="107" r="4" />
        <path d="m320 241 3-9 3 9 9 3-9 3-3 9-3-9-9-3Z" />
        <path d="m103 51 2-7 2 7 7 2-7 2-2 7-2-7-7-2Z" />
      </g>
    </svg>
  );
}

export default function Overview() {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const { setPaletteOpen } = useCommands();
  const { setTheme } = useThemeSwitch();
  const [vibeIndex, setVibeIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [previous, setPrevious] = useState<Appearance | null>(null);
  const scene = useRef<HTMLDivElement>(null);
  const { reduced, active } = useDemoMotion(scene, !paused);
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const rotateX = useSpring(pointerY, { stiffness: 180, damping: 25 });
  const rotateY = useSpring(pointerX, { stiffness: 180, damping: 25 });
  const vibe = VIBES[vibeIndex]!;
  const applied =
    settings.background === vibe.background &&
    settings.accent === vibe.accent &&
    settings.theme === vibe.theme &&
    settings.radius === vibe.radius &&
    settings.backgroundIntensity === "balanced";
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!active || event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerX.set(((event.clientX - bounds.left) / bounds.width - 0.5) * 13);
    pointerY.set(-((event.clientY - bounds.top) / bounds.height - 0.5) * 10);
  }
  function resetPointer() {
    pointerX.set(0);
    pointerY.set(0);
  }
  function applyAppearance() {
    if (!previous)
      setPrevious({
        accent: settings.accent,
        background: settings.background,
        backgroundIntensity: settings.backgroundIntensity,
        radius: settings.radius,
        theme: settings.theme,
      });
    update({
      accent: vibe.accent,
      background: vibe.background,
      backgroundIntensity: "balanced",
      radius: vibe.radius,
    });
    setTheme(vibe.theme);
    toast.success(t("showroom.appliedToast"));
  }
  function undoAppearance() {
    if (!previous) return;
    update(previous);
    setTheme(previous.theme);
    setPrevious(null);
    toast.success(t("showroom.undoToast"));
  }
  if (settings.appMode === "minimal")
    return (
      <div className="studio-page showroom-minimal">
        <div className="studio-intro">
          <span className="studio-eyebrow">{t("showroom.workspace")}</span>
          <h2>{t("home.title", { name: APP_CONFIG.name })}</h2>
          <p>{t("showroom.workspaceHint")}</p>
        </div>
        <div className="showroom-workspace-links">
          {(
            [
              { to: "/desktop", label: "home.desktop", icon: MonitorIcon },
              { to: "/database", label: "home.database", icon: LayersIcon },
              {
                to: "/settings",
                label: "home.settings",
                icon: WandSparklesIcon,
              },
            ] as const
          ).map(({ to, label, icon: Icon }) => (
            <Link
              className="studio-panel showroom-workspace-link"
              to={to}
              key={to}
            >
              <Icon />
              <span>{t(label)}</span>
              <ArrowRightIcon />
            </Link>
          ))}
        </div>
      </div>
    );
  return (
    <div className="studio-page showroom" data-testid="showroom">
      <section className="showroom-hero" aria-labelledby="showroom-heading">
        <div className="showroom-hero-copy">
          <span className="studio-eyebrow">
            <span className="showroom-live-dot" />
            {t("showroom.eyebrow")}
          </span>
          <motion.h2
            id="showroom-heading"
            initial={reduced ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="showroom-headline"
          >
            <span>{t("showroom.title")}</span>
            <span className="showroom-gradient-text">
              {t("showroom.titleAccent")}
            </span>
          </motion.h2>
          <p className="showroom-lede">{t("showroom.description")}</p>
          <div className="showroom-hero-actions">
            <Button asChild size="lg">
              <Link to={journeyLink(JOURNEYS[0])}>
                <SparklesIcon />
                {t("showroom.start")}
                <ArrowRightIcon />
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <Link to="/motion">
                {t("nav.motion")}
                <ArrowDownRightIcon />
              </Link>
            </Button>
          </div>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="showroom-command-link"
          >
            <CommandIcon size={15} />
            <span>{t("showroom.shortcut")}</span>
            <kbd>⌘ / Ctrl K</kbd>
            <span className="sr-only">{t("showroom.commands")}</span>
          </button>
        </div>
        <div
          ref={scene}
          className="showroom-scene"
          data-vibe={vibe.id}
          data-active={active}
          onPointerMove={move}
          onPointerLeave={resetPointer}
          aria-label={t("showroom.preview")}
        >
          <div className="showroom-scene-aura" aria-hidden="true" />
          <div className="showroom-scene-label">
            <span>{t("showroom.preview")}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={reduced}
              aria-label={t(paused ? "showroom.play" : "showroom.pause")}
              onClick={() => {
                setPaused((value) => !value);
                resetPointer();
              }}
            >
              {paused || reduced ? <PlayIcon /> : <PauseIcon />}
            </Button>
          </div>
          <motion.div
            className="showroom-window"
            style={{
              rotateX: reduced ? 0 : rotateX,
              rotateY: reduced ? 0 : rotateY,
            }}
            aria-hidden="true"
          >
            <div className="showroom-window-chrome">
              <span className="showroom-window-dots">
                <i />
                <i />
                <i />
              </span>
              <span>{t("showroom.canvas")}</span>
              <SparklesIcon size={12} />
            </div>
            <div className="showroom-window-art">
              <PatternArtwork kind={vibe.background} preview />
              <LightSculpture />
              <span className="showroom-window-canvas-label">
                {t("showroom.canvasNote")}
              </span>
            </div>
            <div className="showroom-window-footer">
              <div className="showroom-avatars">
                <span>A</span>
                <span>M</span>
                <span>Y</span>
              </div>
              <span>{t("showroom.collectionHint")}</span>
              <span className="showroom-mini-check">
                <CheckIcon size={12} />
              </span>
            </div>
          </motion.div>
          <div className="showroom-floating-note" aria-hidden="true">
            <span className="showroom-note-icon">
              <LayersIcon size={18} />
            </span>
            <div>
              <strong>{t("showroom.collection")}</strong>
              <span>{t("showroom.collectionHint")}</span>
            </div>
            <SparklesIcon size={16} />
          </div>
          <div className="showroom-pointer-hint">
            {t(reduced ? "showroom.reduced" : "showroom.pointer")}
          </div>
        </div>
      </section>
      <JourneyLauncher />
      <section
        className="showroom-vibes studio-panel"
        aria-labelledby="showroom-vibes-heading"
      >
        <div>
          <h3 id="showroom-vibes-heading">{t("showroom.chooseVibe")}</h3>
          <p>{t("showroom.vibeHint")}</p>
        </div>
        <fieldset className="showroom-vibe-options">
          <legend className="sr-only">{t("showroom.chooseVibe")}</legend>
          {VIBES.map((item, index) => (
            <label
              key={item.id}
              className="showroom-vibe"
              data-vibe={item.id}
              data-selected={vibeIndex === index}
            >
              <input
                className="sr-only"
                type="radio"
                name="showroom-vibe"
                value={item.id}
                checked={vibeIndex === index}
                onChange={() => setVibeIndex(index)}
              />
              <span className="showroom-vibe-swatch" aria-hidden="true" />
              <span>{t(item.label)}</span>
              {vibeIndex === index ? <CheckIcon size={12} /> : null}
            </label>
          ))}
        </fieldset>
        <div className="showroom-vibe-actions">
          <Button
            size="sm"
            variant="outline"
            disabled={applied}
            onClick={applyAppearance}
          >
            {applied ? <CheckIcon /> : <WandSparklesIcon />}
            {t(applied ? "showroom.applied" : "showroom.apply")}
          </Button>
          {previous ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("showroom.undo")}
              title={t("showroom.undo")}
              onClick={undoAppearance}
            >
              <RotateCcwIcon />
            </Button>
          ) : null}
        </div>
      </section>
      <div className="showroom-runtime-note">
        <MonitorIcon size={14} />
        <span>
          {t(isTauri() ? "showroom.nativeLive" : "showroom.browserLive")}
        </span>
        <Link to="/desktop">
          {t("showroom.next")}
          <ArrowRightIcon size={13} />
        </Link>
      </div>
    </div>
  );
}
