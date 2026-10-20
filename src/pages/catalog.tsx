import { useState } from "react";
import { Link } from "react-router-dom";
import { APP_ROUTES, NAVIGATION_GROUPS } from "@/routes";
import { APP_CONFIG } from "@/config/app";
import { useI18n } from "@/providers/i18n";
import { isTauri } from "@/lib/tauri";
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
  capabilityFor,
  ipcExample,
  pageSource,
  repositoryFileUrl,
  type CapabilityKind,
} from "@/features/catalog/model";

export default function Catalog() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<CapabilityKind | "all">("all");
  const source = (path: string) =>
    repositoryFileUrl(APP_CONFIG.repositoryUrl, path);
  const routes = APP_ROUTES.filter((route) => {
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
      <p role="status" className="rounded-lg border bg-card p-3 text-sm">
        {t(isTauri() ? "catalog.runtimeNative" : "catalog.runtimeBrowser")}
      </p>
      <Card>
        <CardHeader>
          <CardTitle>{t("catalog.journey")}</CardTitle>
          <CardDescription>{t("catalog.journeyHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-3">
          {NAVIGATION_GROUPS.map((group) => (
            <section key={group.id} className="space-y-2">
              <h3 className="text-sm font-medium">{t(group.labelKey)}</h3>
              <ol className="space-y-1 text-sm">
                {APP_ROUTES.filter(
                  (route) =>
                    route.group === group.id && route.path !== "/catalog",
                ).map((route) => (
                  <li key={route.path}>
                    <Link
                      className="inline-flex min-h-9 items-center gap-2 rounded-sm text-primary underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
                      to={route.path}
                    >
                      <route.icon className="size-4" aria-hidden="true" />
                      {t(route.labelKey)}
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </CardContent>
      </Card>
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
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            aria-label={t("catalog.filter")}
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as CapabilityKind | "all")
            }
          >
            <option value="all">{t("catalog.all")}</option>
            {(["local", "native", "external"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`catalog.${value}`)}
              </option>
            ))}
          </select>
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
                    <a
                      href={source(pageSource(route.path))}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
                      {t("catalog.source")}
                    </a>
                    <a
                      href={source(detail.doc)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
                      {t("catalog.docs")}
                    </a>
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
          <pre
            tabIndex={0}
            aria-label={t("catalog.tutorial")}
            className="max-h-96 overflow-auto rounded-md bg-muted p-4 text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {ipcExample}
          </pre>
          <div className="flex flex-wrap gap-3 text-sm">
            {(
              [
                ["docs/development.md", "catalog.guide"],
                ["docs/architecture.md", "catalog.architecture"],
                ["docs/testing.md", "catalog.testing"],
              ] as const
            ).map(([path, label]) => (
              <a
                href={source(path)}
                key={path}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                {t(label)}
              </a>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
