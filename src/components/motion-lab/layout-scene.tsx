import { useEffect, useId, useRef, useState } from "react";
import { LayoutGroup, motion } from "motion/react";
import {
  CheckIcon,
  CompassIcon,
  MoveUpRightIcon,
  StarsIcon,
  WandSparklesIcon,
} from "lucide-react";
import { useI18n } from "@/providers/i18n";
import { Notes, StageGuides, type SceneProps } from "./shared";
const CARDS = [
  {
    label: "lab.atelier",
    detail: "lab.atelierDetail",
    icon: WandSparklesIcon,
    color: "violet",
  },
  {
    label: "lab.journal",
    detail: "lab.journalDetail",
    icon: StarsIcon,
    color: "rose",
  },
  {
    label: "lab.discover",
    detail: "lab.discoverDetail",
    icon: CompassIcon,
    color: "cyan",
  },
] as const;
export function LayoutScene({ active, reduced, replay, stageRef }: SceneProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState(0);
  const [snappy, setSnappy] = useState(false);
  const [composition, setComposition] = useState("fan");
  const group = useId();
  const previousReplay = useRef(replay);
  useEffect(() => {
    if (previousReplay.current !== replay) {
      previousReplay.current = replay;
      setSelected((value) => (value + 1) % CARDS.length);
    }
  }, [replay]);
  return (
    <>
      <div className="lab-stage lab-layout-stage" ref={stageRef}>
        <StageGuides label={t("lab.layout")} />
        <LayoutGroup id={group} key={active ? "moving" : "still"}>
          <div
            className="lab-layout-tabs"
            role="group"
            aria-label={t("lab.layoutChoice")}
          >
            {CARDS.map((card, index) => (
              <button
                key={card.label}
                type="button"
                aria-pressed={selected === index}
                onClick={() => setSelected(index)}
              >
                {selected === index && (
                  <motion.span
                    layoutId="selection"
                    className="lab-layout-selection"
                    transition={
                      active
                        ? {
                            type: "spring",
                            stiffness: snappy ? 500 : 200,
                            damping: 30,
                          }
                        : { duration: 0 }
                    }
                  />
                )}
                <span>{t(card.label)}</span>
              </button>
            ))}
          </div>
          <div className="lab-space-cards" data-composition={composition}>
            {CARDS.map((card, index) => (
              <motion.button
                key={card.label}
                type="button"
                layout={active && !reduced}
                className={`lab-space-card lab-card-${card.color}`}
                data-selected={selected === index}
                aria-pressed={selected === index}
                onClick={() => setSelected(index)}
                style={{ flex: selected === index ? 2.4 : 0.65 }}
                transition={
                  active
                    ? {
                        type: "spring",
                        stiffness: snappy ? 500 : 180,
                        damping: snappy ? 35 : 24,
                      }
                    : { duration: 0 }
                }
              >
                <motion.span
                  layout={active ? "position" : false}
                  className="lab-space-symbol"
                >
                  <card.icon />
                </motion.span>
                <div className="lab-space-art" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                <motion.span
                  layout={active ? "position" : false}
                  className="lab-space-copy"
                >
                  <strong>{t(card.label)}</strong>
                  {selected === index && <span>{t(card.detail)}</span>}
                </motion.span>
                {selected === index && (
                  <MoveUpRightIcon
                    className="lab-space-arrow"
                    aria-hidden="true"
                  />
                )}
              </motion.button>
            ))}
          </div>
        </LayoutGroup>
      </div>
      <aside className="lab-control-panel">
        <h3>{t("lab.controls")}</h3>
        <div
          className="lab-focus-options"
          role="group"
          aria-label={t("lab.layoutChoice")}
        >
          {CARDS.map((card, index) => (
            <button
              key={card.label}
              type="button"
              aria-pressed={selected === index}
              onClick={() => setSelected(index)}
            >
              <card.icon />
              <span>{t(card.label)}</span>
              {selected === index && <CheckIcon />}
            </button>
          ))}
        </div>
        <div className="lab-presets">
          <span>{t("lab.composition")}</span>
          <div>
            {(["fan", "grid"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={composition === value}
                onClick={() => setComposition(value)}
              >
                {t(value === "fan" ? "lab.layoutFan" : "lab.layoutGrid")}
              </button>
            ))}
          </div>
        </div>
        <div className="lab-presets">
          <span>{t("lab.layoutSpeed")}</span>
          <div>
            <button
              type="button"
              aria-pressed={!snappy}
              onClick={() => setSnappy(false)}
            >
              {t("lab.smooth")}
            </button>
            <button
              type="button"
              aria-pressed={snappy}
              onClick={() => setSnappy(true)}
            >
              {t("lab.snappy")}
            </button>
          </div>
        </div>
        <Notes>{t("lab.layoutNote")}</Notes>
      </aside>
    </>
  );
}
