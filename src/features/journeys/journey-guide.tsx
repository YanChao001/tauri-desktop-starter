import { Link, useLocation } from "react-router-dom";
import { ArrowLeftIcon, ArrowRightIcon, RouteIcon, XIcon } from "lucide-react";
import { currentJourney, journeyLink } from "./model";
import { JourneySamples } from "./journey-samples";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";
import "@/styles/experience.css";

export function JourneyGuide() {
  const location = useLocation();
  const { settings } = useSettings();
  const { t } = useI18n();
  const current = currentJourney(
    location.pathname,
    location.search,
    settings.appMode === "minimal",
  );
  if (!current) return null;
  const { journey, step, index } = current;
  const close = new URLSearchParams(location.search);
  close.delete("journey");
  close.delete("step");
  return (
    <section className="journey-guide" aria-label={t("experience.guide")}>
      <div className="journey-guide-heading">
        <RouteIcon aria-hidden="true" />
        <span>
          {t(journey.title)} · {index + 1}/{journey.steps.length}
        </span>
        <Button asChild size="icon-sm" variant="ghost">
          <Link
            to={{ pathname: location.pathname, search: close.toString() }}
            aria-label={t("experience.close")}
          >
            <XIcon />
          </Link>
        </Button>
      </div>
      <div className="journey-guide-body">
        <div>
          <h3>{t(step.title)}</h3>
          <p>{t(step.description)}</p>
        </div>
        <div className="journey-guide-actions">
          {index > 0 && (
            <Button asChild size="sm" variant="outline">
              <Link to={journeyLink(journey, index - 1)}>
                <ArrowLeftIcon />
                {t("experience.previous")}
              </Link>
            </Button>
          )}
          <Button asChild size="sm">
            <Link
              to={
                index + 1 < journey.steps.length
                  ? journeyLink(journey, index + 1)
                  : "/catalog"
              }
            >
              {t(
                index + 1 < journey.steps.length
                  ? "experience.next"
                  : "experience.finish",
              )}
              <ArrowRightIcon />
            </Link>
          </Button>
        </div>
      </div>
      <div className="journey-guide-progress" aria-hidden="true">
        {journey.steps.map((item, at) => (
          <span key={item.title} data-current={at === index} />
        ))}
      </div>
      <JourneySamples path={step.path} />
    </section>
  );
}
