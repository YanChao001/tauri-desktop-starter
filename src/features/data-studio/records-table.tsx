import { useMemo, useRef, useState } from "react";
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResizeHandle } from "@/components/resize-handle";
import { SlidersHorizontalIcon, ArrowUpRightIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/providers/i18n";
import {
  archiveDemoRecords,
  createDemoRecords,
  type DemoRecord,
} from "./model";

// 显式注册表格所需的 feature 与 row-model。
const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  filterFns: { includesString: filterFn_includesString },
  sortFns: { basic: sortFn_basic, text: sortFn_text },
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
});
const column = createColumnHelper<typeof features, DemoRecord>();
const DATA_COLUMNS = ["name", "email", "team", "status", "budget"] as const;
const INITIAL_WIDTHS: Record<string, number> = {
  selection: 44,
  name: 145,
  email: 220,
  team: 130,
  status: 110,
  budget: 120,
  details: 56,
};

export function RecordsTable() {
  const { t, language } = useI18n();
  const [records, setRecords] = useState(createDemoRecords);
  const [virtual, setVirtual] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [widths, setWidths] = useState(INITIAL_WIDTHS);
  const [detail, setDetail] = useState<DemoRecord | null>(null);
  const detailOrigin = useRef<HTMLButtonElement | null>(null);
  const [batch, setBatch] = useState<{
    success: number;
    failed: number;
  } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const columns = useMemo(
    () =>
      column.columns([
        column.display({
          id: "selection",
          header: ({ table }) => (
            <Checkbox
              aria-label={t("labs.data.selectAll")}
              checked={
                table.getIsAllRowsSelected()
                  ? true
                  : table.getIsSomeRowsSelected()
                    ? "indeterminate"
                    : false
              }
              onCheckedChange={(checked) =>
                table.toggleAllRowsSelected(checked === true)
              }
            />
          ),
          cell: ({ row }) => (
            <Checkbox
              aria-label={t("labs.data.selectRow", { id: row.original.id })}
              checked={row.getIsSelected()}
              onCheckedChange={(checked) =>
                row.toggleSelected(checked === true)
              }
            />
          ),
        }),
        column.accessor("name", {
          header: t("labs.data.name"),
          sortFn: "text",
        }),
        column.accessor("email", {
          header: t("labs.data.email"),
          sortFn: "text",
        }),
        column.accessor((record) => t(`labs.data.${record.team}`), {
          id: "team",
          header: t("labs.data.team"),
          sortFn: "text",
        }),
        column.accessor("status", {
          header: t("labs.data.status"),
          cell: ({ getValue }) => t(`labs.data.${getValue()}`),
          sortFn: "text",
        }),
        column.accessor("budget", {
          header: t("labs.data.budget"),
          cell: ({ getValue }) =>
            new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en", {
              maximumFractionDigits: 2,
            }).format(getValue()),
          sortFn: "basic",
        }),
        column.display({
          id: "details",
          header: () => (
            <span className="sr-only">{t("experience.table.detailTitle")}</span>
          ),
          cell: ({ row }) => (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("experience.table.details", {
                id: row.original.id,
              })}
              onClick={(event) => {
                detailOrigin.current = event.currentTarget;
                setDetail(row.original);
              }}
            >
              <ArrowUpRightIcon />
            </Button>
          ),
        }),
      ]),
    [t, language],
  );
  const table = useTable({
    features,
    columns,
    data: records,
    getRowId: (record) => String(record.id),
    globalFilterFn: "includesString",
    getColumnCanGlobalFilter: (item) =>
      ["name", "email", "team"].includes(item.id),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });
  const rows = virtual
    ? table.getSortedRowModel().rows
    : table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () => scroll.current,
    estimateSize: () => 48,
    overscan: 6,
  });
  const items = virtualizer.getVirtualItems();
  const visible = virtual
    ? items.length
      ? items.flatMap((item) =>
          rows[item.index]
            ? [{ row: rows[item.index]!, index: item.index }]
            : [],
        )
      : rows.slice(0, 12).map((row, index) => ({ row, index }))
    : rows.map((row, index) => ({ row, index }));
  const selected = table.getSelectedRowIds();
  const first = items[0];
  const last = items.at(-1);
  function archive() {
    const result = archiveDemoRecords(records, selected.map(Number));
    setRecords(result.records);
    table.setRowSelection(
      Object.fromEntries(result.failed.map((id) => [String(id), true])),
    );
    setBatch({
      success: result.successful.length,
      failed: result.failed.length,
    });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("labs.data.records")}</CardTitle>
        <CardDescription>{t("labs.data.batchHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            type="search"
            aria-label={t("labs.data.search")}
            placeholder={t("labs.data.search")}
            className="min-w-48 flex-1"
            value={String(table.state.globalFilter ?? "")}
            onChange={(event) => {
              table.setGlobalFilter(event.target.value);
              table.setPageIndex(0);
              scroll.current?.scrollTo?.({ top: 0 });
            }}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={virtual}
              onCheckedChange={(checked) => {
                setVirtual(checked === true);
                scroll.current?.scrollTo?.({ top: 0 });
              }}
            />
            {t("labs.data.virtual")}
          </label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <SlidersHorizontalIcon />
                {t("experience.table.columns")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="space-y-3" align="end">
              {DATA_COLUMNS.map((id) => (
                <Label key={id}>
                  <Checkbox
                    disabled={id === "name"}
                    checked={!hidden.has(id)}
                    onCheckedChange={(checked) =>
                      setHidden((current) => {
                        const next = new Set(current);
                        if (checked === true) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                  />
                  {t(`labs.data.${id}`)}
                </Label>
              ))}
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            disabled={!selected.length}
            onClick={archive}
          >
            {t("labs.data.archive")}
          </Button>
        </div>
        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <span>{t("labs.data.selected", { count: selected.length })}</span>
          <span>{t("labs.data.virtualHint")}</span>
        </div>
        {batch ? (
          <p role="status" className="rounded-md bg-muted p-3 text-sm">
            {t("labs.data.batchResult", batch)}
          </p>
        ) : null}
        <div
          ref={scroll}
          tabIndex={0}
          role="region"
          aria-label={t("labs.data.records")}
          className="max-h-[28rem] overflow-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={virtual ? { height: 440 } : undefined}
        >
          <table
            className="min-w-full table-fixed text-left text-sm"
            style={{
              width: Object.entries(widths).reduce(
                (total, [id, width]) => total + (hidden.has(id) ? 0 : width),
                0,
              ),
            }}
            aria-rowcount={table.getFilteredRowModel().rows.length + 1}
          >
            <colgroup>
              {Object.entries(widths)
                .filter(([id]) => !hidden.has(id))
                .map(([id, width]) => (
                  <col key={id} style={{ width }} />
                ))}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-card">
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers
                    .filter((header) => !hidden.has(header.column.id))
                    .map((header) => (
                      <th
                        key={header.id}
                        scope="col"
                        className="relative h-11 border-b px-3 text-xs font-medium"
                        aria-sort={
                          header.column.getCanSort()
                            ? header.column.getIsSorted() === "asc"
                              ? "ascending"
                              : header.column.getIsSorted() === "desc"
                                ? "descending"
                                : "none"
                            : undefined
                        }
                      >
                        {header.column.getCanSort() ? (
                          <button
                            type="button"
                            className="inline-flex min-h-9 items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            <table.FlexRender header={header} />
                            <span aria-hidden="true">
                              {header.column.getIsSorted() === "asc"
                                ? "↑"
                                : header.column.getIsSorted() === "desc"
                                  ? "↓"
                                  : "↕"}
                            </span>
                          </button>
                        ) : (
                          <table.FlexRender header={header} />
                        )}
                        {DATA_COLUMNS.some((id) => id === header.column.id) && (
                          <span className="record-column-handle">
                            <ResizeHandle
                              label={t("experience.table.width", {
                                name: String(header.column.columnDef.header),
                              })}
                              value={widths[header.column.id] ?? 160}
                              min={100}
                              max={400}
                              onChange={(width) =>
                                setWidths((current) => ({
                                  ...current,
                                  [header.column.id]: width,
                                }))
                              }
                            />
                          </span>
                        )}
                      </th>
                    ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {virtual && first && first.start > 0 ? (
                <tr aria-hidden="true">
                  <td
                    colSpan={columns.length - hidden.size}
                    style={{ height: first.start }}
                  />
                </tr>
              ) : null}
              {visible.map(({ row, index }) => (
                <tr
                  key={row.id}
                  aria-rowindex={
                    virtual
                      ? index + 2
                      : table.state.pagination.pageIndex *
                          table.state.pagination.pageSize +
                        index +
                        2
                  }
                  className="border-b last:border-0 hover:bg-muted/50"
                  style={{ height: 48 }}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                >
                  {row
                    .getAllCells()
                    .filter((cell) => !hidden.has(cell.column.id))
                    .map((cell) => (
                      <td key={cell.id} className="truncate px-3 py-2">
                        <table.FlexRender cell={cell} />
                      </td>
                    ))}
                </tr>
              ))}
              {virtual && last && virtualizer.getTotalSize() > last.end ? (
                <tr aria-hidden="true">
                  <td
                    colSpan={columns.length - hidden.size}
                    style={{ height: virtualizer.getTotalSize() - last.end }}
                  />
                </tr>
              ) : null}
              {!rows.length ? (
                <tr>
                  <td
                    colSpan={columns.length - hidden.size}
                    className="p-6 text-center text-muted-foreground"
                  >
                    {t("labs.data.empty")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {!virtual ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {t("labs.data.page", {
                page: table.state.pagination.pageIndex + 1,
                pages: Math.max(1, table.getPageCount()),
                count: table.getFilteredRowModel().rows.length,
              })}
            </p>
            <div className="flex items-center gap-2">
              <Select
                value={String(table.state.pagination.pageSize)}
                onValueChange={(value) => table.setPageSize(Number(value))}
              >
                <SelectTrigger aria-label={t("labs.data.pageSize")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  {[20, 50, 100].map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
              >
                {t("labs.data.previous")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
              >
                {t("labs.data.next")}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
      <Dialog
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent
          closeLabel={t("common.close")}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (detailOrigin.current?.isConnected) detailOrigin.current.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("experience.table.detailTitle")}</DialogTitle>
            <DialogDescription>
              {t("experience.table.detailHint")}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-3 text-sm">
              <dt>ID</dt>
              <dd>{detail.id}</dd>
              {DATA_COLUMNS.map((id) => (
                <div key={id} className="contents">
                  <dt className="text-muted-foreground">
                    {t(`labs.data.${id}`)}
                  </dt>
                  <dd className="break-words">
                    {id === "team" || id === "status"
                      ? t(`labs.data.${detail[id]}`)
                      : detail[id]}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
