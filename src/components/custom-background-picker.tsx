import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  CheckIcon,
  ImagePlusIcon,
  Loader2Icon,
  PencilIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  MAX_WALLPAPERS,
  WallpaperLibraryError,
  addLibraryWallpaper,
  listWallpaperLibrary,
  onWallpaperLibraryChanged,
  removeLibraryWallpaper,
  renameLibraryWallpaper,
  type Wallpaper,
} from "@/lib/wallpaper-library";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";

const ERROR_KEYS = {
  type: "settings.imageTypeError",
  size: "settings.imageSizeError",
  decode: "settings.imageDecodeError",
  full: "settings.libraryFull",
  storage: "settings.libraryError",
} as const;
type Failure = { name: string; code: keyof typeof ERROR_KEYS };
function failureCode(reason: unknown): Failure["code"] {
  if (reason instanceof BackgroundImageError) return reason.code;
  if (reason instanceof WallpaperLibraryError && reason.code === "full")
    return "full";
  if (
    typeof reason === "object" &&
    reason !== null &&
    "code" in reason &&
    reason.code === "INPUT_TOO_LONG"
  )
    return "full";
  return "storage";
}

export function CustomBackgroundPicker() {
  const { t } = useI18n();
  const { settings, update, persistence } = useSettings();
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const readGeneration = useRef(0);
  const busy = useRef(false);
  const latest = useRef(settings);
  const [images, setImages] = useState<Wallpaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [renaming, setRenaming] = useState<Wallpaper | null>(null);
  const [name, setName] = useState("");
  const image = settings.customBackground;
  const active = settings.background === "custom";
  const ready = persistence !== "loading";
  useLayoutEffect(() => {
    latest.current = settings;
  }, [settings]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    async function reload() {
      if (cancelled) return;
      const request = ++readGeneration.current;
      try {
        const loaded = await listWallpaperLibrary(
          latest.current.customBackground,
        );
        if (!cancelled && request === readGeneration.current) {
          setImages(loaded);
          setLoadFailed(false);
        }
      } catch {
        if (!cancelled && request === readGeneration.current)
          setLoadFailed(true);
      } finally {
        if (!cancelled && request === readGeneration.current) setLoading(false);
      }
    }
    setLoading(true);
    void onWallpaperLibraryChanged(() => {
      void reload();
    })
      .then((unsubscribe) => {
        if (cancelled) unsubscribe();
        else {
          stop = unsubscribe;
          void reload();
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [ready, retry]);

  function remember(entry: Wallpaper) {
    readGeneration.current++;
    setImages((current) => {
      const exists = current.some((item) => item.id === entry.id);
      return exists
        ? current.map((item) => (item.id === entry.id ? entry : item))
        : [...current, entry];
    });
  }
  function apply(entry: Wallpaper) {
    update({
      background: "custom",
      customBackground: {
        name: entry.name,
        dataUrl: entry.dataUrl,
        fit: latest.current.customBackground?.fit ?? "cover",
      },
    });
  }
  async function importImages(files: File[]) {
    if (busy.current || loading || loadFailed) return;
    busy.current = true;
    const attempt = ++generation.current;
    const before = latest.current;
    setPending(true);
    setFailures([]);
    const errors: Failure[] = [];
    let last: Wallpaper | undefined;
    if (files.length > MAX_WALLPAPERS) errors.push({ name: "", code: "full" });
    try {
      for (const file of files.slice(0, MAX_WALLPAPERS)) {
        try {
          const imported = await importBackgroundImage(file);
          if (attempt !== generation.current) return;
          const saved = await addLibraryWallpaper(imported);
          if (attempt !== generation.current) return;
          remember(saved);
          last = saved;
        } catch (reason) {
          errors.push({ name: file.name, code: failureCode(reason) });
        }
        if (attempt !== generation.current) return;
      }
      const current = latest.current;
      if (
        last &&
        current.background === before.background &&
        current.customBackground?.dataUrl ===
          before.customBackground?.dataUrl &&
        current.customBackground?.fit === before.customBackground?.fit
      )
        apply(last);
      setFailures(errors);
    } finally {
      busy.current = false;
      if (attempt === generation.current) setPending(false);
    }
  }
  async function remove(entry: Wallpaper) {
    if (busy.current) return;
    busy.current = true;
    const attempt = generation.current;
    setPending(true);
    setFailures([]);
    try {
      await removeLibraryWallpaper(entry.id);
      if (attempt !== generation.current) return;
      readGeneration.current++;
      setImages((current) => current.filter((item) => item.id !== entry.id));
      const current = latest.current;
      if (current.customBackground?.dataUrl === entry.dataUrl)
        update({
          customBackground: null,
          ...(current.background === "custom" ? { background: "plain" } : {}),
        });
    } catch (reason) {
      if (attempt === generation.current)
        setFailures([{ name: entry.name, code: failureCode(reason) }]);
    } finally {
      busy.current = false;
      if (attempt === generation.current) setPending(false);
    }
  }
  async function rename() {
    if (!renaming || busy.current) return;
    busy.current = true;
    const attempt = generation.current;
    setPending(true);
    setFailures([]);
    try {
      const saved = await renameLibraryWallpaper(renaming.id, name.trim());
      if (attempt !== generation.current) return;
      remember(saved);
      const current = latest.current.customBackground;
      if (current?.dataUrl === saved.dataUrl)
        update({ customBackground: { ...current, name: saved.name } });
      setRenaming(null);
    } catch (reason) {
      if (attempt === generation.current)
        setFailures([{ name: renaming.name, code: failureCode(reason) }]);
    } finally {
      busy.current = false;
      if (attempt === generation.current) setPending(false);
    }
  }

  return (
    <section
      className="wallpaper-library"
      aria-labelledby={id + "-heading"}
      aria-busy={pending || loading}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 id={id + "-heading"} className="text-sm font-medium">
            {t("settings.bgCustom")}
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("settings.customImageHint")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || loading || loadFailed}
          onClick={() => fileInput.current?.click()}
        >
          {pending ? (
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <UploadIcon className="size-3.5" aria-hidden="true" />
          )}
          {t("settings.importBackground")}
        </Button>
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        aria-label={t("settings.importBackground")}
        aria-describedby={id + "-formats"}
        disabled={pending || loading || loadFailed}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (files.length) void importImages(files);
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p id={id + "-formats"}>{t("settings.imageFormats")}</p>
        <p>
          {t("settings.libraryCount", {
            count: images.length,
            max: MAX_WALLPAPERS,
          })}
        </p>
      </div>
      {loadFailed ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 text-sm text-destructive"
        >
          <span>{t("settings.libraryError")}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRetry((value) => value + 1)}
          >
            {t("common.retry")}
          </Button>
        </div>
      ) : images.length ? (
        <div className="wallpaper-grid">
          {images.map((entry) => {
            const selected = active && image?.dataUrl === entry.dataUrl;
            return (
              <div
                key={entry.id}
                className="wallpaper-card"
                data-wallpaper-id={entry.id}
                data-selected={selected}
              >
                <label className="wallpaper-thumbnail">
                  <input
                    type="radio"
                    name="background-skin"
                    value={entry.id}
                    className="sr-only"
                    checked={selected}
                    aria-label={t("settings.chooseWallpaper", {
                      name: entry.name,
                    })}
                    onChange={() => apply(entry)}
                  />
                  <img
                    src={entry.dataUrl}
                    alt=""
                    draggable={false}
                    loading="lazy"
                    decoding="async"
                  />
                  {selected ? (
                    <span className="custom-skin-check">
                      <CheckIcon className="size-3" aria-hidden="true" />
                      <span className="sr-only">
                        {t("settings.activeSkin")}
                      </span>
                    </span>
                  ) : null}
                </label>
                <div className="flex min-w-0 items-center gap-1 px-2 py-1.5">
                  <span
                    className="min-w-0 flex-1 truncate text-xs"
                    title={entry.name}
                  >
                    {entry.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={pending}
                    aria-label={t("settings.renameWallpaper", {
                      name: entry.name,
                    })}
                    onClick={() => {
                      setRenaming(entry);
                      setName(entry.name);
                      setFailures([]);
                    }}
                  >
                    <PencilIcon className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={pending}
                    aria-label={t("settings.deleteWallpaper", {
                      name: entry.name,
                    })}
                    onClick={() => void remove(entry)}
                  >
                    <Trash2Icon className="size-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : !loading ? (
        <div className="wallpaper-empty">
          <ImagePlusIcon className="size-6" aria-hidden="true" />
          <p>{t("settings.libraryEmpty")}</p>
        </div>
      ) : null}
      {image ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <p
            className="min-w-0 truncate text-xs text-muted-foreground"
            title={image.name}
          >
            {t("settings.currentWallpaper", { name: image.name })}
          </p>
          <div className="flex items-center gap-2">
            <Select
              value={image.fit}
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
              size="sm"
              variant="ghost"
              onClick={() =>
                update({
                  customBackground: null,
                  ...(active ? { background: "plain" } : {}),
                })
              }
            >
              {t("settings.clearWallpaper")}
            </Button>
          </div>
        </div>
      ) : null}
      {pending || loading ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t(loading ? "common.loading" : "settings.imageProcessing")}
        </p>
      ) : null}
      {failures.length && !renaming ? (
        <div role="alert" className="space-y-1 text-xs text-destructive">
          {failures.map((failure, index) => (
            <p key={index}>
              {failure.name && failure.name + " · "}
              {t(ERROR_KEYS[failure.code])}
            </p>
          ))}
        </div>
      ) : null}
      <Dialog
        open={!!renaming}
        onOpenChange={(open) => {
          if (!open && !pending) setRenaming(null);
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("settings.renameWallpaperTitle")}</DialogTitle>
            <DialogDescription>
              {t("settings.renameWallpaperHint")}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void rename();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor={id + "-name"}>
                {t("settings.wallpaperName")}
              </Label>
              <Input
                id={id + "-name"}
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </div>
            {failures.length ? (
              <p role="alert" className="text-xs text-destructive">
                {t("settings.libraryError")}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={pending || !name.trim()}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
