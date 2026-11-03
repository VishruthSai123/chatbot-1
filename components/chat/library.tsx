"use client";

import {
  BookOpenIcon,
  CodeIcon,
  FileTextIcon,
  ImageIcon,
  Loader2Icon,
  MicIcon,
  SearchIcon,
  TableIcon,
  Trash2Icon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useArtifact } from "@/hooks/use-artifact";
import { cn } from "@/lib/utils";

/**
 * The Library.
 *
 * Everything the tools have produced, in one place. Until this existed, the only
 * way to find a PDF made yesterday was to scroll chat history — which works
 * until a user has made twenty things.
 *
 * The list deliberately does not carry file bodies: a document descriptor can
 * hold a whole document's text, and a page of them would be megabytes for a
 * screen that only needs titles.
 */

type DocumentKind =
  | "audio"
  | "code"
  | "doc"
  | "image"
  | "notebook"
  | "pdf"
  | "sheet"
  | "text";

type LibraryDocument = {
  createdAt: string;
  id: string;
  kind: DocumentKind | null;
  title: string;
};

const KINDS: { id: DocumentKind | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "image", label: "Images" },
  { id: "pdf", label: "PDF" },
  { id: "sheet", label: "Sheets" },
  { id: "doc", label: "Documents" },
  { id: "audio", label: "Audio" },
  { id: "notebook", label: "Notebooks" },
];

const ICONS = {
  audio: MicIcon,
  code: CodeIcon,
  doc: FileTextIcon,
  image: ImageIcon,
  notebook: BookOpenIcon,
  pdf: FileTextIcon,
  sheet: TableIcon,
  text: FileTextIcon,
} as const;

const KIND_LABELS: Record<DocumentKind, string> = {
  audio: "Audio",
  code: "Code",
  doc: "Document",
  image: "Image",
  notebook: "Notebook",
  pdf: "PDF",
  sheet: "Sheet",
  text: "Text",
};

function iconFor(kind: DocumentKind | null) {
  return ICONS[kind ?? "text"] ?? FileTextIcon;
}

/** "3 minutes ago", "yesterday", "12 Mar". */
function relativeDate(value: string): string {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }

  const days = Math.floor(hours / 24);

  if (days === 1) {
    return "yesterday";
  }

  if (days < 7) {
    return `${days} days ago`;
  }

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

export function Library() {
  const router = useRouter();
  const { setArtifact } = useArtifact();

  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [kind, setKind] = useState<DocumentKind | "all">("all");
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (search: string, filter: DocumentKind | "all") => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ limit: "60" });

        if (search.trim()) {
          params.set("q", search.trim());
        }

        if (filter !== "all") {
          params.set("kind", filter);
        }

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?${params}`
        );
        const data = await response.json();

        if (!response.ok) {
          setError(data?.error ?? "The library could not be loaded.");
          return;
        }

        setDocuments(data.documents ?? []);
      } catch {
        setError("The library could not be loaded.");
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      load(query, kind);
    }, 250);

    return () => clearTimeout(timer);
  }, [kind, load, query]);

  const handleOpen = useCallback(
    async (document: LibraryDocument) => {
      setOpeningId(document.id);

      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${document.id}`
        );
        const versions = await response.json();

        if (!response.ok || !Array.isArray(versions) || versions.length === 0) {
          toast.error("That document could not be opened.");
          return;
        }

        const latest = versions.at(-1);

        setArtifact((current) => ({
          ...current,
          content: latest.content ?? "",
          documentId: document.id,
          isVisible: true,
          kind: document.kind ?? "text",
          status: "idle",
          title: document.title,
        }));

        // The chat shell owns the artifact panel, so the document is opened
        // from the chat rather than from the library itself.
        router.push("/");
      } catch {
        toast.error("That document could not be opened.");
      } finally {
        setOpeningId(null);
      }
    },
    [router, setArtifact]
  );

  const handleDelete = useCallback(async (document: LibraryDocument) => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${document.id}&timestamp=${encodeURIComponent(document.createdAt)}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        toast.error("That document could not be deleted.");
        return;
      }

      setDocuments((current) =>
        current.filter((item) => item.id !== document.id)
      );
      toast.success("Deleted");
    } catch {
      toast.error("That document could not be deleted.");
    }
  }, []);

  const empty = useMemo(
    () => !isLoading && documents.length === 0,
    [documents.length, isLoading]
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 md:px-6 md:py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Library
        </h1>
        <p className="text-[12px] text-muted-foreground">
          Everything you have made with the tools, newest first.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-2.5">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <input
            aria-label="Search the library"
            className="w-full rounded-lg border border-border/60 bg-card/40 py-2 pr-3 pl-9 text-[12px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-border focus:bg-card/80"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by title…"
            type="search"
            value={query}
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((option) => (
            <button
              className={cn(
                "cursor-pointer rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                kind === option.id
                  ? "border-foreground/30 bg-muted text-foreground"
                  : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
              )}
              key={option.id}
              onClick={() => setKind(option.id)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2Icon className="size-5 animate-spin" />
        </div>
      ) : error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12px] text-destructive">
          {error}
        </p>
      ) : empty ? (
        <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/60 py-16 text-center">
          <p className="text-[13px] font-medium text-foreground/80">
            {query || kind !== "all"
              ? "Nothing matches that"
              : "Nothing here yet"}
          </p>
          <p className="max-w-xs text-[11px] text-muted-foreground">
            {query || kind !== "all"
              ? "Try a different search or filter."
              : "Ask the assistant to make something — a PDF, an edited image, a notebook — and it will appear here."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {documents.map((document) => {
            const Icon = iconFor(document.kind);

            return (
              <div
                className="group flex flex-col gap-2 rounded-xl border border-border/60 bg-card/40 p-3 transition-colors hover:border-border hover:bg-card/80"
                key={document.id}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
                    <span className="truncate text-[12px] font-medium text-foreground/90">
                      {document.title}
                    </span>
                  </div>

                  {/*
                    Two clicks, no modal: the first arms the button, the second
                    deletes. Deleting a document is not undoable, so it should
                    not be one stray click away.
                  */}
                  <button
                    aria-label={
                      confirmingId === document.id
                        ? `Confirm deleting ${document.title}`
                        : `Delete ${document.title}`
                    }
                    className={cn(
                      "flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-[10px] transition-all",
                      confirmingId === document.id
                        ? "bg-destructive/10 text-destructive opacity-100"
                        : "text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-destructive"
                    )}
                    onBlur={() => setConfirmingId(null)}
                    onClick={() =>
                      confirmingId === document.id
                        ? handleDelete(document)
                        : setConfirmingId(document.id)
                    }
                    type="button"
                  >
                    <Trash2Icon className="size-3" />
                    {confirmingId === document.id ? "Delete?" : null}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground/60">
                    {KIND_LABELS[document.kind ?? "text"]} ·{" "}
                    {relativeDate(document.createdAt)}
                  </span>

                  <button
                    className="flex cursor-pointer items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    disabled={openingId === document.id}
                    onClick={() => handleOpen(document)}
                    type="button"
                  >
                    {openingId === document.id ? (
                      <Loader2Icon className="size-3 animate-spin" />
                    ) : null}
                    Open
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
