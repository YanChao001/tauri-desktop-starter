import { useEffect, useId, useRef, useState } from "react";
import {
  CheckIcon,
  ImagePlusIcon,
  Loader2Icon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BackgroundImageError,
  importBackgroundImage,
} from "@/lib/background-image";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";

const ERROR_KEYS = {
  type: "settings.imageTypeError",
  size: "settings.imageSizeError",
  decode: "settings.imageDecodeError",
} as const;

export function CustomBackgroundPicker() {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const latest = useRef(settings);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<keyof typeof ERROR_KEYS | null>(null);
  const image = settings.customBackground;
  const active = settings.background === "custom";
  useEffect(() => {
    latest.current = settings;
  }, [settings]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  async function importImage(file: File) {
    const attempt = ++generation.current;
    const before = latest.current;
    setPending(true);
    setError(null);
    try {
      const imported = await importBackgroundImage(file);
      const current = latest.current;
      if (
        attempt !== generation.current ||
        current.background !== before.background ||
        current.customBackground?.dataUrl !==
          before.customBackground?.dataUrl ||
        current.customBackground?.fit !== before.customBackground?.fit
      )
        return;
      update({ background: "custom", customBackground: imported });
    } catch (reason) {
      if (attempt === generation.current)
        setError(
          reason instanceof BackgroundImageError ? reason.code : "decode",
        );
    } finally {
      if (attempt === generation.current) setPending(false);
    }
  }

  return (
    <section
      className="custom-skin-panel"
      aria-labelledby={id + "-heading"}
      aria-busy={pending}
    >
      <div className="custom-skin-preview">
        {image ? (
          <label className="block h-full cursor-pointer focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring">
            <input
              type="radio"
              name="background-skin"
              value="custom"
              className="sr-only"
              checked={active}
              disabled={pending}
              aria-label={t("settings.bgCustom")}
              onChange={() => update({ background: "custom" })}
            />
            <img
              src={image.dataUrl}
              alt=""
              className="size-full"
              style={{ objectFit: image.fit }}
            />
            {active ? (
              <span className="custom-skin-check">
                <CheckIcon className="size-3" aria-hidden="true" />
                <span className="sr-only">{t("settings.activeSkin")}</span>
              </span>
            ) : null}
          </label>
        ) : (
          <ImagePlusIcon
            className="size-7 text-muted-foreground/55"
            aria-hidden="true"
          />
        )}
      </div>
      <div className="min-w-0 space-y-2.5">
        <div className="space-y-1">
          <h3 id={id + "-heading"} className="text-sm font-medium">
            {t("settings.bgCustom")}
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("settings.customImageHint")}
          </p>
          {image ? (
            <p
              className="truncate text-xs text-muted-foreground"
              title={image.name}
            >
              {image.name}
            </p>
          ) : null}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label={t("settings.importBackground")}
          aria-describedby={id + "-formats"}
          disabled={pending}
          className="sr-only"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void importImage(file);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => fileInput.current?.click()}
          >
            {pending ? (
              <Loader2Icon
                className="size-3.5 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <UploadIcon className="size-3.5" aria-hidden="true" />
            )}
            {t(
              image
                ? "settings.replaceBackground"
                : "settings.importBackground",
            )}
          </Button>
          {image ? (
            <>
              <Select
                value={image.fit}
                disabled={pending}
                onValueChange={(fit) => {
                  if (fit === "cover" || fit === "contain")
                    update({ customBackground: { ...image, fit } });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-32"
                  aria-label={t("settings.backgroundFit")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="end">
                  <SelectItem value="cover">
                    {t("settings.backgroundCover")}
                  </SelectItem>
                  <SelectItem value="contain">
                    {t("settings.backgroundContain")}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={pending}
                aria-label={t("settings.removeBackground")}
                onClick={() => {
                  setError(null);
                  update({
                    customBackground: null,
                    ...(active ? { background: "plain" } : {}),
                  });
                }}
              >
                <Trash2Icon className="size-3.5" aria-hidden="true" />
              </Button>
            </>
          ) : null}
        </div>
        <p id={id + "-formats"} className="text-[11px] text-muted-foreground">
          {t("settings.imageFormats")}
        </p>
        {pending ? (
          <p role="status" className="text-xs text-muted-foreground">
            {t("settings.imageProcessing")}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {t(ERROR_KEYS[error])}
          </p>
        ) : null}
      </div>
    </section>
  );
}
