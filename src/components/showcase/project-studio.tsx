import { useRef, useState, type CSSProperties } from "react";
import {
  ArrowUpRightIcon,
  Code2Icon,
  RotateCcwIcon,
  ShuffleIcon,
  SparklesIcon,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { CodeBlock } from "@/components/code-block";
import { useDemoMotion } from "@/hooks/use-demo-motion";
import { useI18n } from "@/providers/i18n";

const PALETTES = [
  { value: "violet", label: "playground.colorViolet" },
  { value: "cyan", label: "playground.colorCyan" },
  { value: "amber", label: "playground.colorAmber" },
] as const;
const KINDS = [
  { value: "brand", label: "playground.kindBrand" },
  { value: "product", label: "playground.kindProduct" },
  { value: "story", label: "playground.kindStory" },
] as const;
const COMPOSITIONS = [
  { value: "calm", label: "playground.compositionCalm" },
  { value: "balanced", label: "playground.compositionBalanced" },
  { value: "bold", label: "playground.compositionBold" },
] as const;
const INITIAL = {
  name: "",
  kind: "brand",
  palette: "violet",
  energy: 64,
  composition: "balanced",
  glow: true,
  author: true,
};

export function ProjectStudio({ active }: { active: boolean }) {
  const { t } = useI18n();
  const artwork = useRef<HTMLDivElement>(null);
  const { active: artworkActive } = useDemoMotion(artwork, active);
  const [project, setProject] = useState(INITIAL);
  const update = (patch: Partial<typeof INITIAL>) =>
    setProject((current) => ({ ...current, ...patch }));
  const kind = KINDS.find((item) => item.value === project.kind)!;
  const name = project.name.trim() || t("playground.defaultName");
  const energyStyle = {
    "--studio-energy": project.energy / 100,
    "--studio-turn": `${project.energy * 0.65}deg`,
  } as CSSProperties;
  function remix() {
    setProject((current) => ({
      ...current,
      palette:
        PALETTES[
          (PALETTES.findIndex((item) => item.value === current.palette) + 1) %
            PALETTES.length
        ]!.value,
      kind: KINDS[
        (KINDS.findIndex((item) => item.value === current.kind) + 1) %
          KINDS.length
      ]!.value,
      composition:
        COMPOSITIONS[
          (COMPOSITIONS.findIndex(
            (item) => item.value === current.composition,
          ) +
            1) %
            COMPOSITIONS.length
        ]!.value,
      energy: current.energy >= 75 ? 30 : current.energy + 25,
    }));
  }
  return (
    <section
      className="playground-studio playground-surface"
      aria-labelledby="studio-heading"
    >
      <div className="studio-controls">
        <div className="playground-section-heading">
          <span className="playground-kicker">
            01 / {t("playground.inputs")}
          </span>
          <h3 id="studio-heading">{t("playground.studioTitle")}</h3>
          <p>{t("playground.studioDescription")}</p>
        </div>
        <div className="studio-field">
          <Label htmlFor="studio-name">{t("playground.name")}</Label>
          <Input
            id="studio-name"
            value={project.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder={t("playground.namePlaceholder")}
            maxLength={60}
          />
        </div>
        <div className="studio-field">
          <Label htmlFor="studio-kind">{t("playground.kind")}</Label>
          <Select
            value={project.kind}
            onValueChange={(value) => update({ kind: value })}
          >
            <SelectTrigger id="studio-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {t(item.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <fieldset className="studio-field">
          <legend>{t("playground.color")}</legend>
          <RadioGroup
            value={project.palette}
            onValueChange={(palette) => update({ palette })}
            className="studio-palettes"
            aria-label={t("playground.color")}
          >
            {PALETTES.map((item) => (
              <label
                key={item.value}
                className="studio-swatch"
                data-palette={item.value}
              >
                <RadioGroupItem value={item.value} aria-label={t(item.label)} />
                <span className="studio-swatch-dot" aria-hidden="true" />
                <span>{t(item.label)}</span>
              </label>
            ))}
          </RadioGroup>
        </fieldset>
        <fieldset className="studio-field">
          <legend>{t("playground.composition")}</legend>
          <RadioGroup
            value={project.composition}
            onValueChange={(composition) => update({ composition })}
            className="studio-compositions"
            aria-label={t("playground.composition")}
          >
            {COMPOSITIONS.map((item) => (
              <label key={item.value}>
                <RadioGroupItem value={item.value} />
                <span>{t(item.label)}</span>
              </label>
            ))}
          </RadioGroup>
        </fieldset>
        <div className="studio-field">
          <div className="flex items-center justify-between gap-3">
            <Label id="studio-energy">{t("playground.energy")}</Label>
            <output
              className="playground-number"
              aria-labelledby="studio-energy"
            >
              {project.energy}
            </output>
          </div>
          <Slider
            value={[project.energy]}
            onValueChange={([energy]) => update({ energy: energy ?? 0 })}
            max={100}
            step={1}
            aria-labelledby="studio-energy"
          />
        </div>
        <div className="studio-switch-row">
          <div>
            <Label htmlFor="studio-glow">{t("playground.glow")}</Label>
            <p>{t("playground.glowDescription")}</p>
          </div>
          <Switch
            id="studio-glow"
            checked={project.glow}
            onCheckedChange={(glow) => update({ glow })}
          />
        </div>
        <label className="studio-author-toggle">
          <Checkbox
            checked={project.author}
            onCheckedChange={(value) => update({ author: value === true })}
          />
          <span>{t("playground.showAuthor")}</span>
        </label>
        <div className="studio-actions">
          <Button onClick={remix}>
            <ShuffleIcon />
            {t("playground.remix")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setProject(INITIAL)}
            aria-label={t("playground.reset")}
            title={t("playground.reset")}
          >
            <RotateCcwIcon />
          </Button>
        </div>
      </div>
      <div
        className="studio-canvas"
        data-palette={project.palette}
        data-composition={project.composition}
        data-glow={project.glow}
        style={energyStyle}
      >
        <div className="studio-canvas-top">
          <span className="studio-live-dot" />
          {t("playground.livePreview")}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t("playground.inspect")}
              >
                <Code2Icon />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72">
              <PopoverHeader>
                <PopoverTitle>{t("playground.configuration")}</PopoverTitle>
              </PopoverHeader>
              <CodeBlock
                code={JSON.stringify({ ...project, name }, null, 2)}
                language="json"
                className="mt-3 max-h-72"
              />
            </PopoverContent>
          </Popover>
        </div>
        <article
          className="studio-preview"
          aria-label={t("playground.livePreview")}
        >
          <div
            ref={artwork}
            className="studio-art"
            data-active={artworkActive}
            aria-hidden="true"
          >
            <div className="studio-aura" />
            <div className="studio-orbit">
              <span className="studio-orbit-ring" />
              <span className="studio-orbit-ring studio-orbit-ring-two" />
              <span className="studio-orb" />
              <SparklesIcon className="studio-art-spark" />
              <span className="studio-art-square" />
            </div>
            <span className="studio-art-caption">
              {String(project.energy).padStart(2, "0")} / 100
            </span>
          </div>
          <div className="studio-preview-content">
            <Badge variant="outline">{t(kind.label)}</Badge>
            <h4 data-testid="studio-preview-title">{name}</h4>
            <p>{t("playground.defaultDescription")}</p>
            <div className="studio-preview-credit">
              {project.author ? (
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar className="size-6">
                    <AvatarFallback className="text-[9px]">SN</AvatarFallback>
                  </Avatar>
                  <span className="truncate">{t("playground.author")}</span>
                </span>
              ) : (
                <span />
              )}
              <ArrowUpRightIcon className="size-4" aria-hidden="true" />
            </div>
          </div>
        </article>
        <p className="studio-canvas-caption">{t("playground.draft")}</p>
      </div>
    </section>
  );
}
