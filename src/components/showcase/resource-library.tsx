import { useEffect, useState } from "react";
import {
  ArrowUpRightIcon,
  Grid2x2Icon,
  ListIcon,
  SearchIcon,
  SparklesIcon,
  StarIcon,
  XIcon,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/providers/i18n";

const CATEGORIES = [
  { id: "all", label: "playground.categoryAll" },
  { id: "design", label: "playground.categoryDesign" },
  { id: "code", label: "playground.categoryCode" },
  { id: "notes", label: "playground.categoryNotes" },
] as const;
const RESOURCES = [
  {
    id: "prism",
    initials: "PR",
    category: "design",
    palette: "violet",
    title: "playground.prismTitle",
    description: "playground.prismDescription",
  },
  {
    id: "orbit",
    initials: "OR",
    category: "design",
    palette: "cyan",
    title: "playground.orbitTitle",
    description: "playground.orbitDescription",
  },
  {
    id: "atlas",
    initials: "AT",
    category: "code",
    palette: "amber",
    title: "playground.atlasTitle",
    description: "playground.atlasDescription",
  },
  {
    id: "craft",
    initials: "CR",
    category: "code",
    palette: "violet",
    title: "playground.craftTitle",
    description: "playground.craftDescription",
  },
  {
    id: "field",
    initials: "FI",
    category: "notes",
    palette: "cyan",
    title: "playground.fieldTitle",
    description: "playground.fieldDescription",
  },
  {
    id: "motion",
    initials: "MO",
    category: "notes",
    palette: "amber",
    title: "playground.motionTitle",
    description: "playground.motionDescription",
  },
] as const;
type Resource = (typeof RESOURCES)[number];

export function ResourceLibrary({ active }: { active: boolean }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(
    () => new Set(["prism"]),
  );
  const [layout, setLayout] = useState("grid");
  const [selected, setSelected] = useState<Resource | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!loading) return;
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      setProgress(step * 20);
      if (step === 5) {
        clearInterval(timer);
        setLoading(false);
      }
    }, 150);
    return () => clearInterval(timer);
  }, [loading]);
  const normalized = query.trim().toLocaleLowerCase();
  const resources = RESOURCES.filter(
    (resource) =>
      (category === "all" || category === resource.category) &&
      (!favoritesOnly || favorites.has(resource.id)) &&
      (!normalized ||
        `${t(resource.title)} ${t(resource.description)} ${t(CATEGORIES.find((item) => item.id === resource.category)!.label)}`
          .toLocaleLowerCase()
          .includes(normalized)),
  );
  function toggleFavorite(id: string) {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearFilters() {
    setQuery("");
    setCategory("all");
    setFavoritesOnly(false);
  }
  function favoriteButton(resource: Resource) {
    const saved = favorites.has(resource.id);
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t(saved ? "playground.unfavorite" : "playground.favorite", {
          name: t(resource.title),
        })}
        aria-pressed={saved}
        onClick={() => toggleFavorite(resource.id)}
      >
        <StarIcon
          className={saved ? "resource-star-active" : undefined}
          fill={saved ? "currentColor" : "none"}
        />
      </Button>
    );
  }
  return (
    <section
      className="library-collection"
      data-active={active}
      aria-labelledby="library-heading"
    >
      <div className="playground-section-heading">
        <span className="playground-kicker">03 / {t("playground.data")}</span>
        <h3 id="library-heading">{t("playground.libraryTitle")}</h3>
        <p>{t("playground.libraryDescription")}</p>
      </div>
      <div className="library-toolbar">
        <div className="library-search">
          <SearchIcon aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("playground.searchPlaceholder")}
            aria-label={t("playground.search")}
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger
            className="library-category"
            aria-label={t("playground.category")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {t(item.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ToggleGroup
          type="single"
          value={layout}
          onValueChange={(value) => {
            if (value) setLayout(value);
          }}
          size="sm"
          variant="outline"
          aria-label={t("playground.layout")}
        >
          <ToggleGroupItem value="grid" aria-label={t("playground.grid")}>
            <Grid2x2Icon />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label={t("playground.list")}>
            <ListIcon />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="library-meta">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={favoritesOnly}
              onCheckedChange={(checked) => setFavoritesOnly(checked === true)}
            />
            {t("playground.favoritesOnly")}
          </Label>
          <span className="playground-muted" role="status" aria-live="polite">
            {t("playground.resultCount", { count: resources.length })}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (loading) setLoading(false);
            else {
              setProgress(0);
              setLoading(true);
            }
          }}
        >
          {loading ? <XIcon /> : <SparklesIcon />}
          {t(loading ? "playground.cancelLoading" : "playground.tryLoading")}
        </Button>
      </div>
      <div className="library-results" aria-busy={loading}>
        {loading ? (
          <div className="library-loading">
            <Progress value={progress} aria-label={t("playground.loading")} />
            <p role="status">
              {t("playground.loading")} · {progress}%
            </p>
            <div className="library-resource-grid">
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="resource-skeleton"
                  aria-hidden="true"
                >
                  <Skeleton className="h-28 w-full" />
                  <Skeleton className="mt-4 h-4 w-3/4" />
                  <Skeleton className="mt-2 h-3 w-1/2" />
                </div>
              ))}
            </div>
          </div>
        ) : resources.length === 0 ? (
          <div className="library-empty">
            <SearchIcon aria-hidden="true" />
            <h4>{t("playground.emptyTitle")}</h4>
            <p>{t("playground.emptyDescription")}</p>
            <Button variant="outline" onClick={clearFilters}>
              {t("playground.clearFilters")}
            </Button>
          </div>
        ) : layout === "grid" ? (
          <div className="library-resource-grid">
            {resources.map((resource) => (
              <article
                key={resource.id}
                className="resource-card"
                data-palette={resource.palette}
              >
                <button
                  className="resource-open"
                  onClick={() => setSelected(resource)}
                >
                  <div className="resource-art" aria-hidden="true">
                    <span className="resource-art-ring" />
                    <span className="resource-art-gem" />
                    <span className="resource-art-initials">
                      {resource.initials}
                    </span>
                    <ArrowUpRightIcon />
                  </div>
                  <h4>{t(resource.title)}</h4>
                  <p>{t(resource.description)}</p>
                </button>
                <div className="resource-card-footer">
                  <Badge variant="outline">
                    {t(
                      CATEGORIES.find((item) => item.id === resource.category)!
                        .label,
                    )}
                  </Badge>
                  {favoriteButton(resource)}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="library-table playground-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("playground.resourceName")}</TableHead>
                  <TableHead>{t("playground.resourceType")}</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">
                      {t("playground.addFavorite")}
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resources.map((resource) => (
                  <TableRow key={resource.id}>
                    <TableCell>
                      <button
                        className="resource-table-name"
                        onClick={() => setSelected(resource)}
                      >
                        <Avatar className="size-8">
                          <AvatarFallback className="text-[10px]">
                            {resource.initials}
                          </AvatarFallback>
                        </Avatar>
                        <span>{t(resource.title)}</span>
                      </button>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {t(
                        CATEGORIES.find(
                          (item) => item.id === resource.category,
                        )!.label,
                      )}
                    </TableCell>
                    <TableCell>{favoriteButton(resource)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      <Dialog
        open={selected !== null}
        onOpenChange={(value) => {
          if (!value) setSelected(null);
        }}
      >
        <DialogContent closeLabel={t("common.close")} className="sm:max-w-md">
          {selected ? (
            <>
              <DialogHeader>
                <Badge variant="outline" className="mb-2 w-fit">
                  {t("playground.sample")}
                </Badge>
                <DialogTitle>{t(selected.title)}</DialogTitle>
                <DialogDescription className="leading-relaxed">
                  {t(selected.description)}
                </DialogDescription>
              </DialogHeader>
              <div
                className="resource-detail-art"
                data-palette={selected.palette}
                aria-hidden="true"
              >
                <span className="resource-art-ring" />
                <span className="resource-art-gem" />
                <span className="resource-art-initials">
                  {selected.initials}
                </span>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelected(null)}>
                  {t("common.close")}
                </Button>
                <Button onClick={() => toggleFavorite(selected.id)}>
                  <StarIcon
                    fill={favorites.has(selected.id) ? "currentColor" : "none"}
                  />
                  {t(
                    favorites.has(selected.id)
                      ? "playground.removeFavorite"
                      : "playground.addFavorite",
                  )}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
