import {
  ArrowRightIcon,
  CheckCircle2Icon,
  CopyIcon,
  FileTextIcon,
  GitBranchIcon,
  PackageIcon,
  SettingsIcon,
  SparklesIcon,
  TimerIcon,
  ZapIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";
import { APP_CONFIG } from "@/config/app";

const STACK = [
  "Tauri 2",
  "React 19",
  "TypeScript 6",
  "Tailwind 4",
  "shadcn/ui",
];

const STATS = [
  {
    key: "tests",
    labelKey: "overview.stats.tests",
    value: "21",
    hintKey: "overview.stats.testsHint",
    icon: CheckCircle2Icon,
    data: [3, 5, 6, 9, 12, 15, 18, 21],
  },
  {
    key: "platforms",
    labelKey: "overview.stats.platforms",
    value: "3",
    hintKey: "overview.stats.platformsHint",
    icon: GitBranchIcon,
    data: [1, 1, 2, 2, 3, 3, 3, 3],
  },
  {
    key: "bundle",
    labelKey: "overview.stats.bundle",
    value: "144 KB",
    hintKey: "overview.stats.bundleHint",
    icon: ZapIcon,
    data: [220, 200, 190, 180, 170, 160, 150, 144],
  },
  {
    key: "installer",
    labelKey: "overview.stats.installer",
    value: "1.41 MB",
    hintKey: "overview.stats.installerHint",
    icon: PackageIcon,
    data: [1.9, 1.8, 1.7, 1.6, 1.5, 1.45, 1.42, 1.41],
  },
] as const;

const ACTIVITY = [
  {
    key: "build",
    labelKey: "overview.activity.build",
    metaKey: "overview.activity.buildMeta",
    icon: CheckCircle2Icon,
  },
  {
    key: "release",
    labelKey: "overview.activity.release",
    metaKey: "overview.activity.releaseMeta",
    icon: PackageIcon,
  },
  {
    key: "tests",
    labelKey: "overview.activity.tests",
    metaKey: "overview.activity.testsMeta",
    icon: SparklesIcon,
  },
  {
    key: "docs",
    labelKey: "overview.activity.docs",
    metaKey: "overview.activity.docsMeta",
    icon: FileTextIcon,
  },
] as const;

const COMMANDS = [
  { command: "pnpm install", hintKey: "overview.quickInstall" },
  { command: "pnpm app:dev", hintKey: "overview.quickDev" },
  { command: "pnpm app:build", hintKey: "overview.quickBuild" },
] as const;

const HEALTH = [
  { key: "overview.health.build", value: 100 },
  { key: "overview.health.coverage", value: 86 },
  { key: "overview.health.bundle", value: 72 },
  { key: "overview.health.deps", value: 100 },
] as const;

function Sparkline({ data }: { data: readonly number[] }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * 100;
      const y = 30 - ((value - min) / span) * 26;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      className="h-8 w-full"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

async function copyCommand(command: string, message: string, failure: string) {
  try {
    await copyText(command);
    toast.success(message);
  } catch {
    toast.error(failure);
  }
}

export default function Overview() {
  const { t } = useI18n();
  const { settings } = useSettings();

  if (settings.appMode === "minimal")
    return (
      <div className="space-y-6">
        <section className="rounded-2xl border bg-card/75 p-8">
          <SparklesIcon className="mb-4 size-8 text-primary" />
          <h2 className="text-2xl font-semibold tracking-tight">
            {t("home.title", { name: APP_CONFIG.name })}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("home.description")}
          </p>
        </section>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { to: "/desktop", label: "home.desktop" },
            { to: "/database", label: "home.database" },
            { to: "/settings", label: "home.settings" },
          ].map((item) => (
            <Card key={item.to}>
              <CardContent className="pt-5">
                <Button
                  asChild
                  variant="ghost"
                  className="h-auto w-full justify-between"
                >
                  <Link to={item.to}>
                    {t(
                      item.label as
                        "home.desktop" | "home.database" | "home.settings",
                    )}
                    <ArrowRightIcon className="size-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl border bg-card px-6 py-7">
        <div className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-primary/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 size-56 rounded-full bg-primary/5 blur-3xl" />

        <div className="relative space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {STACK.map((item) => (
              <Badge key={item} variant="secondary" className="font-normal">
                {item}
              </Badge>
            ))}
          </div>
          <div className="space-y-2">
            <h2 className="max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl">
              {t("overview.title")}
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {t("overview.subtitle")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild>
              <Link to="/components">
                {t("overview.cta.components")}
                <ArrowRightIcon />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/settings">
                <SettingsIcon />
                {t("overview.cta.settings")}
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="col-span-full">
          <Badge variant="outline" className="font-normal">
            {t("common.sampleData")}
          </Badge>
        </div>
        {STATS.map((stat) => (
          <Card key={stat.key} size="sm" className="gap-2">
            <CardHeader className="gap-1">
              <div className="flex items-center justify-between">
                <CardDescription className="text-xs">
                  {t(stat.labelKey)}
                </CardDescription>
                <stat.icon className="size-3.5 text-muted-foreground" />
              </div>
              <p className="text-2xl font-semibold tracking-tight">
                {stat.value}
              </p>
            </CardHeader>
            <CardContent className="space-y-1">
              <Sparkline data={stat.data} />
              <p className="text-[11px] text-muted-foreground">
                {t(stat.hintKey)}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="grid gap-3 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-sm">{t("overview.recent")}</CardTitle>
            <CardDescription className="text-xs">
              {t("overview.recentHint")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="relative space-y-4">
              <span className="absolute bottom-2 left-[5px] top-2 w-px bg-border" />
              {ACTIVITY.map((item) => (
                <li key={item.key} className="relative flex gap-3 pl-5">
                  <span className="absolute left-0 top-1.5 flex size-2.5 items-center justify-center rounded-full border bg-background">
                    <span className="size-1 rounded-full bg-primary" />
                  </span>
                  <item.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{t(item.labelKey)}</p>
                    <p className="text-xs text-muted-foreground">
                      {t(item.metaKey)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">{t("overview.status")}</CardTitle>
            <CardDescription className="text-xs">
              {t("overview.statusHint")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {HEALTH.map((item) => (
              <div key={item.key} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{t(item.key)}</span>
                  <span className="font-mono">{item.value}%</span>
                </div>
                <Progress
                  value={item.value}
                  className="h-1.5"
                  aria-label={t(item.key)}
                />
              </div>
            ))}
            <div className="flex items-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
              <TimerIcon className="size-3" />
              {t("common.sampleData")}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("overview.quick")}</CardTitle>
          <CardDescription className="text-xs">
            {t("overview.quickHint")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {COMMANDS.map((item) => (
            <div
              key={item.command}
              className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-3">
                <CheckCircle2Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <code className="truncate font-mono text-xs">
                  {item.command}
                </code>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`${t("common.copy")} ${item.command}`}
                onClick={() =>
                  void copyCommand(
                    item.command,
                    t("common.copied"),
                    t("common.copyFailed"),
                  )
                }
              >
                <CopyIcon />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
