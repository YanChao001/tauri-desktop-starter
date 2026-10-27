import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  FileCodeIcon,
  FolderIcon,
  FolderInputIcon,
  CopyIcon,
  PencilIcon,
  Trash2Icon,
  ArrowUpIcon,
  ArrowDownIcon,
  Undo2Icon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  GripVerticalIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResizeHandle } from "@/components/resize-handle";
import { HelpTooltip } from "@/components/help-tooltip";
import { useI18n } from "@/providers/i18n";
import {
  reorderAssets,
  workspaceReducer,
  type SampleAsset,
} from "./workspace-model";
import "@/styles/workspace.css";

const KINDS = ["document", "source", "data"] as const;
const FOLDERS = ["design", "code"] as const;
const seed: readonly SampleAsset[] = [
  {
    id: "brief",
    name: "brief.md",
    folder: "design",
    kind: "document",
    content: "",
  },
  {
    id: "palette",
    name: "palette.json",
    folder: "design",
    kind: "data",
    content: '{\n  "surface": "var(--card)",\n  "accent": "var(--primary)"\n}',
  },
  {
    id: "motion",
    name: "motion.ts",
    folder: "code",
    kind: "source",
    content:
      "export const spring = {\n  stiffness: 160,\n  damping: 14,\n  mass: 1,\n};",
  },
  {
    id: "readme",
    name: "README.md",
    folder: "code",
    kind: "document",
    content: "",
  },
];

