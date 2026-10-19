import { useState } from "react";
import {
  GaugeIcon,
  LayersIcon,
  MousePointerClickIcon,
  RadioIcon,
  SparklesIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useThemeSwitch } from "@/hooks/use-theme-switch";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";

const STAGGER_ITEMS = Array.from({ length: 6 }, (_, index) => index + 1);
const HOVER_CARDS = [1, 2, 3];

export default function Motion() {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const { toggle } = useThemeSwitch();
  const [progress, setProgress] = useState(40);
  const motionOff = settings.motion === "reduced";

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold tracking-tight">
          {t("motion.title")}
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("motion.subtitle")}
        </p>
      </div>

      {motionOff ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <SparklesIcon className="mt-0.5 size-4 text-amber-600 dark:text-amber-400" />
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("motion.motionOff")}</p>
            <p className="text-xs text-muted-foreground">
              {t("motion.motionOffHint")}
            </p>
            <Button
              size="xs"
              variant="outline"
              className="mt-1"
              onClick={() => {
                update({ motion: "full" });
                toast.success(t("settings.motionFull"));
              }}
            >
              {t("settings.motionFull")}
            </Button>
          </div>
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="text-sm">{t("motion.theme")}</CardTitle>
          <CardDescription className="text-xs">
            {t("motion.themeHint")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-primary/15 via-background to-background px-6 py-10">
            <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-primary/20 blur-2xl" />
            <div className="relative flex flex-col items-center gap-3 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <MousePointerClickIcon className="size-5" />
              </span>
              <p className="text-sm text-muted-foreground">
                {t("motion.themeHint")}
              </p>
              <Button onClick={(event) => toggle(event)}>
                {t("motion.toggleTheme")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("motion.stagger")}</CardTitle>
            <CardDescription className="text-xs">
              {t("motion.staggerHint")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {STAGGER_ITEMS.map((item) => (
              <div
                key={item}
                className="animate-fade-up flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2"
                style={{ animationDelay: `${item * 40}ms` }}
              >
                <span className="flex size-6 items-center justify-center rounded-full bg-background text-[10px] font-medium">
                  {item}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("motion.item", { index: item })}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("motion.hover")}</CardTitle>
              <CardDescription className="text-xs">
                {t("motion.hoverHint")}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2">
              {HOVER_CARDS.map((item) => (
                <div
                  key={item}
                  className="flex h-20 cursor-default flex-col items-center justify-center gap-1.5 rounded-lg border bg-background transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/10"
                >
                  <LayersIcon className="size-4 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">
                    {item}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("motion.skeleton")}</CardTitle>
              <CardDescription className="text-xs">
                {t("motion.skeletonHint")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-2.5 w-1/2" />
                  <Skeleton className="h-2.5 w-1/3" />
                </div>
              </div>
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("motion.progress")}</CardTitle>
            <CardDescription className="text-xs">
              {t("motion.progressHint")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <GaugeIcon className="size-3.5" />
                {progress}%
              </span>
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  setProgress((value) => (value >= 100 ? 20 : value + 20))
                }
              >
                +20%
              </Button>
            </div>
            <Progress value={progress} className="h-2" />
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-sm">{t("motion.marquee")}</CardTitle>
            <CardDescription className="text-xs">
              {t("motion.marqueeHint")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="marquee-track overflow-hidden rounded-md border bg-muted/30 py-2">
              <div className="animate-marquee flex w-max items-center gap-6 whitespace-nowrap px-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <RadioIcon className="size-3.5" />
                  {t("motion.marqueeText")}
                </span>
                <span className="flex items-center gap-1.5">
                  <RadioIcon className="size-3.5" />
                  {t("motion.marqueeText")}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
