import { useState } from "react";
import { Link } from "react-router-dom";
import { APP_ROUTES } from "@/routes";
import { JourneyLauncher } from "@/features/journeys/journey-launcher";
import { useSettings } from "@/providers/settings";
import { APP_CONFIG } from "@/config/app";
import { useI18n } from "@/providers/i18n";
import { isTauri } from "@/lib/tauri";
import { CodeBlock } from "@/components/code-block";
import { ExternalLink } from "@/components/external-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  capabilityFor,
  rustIpcExample,
  typescriptIpcExample,
  pageSource,
  repositoryFileUrl,
  type CapabilityKind,
} from "@/features/catalog/model";

export default function Catalog() {
  const { t } = useI18n();
  const { settings } = useSettings();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<CapabilityKind | "all">("all");
  const source = (path: string) =>
    repositoryFileUrl(APP_CONFIG.repositoryUrl, path);
  const routes = APP_ROUTES.filter((route) => {
    if (route.hidden) return false;
    const detail = capabilityFor(route.path);
    return (
      (kind === "all" || detail.kinds.includes(kind)) &&
      `${t(route.labelKey)} ${t(detail.description)}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase())
    );
  });
  return (
    <div className="studio-page space-y-5">
      <div className="studio-intro">
        <span className="studio-eyebrow">{APP_CONFIG.name}</span>
        <h2>{t("catalog.title")}</h2>
        <p>{t("catalog.description")}</p>
      </div>
      {!isTauri() ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("catalog.runtimeBrowser")}
        </p>
      ) : null}
      <JourneyLauncher minimal={settings.appMode === "minimal"} />
      <section aria-labelledby="capability-list-heading" className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 id="capability-list-heading" className="text-base font-medium">
            {t("catalog.modules")}
          </h3>
          <Input
            type="search"
            aria-label={t("catalog.search")}
            placeholder={t("catalog.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-w-48 flex-1"
          />
          <Select
            value={kind}
            onValueChange={(value) => setKind(value as CapabilityKind | "all")}
          >
            <SelectTrigger aria-label={t("catalog.filter")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectItem value="all">{t("catalog.all")}</SelectItem>
              {(["local", "native", "external"] as const).map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`catalog.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("catalog.statusHint")}
        </p>
        <div className="grid items-start gap-3 md:grid-cols-2">
          {routes.map((route) => {
            const detail = capabilityFor(route.path);
            return (
              <Card key={route.path}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <route.icon className="size-4" aria-hidden="true" />
                    {t(route.labelKey)}
                  </CardTitle>
                  <CardDescription>{t(detail.description)}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {detail.kinds.map((value) => (
                      <Badge key={value} variant="outline">
                        {t(`catalog.${value}`)}
                      </Badge>
                    ))}
                    {route.demoOnly ? (
                      <span className="text-xs text-muted-foreground">
                        {t("catalog.hidden")}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <Button asChild size="sm">
                      <Link to={route.path}>{t("catalog.open")}</Link>
                    </Button>
                    <ExternalLink
                      href={source(pageSource(route.path))}
                      className="text-primary underline"
                    >
                      {t("catalog.source")}
                    </ExternalLink>
                    <ExternalLink
                      href={source(detail.doc)}
                      className="text-primary underline"
                    >
                      {t("catalog.docs")}
                    </ExternalLink>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {!routes.length ? (
          <p role="status" className="p-4 text-sm text-muted-foreground">
            {t("catalog.empty")}
          </p>
        ) : null}
      </section>
      <Card>
        <CardHeader>
          <CardTitle>{t("catalog.tutorial")}</CardTitle>
          <CardDescription>{t("catalog.tutorialHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="list-decimal space-y-4 pl-5">
            {(["page", "route", "command", "bindings", "verify"] as const).map(
              (step) => (
                <li key={step}>
                  <h3 className="text-sm font-medium">
                    {t(`catalog.step.${step}`)}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {t(`catalog.step.${step}Body`)}
                  </p>
                </li>
              ),
            )}
          </ol>
          <div className="min-w-0 space-y-2">
            <h3 id="catalog-rust-example" className="text-sm font-medium">
              {t("catalog.rustExample")}
            </h3>
            <CodeBlock
              aria-labelledby="catalog-rust-example"
              code={rustIpcExample}
              language="rust"
              className="max-h-96 rounded-md bg-muted"
            />
          </div>
          <div className="min-w-0 space-y-2">
            <h3 id="catalog-typescript-example" className="text-sm font-medium">
              {t("catalog.typescriptExample")}
            </h3>
            <CodeBlock
              aria-labelledby="catalog-typescript-example"
              code={typescriptIpcExample}
              language="typescript"
              className="max-h-96 rounded-md bg-muted"
            />
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            {(
              [
                ["docs/development.md", "catalog.guide"],
                ["docs/architecture.md", "catalog.architecture"],
                ["docs/testing.md", "catalog.testing"],
              ] as const
            ).map(([path, label]) => (
              <ExternalLink
                href={source(path)}
                key={path}
                className="text-primary underline"
              >
                {t(label)}
              </ExternalLink>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
