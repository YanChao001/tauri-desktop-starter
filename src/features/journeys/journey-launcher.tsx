import { Link } from "react-router-dom";
import {
  ArrowUpRightIcon,
  BlocksIcon,
  FilesIcon,
  ListTodoIcon,
  ShieldCheckIcon,
  MonitorIcon,
} from "lucide-react";
import { JOURNEYS, journeyLink } from "./model";
import { useI18n } from "@/providers/i18n";
import "@/styles/experience.css";

const ICONS = [BlocksIcon, FilesIcon, ListTodoIcon, ShieldCheckIcon];

export function JourneyLauncher({ minimal = false }: { minimal?: boolean }) {
  const { t } = useI18n();
  return (
    <section className="experience-routes" aria-labelledby="experience-heading">
      <div className="experience-heading">
        <div>
          <span className="studio-eyebrow">{t("experience.eyebrow")}</span>
          <h3 id="experience-heading">{t("experience.title")}</h3>
        </div>
        <p>{t("experience.description")}</p>
      </div>
      <div className="experience-grid">
        {JOURNEYS.map((journey, index) => {
          if (minimal && !journey.native) return null;
          const Icon = ICONS[index]!;
          return (
            <Link
              key={journey.id}
              to={journeyLink(journey)}
              className="experience-route"
              data-native={journey.native}
            >
              <div className="experience-route-top">
                <Icon aria-hidden="true" />
                <span>{String(index + 1).padStart(2, "0")}</span>
                <ArrowUpRightIcon aria-hidden="true" />
              </div>
              <h4>{t(journey.title)}</h4>
              <p>{t(journey.description)}</p>
              <div className="experience-route-bottom">
                {journey.native ? (
                  <MonitorIcon aria-hidden="true" />
                ) : (
                  <BlocksIcon aria-hidden="true" />
                )}
                <span>
                  {t(
                    journey.native ? "experience.native" : "experience.browser",
                  )}
                </span>
                <span>
                  {t("experience.stepCount", { count: journey.steps.length })}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
