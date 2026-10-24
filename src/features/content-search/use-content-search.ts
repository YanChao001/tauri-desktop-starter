import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileTextIcon, NotebookIcon } from "lucide-react";
import { isTauri, queryNotes, recentWorkbenchFiles } from "@/lib/tauri";
import { useRegisterCommands } from "@/providers/commands";
import { useI18n } from "@/providers/i18n";
import type { AppCommand } from "@/commands/types";

type Hit = { id: string; label: string; path: string; kind: "note" | "file" };
type SearchRequest = { term: string; attempt: number; eligible: boolean };
const EMPTY: Hit[] = [];

export function useContentSearch(query: string, open: boolean) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const term = query.trim();
  const native = isTauri();
  const tooLong = new TextEncoder().encode(term).length > 200;
  const eligible = native && open && term.length >= 2 && !tooLong;
  const [attempt, setAttempt] = useState(0);
  // 重开面板或回到同一词条也属于新请求，防抖期间不能重新暴露旧结果。
  const request = useMemo<SearchRequest>(
    () => ({ term, attempt, eligible }),
    [term, attempt, eligible],
  );
  const [snapshot, setSnapshot] = useState<{
    request: SearchRequest | null;
    hits: Hit[];
    failed: boolean;
  }>({ request: null, hits: EMPTY, failed: false });
  useEffect(() => {
    const { term, eligible } = request;
    if (!eligible) return;
    let stopped = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const result = await Promise.allSettled([
          queryNotes({
            search: term,
            offset: 0,
            limit: 8,
            sort: "updated-desc",
            trash: false,
          }),
          recentWorkbenchFiles(),
        ]);
        if (stopped) return;
        const hits: Hit[] = [];
        const notes = result[0],
          files = result[1];
        if (notes.status === "fulfilled")
          for (const note of notes.value.items.slice(0, 8))
            hits.push({
              id: `content-note-${note.id}`,
              label: note.title,
              path: `/database?note=${note.id}`,
              kind: "note",
            });
        if (files.status === "fulfilled")
          for (const file of files.value
            .filter(
              (item) =>
                !item.directory &&
                item.name
                  .toLocaleLowerCase()
                  .includes(term.toLocaleLowerCase()),
            )
            .slice(0, 8))
            hits.push({
              id: `content-file-${file.id}`,
              label: file.name,
              path: `/workbench?file=${encodeURIComponent(file.id)}`,
              kind: "file",
            });
        setSnapshot({
          request,
          hits,
          failed: result.some((value) => value.status === "rejected"),
        });
      })().catch(() => {
        if (!stopped) setSnapshot({ request, hits: EMPTY, failed: true });
      });
    }, 180);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [request]);
  const current = eligible && snapshot.request === request;
  const hits = current ? snapshot.hits : EMPTY;
  const commands = useMemo<AppCommand[]>(
    () =>
      hits.map((hit) => ({
        id: hit.id,
        labelKey: "search.open",
        label: hit.label,
        description: t(hit.kind === "note" ? "search.note" : "search.file"),
        group: "content",
        icon: hit.kind === "note" ? NotebookIcon : FileTextIcon,
        keywords: [term, hit.label],
        available: isTauri,
        run: () => navigate(hit.path),
      })),
    [hits, term, navigate, t],
  );
  useRegisterCommands(commands);
  const ids = useMemo(
    () => new Set(commands.map((command) => command.id)),
    [commands],
  );
  return {
    commands,
    ids,
    loading: eligible && !current,
    failed: current && snapshot.failed,
    tooLong,
    native,
    retry: () => setAttempt((value) => value + 1),
  };
}