export function WorkspaceStudio() {
  const { t } = useI18n();
  const localizedSeed = useMemo(
    () =>
      seed.map((asset) => {
        if (asset.id === "brief")
          return { ...asset, content: t("experience.workspace.brief") };
        if (asset.id === "readme")
          return { ...asset, content: t("experience.workspace.readme") };
        return asset;
      }),
    [t],
  );
  const [state, dispatch] = useReducer(workspaceReducer, {
    assets: localizedSeed,
    previous: null,
  });
  const [selected, setSelected] = useState("brief");
  const [focused, setFocused] = useState("folder-design");
  const [opened, setOpened] = useState<ReadonlySet<string>>(
    () => new Set(FOLDERS),
  );
  const [kinds, setKinds] = useState<ReadonlySet<string>>(() => new Set(KINDS));
  const [query, setQuery] = useState("");
  const [width, setWidth] = useState(200);
  const [limit, setLimit] = useState(280);
  const [renaming, setRenaming] = useState<SampleAsset | null>(null);
  const [name, setName] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLButtonElement>());
  const renameOrigin = useRef<HTMLElement | null>(null);
  const dragging = useRef<string | null>(null);
  const sequence = useRef(10);
  const selectedAsset =
    state.assets.find((asset) => asset.id === selected) ?? state.assets[0];
  const filtered = useMemo(
    () => state.assets.filter((asset) => kinds.has(asset.kind)),
    [state.assets, kinds],
  );
  const nodes = useMemo(
    () =>
      FOLDERS.flatMap((folder) => [
        { id: `folder-${folder}`, folder, asset: null as SampleAsset | null },
        ...(opened.has(folder)
          ? filtered
              .filter((asset) => asset.folder === folder)
              .map((asset) => ({ id: asset.id, folder, asset }))
          : []),
      ]),
    [filtered, opened],
  );
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setLimit(
        Math.max(140, Math.min(280, Math.floor(element.clientWidth * 0.45))),
      ),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!nodes.some((node) => node.id === focused)) setFocused(nodes[0]!.id);
  }, [nodes, focused]);
  const change = (assets: readonly SampleAsset[]) =>
    dispatch({ type: "change", assets });
  const focus = (id: string) => {
    setFocused(id);
    elements.current.get(id)?.focus();
  };
  function toggleFolder(folder: string) {
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }
  function treeKey(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    const index = nodes.findIndex((node) => node.id === id),
      node = nodes[index];
    if (!node) return;
    let destination: string | undefined;
    if (event.key === "ArrowDown")
      destination = nodes[Math.min(nodes.length - 1, index + 1)]?.id;
    else if (event.key === "ArrowUp")
      destination = nodes[Math.max(0, index - 1)]?.id;
    else if (event.key === "Home") destination = nodes[0]?.id;
    else if (event.key === "End") destination = nodes.at(-1)?.id;
    else if (event.key === "ArrowRight" && !node.asset) {
      if (!opened.has(node.folder)) toggleFolder(node.folder);
      else destination = nodes[index + 1]?.asset?.id;
    } else if (event.key === "ArrowLeft") {
      if (node.asset) destination = `folder-${node.folder}`;
      else if (opened.has(node.folder)) toggleFolder(node.folder);
    } else return;
    event.preventDefault();
    if (destination) focus(destination);
  }
  function duplicate(asset: SampleAsset) {
    const id = `copy-${sequence.current++}`;
    change([
      ...state.assets,
      {
        ...asset,
        id,
        name: t("experience.workspace.copy", { name: asset.name }),
      },
    ]);
    setSelected(id);
  }
  function move(direction: number) {
    if (!selectedAsset) return;
    const siblings = state.assets.filter(
      (asset) => asset.folder === selectedAsset.folder,
    );
    const index = siblings.findIndex((asset) => asset.id === selectedAsset.id);
    const destination = siblings[index + direction];
    if (!destination) return;
    const next = [...state.assets],
      a = next.findIndex((asset) => asset.id === selectedAsset.id),
      b = next.findIndex((asset) => asset.id === destination.id);
    [next[a], next[b]] = [next[b]!, next[a]!];
    change(next);
  }
  function drop(id: string, folder?: SampleAsset["folder"]) {
    const moving = state.assets.find((asset) => asset.id === dragging.current);
    if (!moving) return;
    if (folder) moveToFolder(moving.id, folder);
    else change(reorderAssets(state.assets, moving.id, id));
    dragging.current = null;
  }
  function moveToFolder(id: string, folder: SampleAsset["folder"]) {
    const moving = state.assets.find((asset) => asset.id === id);
    if (!moving || moving.folder === folder) return;
    change([
      ...state.assets.filter((asset) => asset.id !== id),
      { ...moving, folder },
    ]);
    setOpened((current) => new Set([...current, folder]));
  }
  return (
    <section className="workspace-showcase" aria-labelledby="workspace-heading">
      <div className="playground-section-heading">
        <span className="playground-kicker">
          04 / {t("experience.workspace")}
        </span>
        <h3 id="workspace-heading" className="flex items-center gap-1.5">
          {t("experience.workspaceTitle")}
          <HelpTooltip label={t("experience.workspace.reorderHint")}>
            {t("experience.workspace.reorderHint")}
          </HelpTooltip>
        </h3>
        <p>{t("experience.workspaceHint")}</p>
      </div>
      <div className="workspace-toolbar">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">
              <SlidersHorizontalIcon />
              {t("experience.workspace.filter")}
              <span className="workspace-count">{kinds.size}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="space-y-3">
            <Input
              aria-label={t("experience.workspace.searchType")}
              placeholder={t("experience.workspace.searchType")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {KINDS.filter((kind) =>
              t(`experience.workspace.${kind}`)
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
            ).map((kind) => (
              <Label key={kind}>
                <Checkbox
                  checked={kinds.has(kind)}
                  onCheckedChange={(checked) =>
                    setKinds((current) => {
                      const next = new Set(current);
                      if (checked === true) next.add(kind);
                      else next.delete(kind);
                      return next;
                    })
                  }
                />
                {t(`experience.workspace.${kind}`)}
              </Label>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setKinds(new Set(KINDS));
                setQuery("");
              }}
            >
              {t("experience.workspace.clear")}
            </Button>
          </PopoverContent>
        </Popover>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={!state.previous}
            onClick={() => dispatch({ type: "undo" })}
          >
            <Undo2Icon />
            {t("experience.workspace.undo")}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("experience.workspace.reset")}
            onClick={() => {
              dispatch({ type: "reset", assets: localizedSeed });
              setSelected("brief");
              setQuery("");
              setKinds(new Set(KINDS));
              setOpened(new Set(FOLDERS));
            }}
          >
            <RotateCcwIcon />
          </Button>
        </div>
      </div>
      <div
        className="workspace-demo"
        ref={root}
        style={
          { "--resource-width": `${Math.min(width, limit)}px` } as CSSProperties
        }
      >
        <div className="workspace-tree-panel">
          <div className="workspace-panel-label">
            {t("experience.workspace.tree")}
          </div>
          <div role="tree" aria-label={t("experience.workspace.tree")}>
            {nodes.map((node) => {
              const button = (
                <button
                  type="button"
                  role="treeitem"
                  key={node.id}
                  ref={(element) => {
                    if (element) elements.current.set(node.id, element);
                    else elements.current.delete(node.id);
                  }}
                  tabIndex={focused === node.id ? 0 : -1}
                  aria-level={node.asset ? 2 : 1}
                  aria-expanded={
                    node.asset ? undefined : opened.has(node.folder)
                  }
                  aria-selected={
                    node.asset ? selectedAsset?.id === node.id : undefined
                  }
                  className="workspace-node"
                  data-leaf={!!node.asset}
                  onFocus={() => setFocused(node.id)}
                  onKeyDown={(event) => treeKey(event, node.id)}
                  onClick={() => {
                    if (node.asset) setSelected(node.id);
                    else toggleFolder(node.folder);
                  }}
                  draggable={!!node.asset}
                  onDragStart={(event) => {
                    if (!node.asset) return;
                    dragging.current = node.id;
                    event.dataTransfer.setData("text/plain", node.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    dragging.current = null;
                  }}
                  onDragOver={(event) => {
                    if (dragging.current) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    drop(node.id, node.asset ? undefined : node.folder);
                  }}
                >
                  {node.asset ? (
                    <>
                      <GripVerticalIcon className="workspace-drag-grip" />
                      {node.asset.kind === "source" ? (
                        <FileCodeIcon />
                      ) : (
                        <FileTextIcon />
                      )}
                      <span>{node.asset.name}</span>
                    </>
                  ) : (
                    <>
                      {opened.has(node.folder) ? (
                        <ChevronDownIcon />
                      ) : (
                        <ChevronRightIcon />
                      )}
                      <FolderIcon />
                      <span>{t(`experience.workspace.${node.folder}`)}</span>
                    </>
                  )}
                </button>
              );
              return node.asset ? (
                <ContextMenu key={node.id}>
                  <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onSelect={() => {
                        renameOrigin.current =
                          elements.current.get(node.id) ?? null;
                        setRenaming(node.asset);
                        setName(node.asset!.name);
                      }}
                    >
                      <PencilIcon />
                      {t("experience.workspace.rename")}
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => duplicate(node.asset!)}>
                      <CopyIcon />
                      {t("experience.workspace.duplicate")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() =>
                        change(
                          state.assets.filter((asset) => asset.id !== node.id),
                        )
                      }
                      className="text-destructive"
                    >
                      <Trash2Icon />
                      {t("experience.workspace.delete")}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ) : (
                button
              );
            })}
          </div>
          {!filtered.length && (
            <p className="workspace-empty">{t("experience.workspace.empty")}</p>
          )}
        </div>
        <ResizeHandle
          label={t("experience.workspace.divider")}
          value={Math.min(width, limit)}
          min={140}
          max={limit}
          onChange={setWidth}
        />
        <div className="workspace-editor">
          {selectedAsset ? (
            <>
              <div className="workspace-editor-bar">
                <span>{selectedAsset.name}</span>
                <div className="flex flex-wrap items-center gap-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost">
                        <FolderInputIcon />
                        {t("experience.workspace.moveTo")}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {FOLDERS.map((folder) => (
                        <DropdownMenuItem
                          key={folder}
                          disabled={selectedAsset.folder === folder}
                          onSelect={() =>
                            moveToFolder(selectedAsset.id, folder)
                          }
                        >
                          <FolderIcon />
                          {t(`experience.workspace.${folder}`)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("experience.workspace.up")}
                    disabled={
                      state.assets.filter(
                        (asset) => asset.folder === selectedAsset.folder,
                      )[0]?.id === selectedAsset.id
                    }
                    onClick={() => move(-1)}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("experience.workspace.down")}
                    disabled={
                      state.assets
                        .filter(
                          (asset) => asset.folder === selectedAsset.folder,
                        )
                        .at(-1)?.id === selectedAsset.id
                    }
                    onClick={() => move(1)}
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("experience.workspace.rename")}
                    onClick={(event) => {
                      renameOrigin.current = event.currentTarget;
                      setRenaming(selectedAsset);
                      setName(selectedAsset.name);
                    }}
                  >
                    <PencilIcon />
                  </Button>
                </div>
              </div>
              <Label htmlFor="workspace-content" className="sr-only">
                {t("experience.workspace.editor")}
              </Label>
              <Textarea
                id="workspace-content"
                maxLength={4096}
                rows={13}
                value={selectedAsset.content}
                onChange={(event) =>
                  change(
                    state.assets.map((asset) =>
                      asset.id === selectedAsset.id
                        ? { ...asset, content: event.target.value }
                        : asset,
                    ),
                  )
                }
                className="workspace-textarea"
              />
              <div className="workspace-editor-footer">
                {t("experience.workspace.local")}
              </div>
            </>
          ) : (
            <p className="workspace-empty">{t("experience.workspace.empty")}</p>
          )}
        </div>
      </div>
      <Dialog
        open={!!renaming}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
      >
        <DialogContent
          closeLabel={t("common.close")}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (renameOrigin.current?.isConnected) renameOrigin.current.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("experience.workspace.rename")}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim() || !renaming) return;
              change(
                state.assets.map((asset) =>
                  asset.id === renaming.id
                    ? { ...asset, name: name.trim() }
                    : asset,
                ),
              );
              setRenaming(null);
            }}
          >
            <Label htmlFor="workspace-name">
              {t("experience.workspace.fileName")}
            </Label>
            <Input
              id="workspace-name"
              value={name}
              maxLength={60}
              required
              onChange={(event) => setName(event.target.value)}
              className="my-3"
            />
            <DialogFooter>
              <Button type="submit" disabled={!name.trim()}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
