import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  CheckIcon,
  ImagePlusIcon,
  Loader2Icon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
  UploadIcon,
  VideoIcon,
} from "lucide-react";
import { toast } from "sonner";
import { HelpTooltip } from "@/components/help-tooltip";
import { WallpaperThumbnail } from "@/components/wallpaper-thumbnail";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import {
  BackgroundImageError,
  backgroundMediaIdentity,
  importBackgroundImage,
} from "@/lib/background-image";
import {
  BackgroundVideoError,
  importVideoWallpaper,
} from "@/lib/video-wallpaper";
import { isTauri } from "@/lib/tauri";
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
  videoType: "settings.videoTypeError",
  videoSize: "settings.videoSizeError",
  videoDecode: "settings.videoDecodeError",
  videoStorage: "settings.videoStorageError",
} as const;
type Failure = { name: string; code: keyof typeof ERROR_KEYS };
function failureCode(reason: unknown): Failure["code"] {
  if (reason instanceof BackgroundImageError) return reason.code;
  if (reason instanceof BackgroundVideoError) return reason.code;
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
  const translateLatest = useLatestTranslator();
  const { settings, update, persistence } = useSettings();
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const restoreAfterRemoval = useRef(false);
  const generation = useRef(0);
  const readGeneration = useRef(0);
  const busy = useRef(false);
  const latest = useRef(settings);
  const [images, setImages] = useState<Wallpaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [showFailures, setShowFailures] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [renaming, setRenaming] = useState<Wallpaper | null>(null);
  const [removing, setRemoving] = useState<Wallpaper | null>(null);
  const [name, setName] = useState("");
  const image = settings.customBackground;
  const native = isTauri();
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
        ...(entry.video ? { video: entry.video } : {}),
      },
    });
  }
  async function importWallpapers(files: File[] | null) {
    if (busy.current || loading || loadFailed) return;
    busy.current = true;
    const attempt = ++generation.current;
    const before = latest.current;
    setPending(true);
    setFailures([]);
    const errors: Failure[] = [];
    let importedCount = 0;
    let last: Wallpaper | undefined;
    if (files && files.length > MAX_WALLPAPERS)
      errors.push({ name: "", code: "full" });
    try {
      for (const file of files?.slice(0, MAX_WALLPAPERS) ?? [undefined]) {
        try {
          const imported =
            !file ||
            file.type.startsWith("video/") ||
            /\.(mp4|webm)$/i.test(file.name)
              ? await importVideoWallpaper(file)
              : await importBackgroundImage(file);
          if (attempt !== generation.current) return;
          if (!imported) continue;
          const saved = await addLibraryWallpaper(imported);
          if (attempt !== generation.current) return;
          remember(saved);
          last = saved;
          importedCount++;
        } catch (reason) {
          errors.push({ name: file?.name ?? "", code: failureCode(reason) });
        }
        if (attempt !== generation.current) return;
      }
      const current = latest.current;
      if (
        last &&
        current.background === before.background &&
        backgroundMediaIdentity(current.customBackground) ===
          backgroundMediaIdentity(before.customBackground) &&
        current.customBackground?.fit === before.customBackground?.fit
      )
        apply(last);
      if (errors.length)
        toast.error(
          translateLatest("settings.wallpaperImportFailed", {
            count: errors.length,
          }),
          {
            ...(importedCount
              ? {
                  description: translateLatest("settings.wallpapersImported", {
                    count: importedCount,
                  }),
                }
              : {}),
            action: {
              label: translateLatest("common.details"),
              onClick: () => {
                if (attempt !== generation.current) return;
                setFailures(errors);
                setShowFailures(true);
              },
            },
          },
        );
      else if (importedCount)
        toast.success(
          translateLatest("settings.wallpapersImported", {
            count: importedCount,
          }),
        );
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
      if (
        backgroundMediaIdentity(current.customBackground) ===
        backgroundMediaIdentity(entry)
      )
        update({
          customBackground: null,
          ...(current.background === "custom" ? { background: "plain" } : {}),
        });
      restoreAfterRemoval.current = true;
      setRemoving(null);
      toast.success(translateLatest("settings.wallpaperRemoved"));
    } catch (reason) {
      if (attempt === generation.current)
        toast.error(translateLatest(ERROR_KEYS[failureCode(reason)]));
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
      if (
        current &&
        backgroundMediaIdentity(current) === backgroundMediaIdentity(saved)
      )
        update({ customBackground: { ...current, name: saved.name } });
      setRenaming(null);
      toast.success(translateLatest("settings.wallpaperRenamed"));
    } catch (reason) {
      if (attempt === generation.current)
        toast.error(translateLatest(ERROR_KEYS[failureCode(reason)]));
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
        <div className="flex min-w-0 items-center gap-1.5">
          <h3 id={id + "-heading"} className="text-sm font-medium">
            {t("settings.bgCustom")}
          </h3>
          <HelpTooltip
            label={t("common.helpFor", { name: t("settings.bgCustom") })}
          >
            {t("settings.customImageHint")} {t("settings.imageFormats")}
          </HelpTooltip>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-right text-xs tabular-nums text-muted-foreground">
            {t("settings.libraryCount", {
              count: images.length,
              max: MAX_WALLPAPERS,
            })}
          </span>
          <Button
            ref={importButton}
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || loading || loadFailed}
            onClick={() => {
              if (!fileInput.current) return;
              fileInput.current.accept = native
                ? "image/png,image/jpeg,image/webp"
                : "image/png,image/jpeg,image/webp,video/mp4,video/webm";
              fileInput.current.click();
            }}
          >
            {pending ? (
              <Loader2Icon
                className="size-3.5 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <UploadIcon className="size-3.5" aria-hidden="true" />
            )}
            {t("settings.importBackground")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || loading || loadFailed}
            onClick={() => {
              if (native) void importWallpapers(null);
              else if (fileInput.current) {
                fileInput.current.accept = "video/mp4,video/webm";
                fileInput.current.click();
              }
            }}
          >
            <VideoIcon className="size-3.5" aria-hidden="true" />
            {t("settings.importVideoBackground")}
          </Button>
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={
          native
            ? "image/png,image/jpeg,image/webp"
            : "image/png,image/jpeg,image/webp,video/mp4,video/webm"
        }
        aria-label={t("settings.importBackground")}
        aria-describedby={id + "-formats"}
        disabled={pending || loading || loadFailed}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (files.length) void importWallpapers(files);
        }}
      />
      <span id={id + "-formats"} className="sr-only">
        {t("settings.imageFormats")}
      </span>
      {loadFailed ? (
        <div
          role="alert"
          className="wallpaper-empty flex-wrap justify-between gap-2 px-3 text-sm text-destructive"
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
        <TooltipProvider delayDuration={650} skipDelayDuration={0}>
          <div className="wallpaper-grid">
            {images.map((entry) => {
              const selected =
                active &&
                backgroundMediaIdentity(image) ===
                  backgroundMediaIdentity(entry);
              return (
                <Tooltip key={entry.id}>
                  <TooltipTrigger asChild>
                    <div
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
                        <WallpaperThumbnail dataUrl={entry.dataUrl} />
                        {entry.video ? (
                          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-background/85 px-1.5 py-0.5 text-xs text-foreground">
                            <PlayIcon className="size-3" aria-hidden="true" />
                            {t("settings.videoWallpaper")}
                          </span>
                        ) : null}
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
                        <span className="min-w-0 flex-1 truncate text-xs">
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
                          variant="destructive"
                          size="icon-sm"
                          disabled={pending}
                          aria-label={t("settings.deleteWallpaper", {
                            name: entry.name,
                          })}
                          onClick={() => {
                            restoreAfterRemoval.current = false;
                            setRemoving(entry);
                          }}
                        >
                          <Trash2Icon className="size-3" />
                        </Button>
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-64 break-all">
                    {entry.name}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      ) : !loading ? (
        <div className="wallpaper-empty">
          <ImagePlusIcon className="size-6" aria-hidden="true" />
          <p>{t("settings.libraryEmpty")}</p>
        </div>
      ) : (
        <div className="wallpaper-empty" role="status">
          <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
          {t("common.loading")}
        </div>
      )}
      {image ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <TooltipProvider delayDuration={650}>
            <Tooltip>
              <TooltipTrigger asChild>
                <p
                  tabIndex={0}
                  className="min-w-0 flex-1 truncate text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("settings.currentWallpaper", { name: image.name })}
                </p>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-64 break-all">
                {image.name}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
        <p role="status" className="sr-only">
          {t(loading ? "common.loading" : "settings.imageProcessing")}
        </p>
      ) : null}
      <Dialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open && !pending) setRemoving(null);
        }}
      >
        <DialogContent
          closeLabel={t("common.close")}
          onCloseAutoFocus={(event) => {
            if (!restoreAfterRemoval.current) return;
            event.preventDefault();
            restoreAfterRemoval.current = false;
            importButton.current?.focus({ preventScroll: true });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("settings.deleteWallpaperTitle")}</DialogTitle>
            <DialogDescription className="break-words">
              {t("settings.deleteWallpaperDescription", {
                name: removing?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setRemoving(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (removing) void remove(removing);
              }}
            >
              {t("settings.removeWallpaper")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={showFailures} onOpenChange={setShowFailures}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("settings.wallpaperImportDetails")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("settings.wallpaperImportFailed", { count: failures.length })}
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-[60vh] space-y-3 overflow-y-auto text-sm">
            {failures.map((failure, index) => (
              <li key={index} className="space-y-1">
                {failure.name ? (
                  <p className="break-all">{failure.name}</p>
                ) : null}
                <p className="text-muted-foreground">
                  {t(ERROR_KEYS[failure.code])}
                </p>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!renaming}
        onOpenChange={(open) => {
          if (!open && !pending) setRenaming(null);
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("settings.renameWallpaperTitle")}</DialogTitle>
            <DialogDescription className="sr-only">
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
