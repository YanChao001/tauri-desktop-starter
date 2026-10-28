import { SafeMarkdown } from "@/components/safe-markdown";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useDemoMotion } from "@/hooks/use-demo-motion";
import { useI18n } from "@/providers/i18n";
import { markdownExample, mediaKind } from "./model";

export function MarkdownPanel() {
  const { t, language } = useI18n();
  const [content, setContent] = useState(() => markdownExample(language));
  return (
    <Card className="@container/markdown">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t("labs.media.markdown")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid items-start gap-4 @min-[46rem]/markdown:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <Label htmlFor="markdown-source">{t("labs.media.source")}</Label>
          <Textarea
            id="markdown-source"
            rows={16}
            maxLength={20000}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="font-mono text-xs leading-relaxed md:text-xs"
          />
          <Button
            variant="outline"
            onClick={() => setContent(markdownExample(language))}
          >
            {t("labs.reset")}
          </Button>
        </div>
        <section
          aria-label={t("labs.media.preview")}
          className="min-w-0 rounded-md border p-4"
        >
          <h3 className="mb-3 text-xs text-muted-foreground">
            {t("labs.media.preview")}
          </h3>
          <SafeMarkdown content={content} />
        </section>
      </CardContent>
    </Card>
  );
}

export function MediaPreview({ active = true }: { active?: boolean }) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<{
    name: string;
    url: string;
    kind: "image" | "audio" | "video";
  } | null>(null);
  const player = useRef<HTMLMediaElement | null>(null);
  const { visible } = useDemoMotion(player);
  useEffect(() => {
    if (!active || !visible) player.current?.pause();
  }, [active, visible, preview]);
  useEffect(() => {
    const current = player.current;
    return () => {
      current?.pause();
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);
  const handlePlay = () => {
    if (!active || !visible) player.current?.pause();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t("labs.media.file")}
        </CardTitle>
        <CardDescription>{t("labs.media.fileHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Label htmlFor="media-file">{t("labs.media.choose")}</Label>
        <Input
          id="media-file"
          type="file"
          accept="image/*,audio/*,video/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            const kind = mediaKind(file);
            if (!kind) {
              toast.error(t("labs.media.invalidFile"));
              return;
            }
            setPreview({
              name: file.name,
              url: URL.createObjectURL(file),
              kind,
            });
          }}
        />
        {preview ? (
          <div data-surface="control" className="space-y-3 rounded-md p-3">
            <p className="break-all text-xs text-muted-foreground">
              {preview.name}
            </p>
            {preview.kind === "image" ? (
              <img
                src={preview.url}
                alt={preview.name}
                onError={() => toast.error(t("labs.media.decodeError"))}
                className="mx-auto max-h-80 max-w-full rounded-md object-contain"
              />
            ) : preview.kind === "audio" ? (
              <audio
                ref={(element) => {
                  player.current = element;
                }}
                controls
                preload="metadata"
                src={preview.url}
                className="w-full"
                aria-label={preview.name}
                onPlay={handlePlay}
                onError={() => toast.error(t("labs.media.decodeError"))}
              />
            ) : (
              <video
                ref={(element) => {
                  player.current = element;
                }}
                controls
                preload="metadata"
                src={preview.url}
                className="max-h-80 w-full rounded-md"
                aria-label={preview.name}
                onPlay={handlePlay}
                onError={() => toast.error(t("labs.media.decodeError"))}
              />
            )}
            <Button
              variant="outline"
              onClick={() => {
                setPreview(null);
              }}
            >
              {t("labs.media.clear")}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("labs.media.empty")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
