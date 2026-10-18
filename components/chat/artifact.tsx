import type { UseChatHelpers } from "@ai-sdk/react";
import { formatDistance } from "date-fns";
import equal from "fast-deep-equal";
import { AnimatePresence, motion } from "framer-motion";
import {
  type Dispatch,
  memo,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import useSWR, { useSWRConfig } from "swr";
import { useWindowSize } from "usehooks-ts";
import { codeArtifact } from "@/artifacts/code/client";
import { imageArtifact } from "@/artifacts/image/client";
import { sheetArtifact } from "@/artifacts/sheet/client";
import { textArtifact } from "@/artifacts/text/client";
import { useArtifact } from "@/hooks/use-artifact";
import type { Document, Vote } from "@/lib/db/schema";
import type { Attachment, ChatMessage } from "@/lib/types";
import { cn, fetcher } from "@/lib/utils";
import { useSidebar } from "../ui/sidebar";
import { ArtifactActions } from "./artifact-actions";
import { ArtifactCloseButton } from "./artifact-close-button";
import { LoaderIcon } from "./icons";
import { Toolbar } from "./toolbar";
import { VersionFooter } from "./version-footer";
import type { VisibilityType } from "./visibility-selector";

export const artifactDefinitions = [
  textArtifact,
  codeArtifact,
  imageArtifact,
  sheetArtifact,
];
export type ArtifactKind = (typeof artifactDefinitions)[number]["kind"];
export type ImageToolMode =
  | "compress"
  | "resize"
  | "crop"
  | "remove_bg"
  | "convert"
  | "upscale"
  | "pixelate"
  | "ocr";

export type UIArtifact = {
  title: string;
  documentId: string;
  kind: ArtifactKind;
  content: string;
  isVisible: boolean;
  status: "streaming" | "idle";
  boundingBox: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
  toolMode?: ImageToolMode;
  /** Parameters the model applied on the last image tool call; pre-fills inspectors. */
  toolParams?: Record<string, unknown> | null;
  ocrText?: string;
  /**
   * Index of the image version currently on screen (0-based). Image tools edit
   * exactly this version, so stepping back with Undo changes what gets edited.
   */
  versionIndex?: number;
};

function PureArtifact({
  addToolApprovalResponse: _addToolApprovalResponse,
  chatId: _chatId,
  input: _input,
  setInput: _setInput,
  status,
  stop,
  attachments: _attachments,
  setAttachments: _setAttachments,
  sendMessage,
  messages: _messages,
  setMessages,
  regenerate: _regenerate,
  votes: _votes,
  isReadonly: _isReadonly,
  selectedVisibilityType: _selectedVisibilityType,
  selectedModelId: _selectedModelId,
}: {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  chatId: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<ChatMessage>["status"];
  stop: UseChatHelpers<ChatMessage>["stop"];
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  votes: Vote[] | undefined;
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  selectedVisibilityType: VisibilityType;
  selectedModelId: string;
}) {
  const { artifact, setArtifact, metadata, setMetadata } = useArtifact();

  const {
    data: documents,
    isLoading: isDocumentsFetching,
    mutate: mutateDocuments,
  } = useSWR<Document[]>(
    artifact.documentId !== "init" && artifact.status !== "streaming"
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${artifact.documentId}`
      : null,
    fetcher
  );

  const [mode, setMode] = useState<"edit" | "diff">("edit");
  const [document, setDocument] = useState<Document | null>(null);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(-1);

  const { state: sidebarState } = useSidebar();
  const artifactContentRef = useRef<HTMLDivElement>(null);
  const userScrolledArtifact = useRef(false);
  const [isContentDirty, setIsContentDirty] = useState(false);

  useEffect(() => {
    if (artifact.status !== "streaming") {
      userScrolledArtifact.current = false;
      return;
    }
    if (userScrolledArtifact.current) {
      return;
    }
    const el = artifactContentRef.current;
    if (!el) {
      return;
    }
    el.scrollTo({ top: el.scrollHeight });
  }, [artifact.status]);

  useEffect(() => {
    if (documents && documents.length > 0) {
      const mostRecentDocument = documents.at(-1);

      if (mostRecentDocument) {
        setDocument(mostRecentDocument);
        setCurrentVersionIndex(documents.length - 1);
        if (artifact.status === "streaming" || !isContentDirty) {
          setArtifact((currentArtifact) => ({
            ...currentArtifact,
            content: mostRecentDocument.content ?? "",
          }));
        }
      }
    }
  }, [documents, setArtifact, artifact.status, isContentDirty]);

  // Publish which version is on screen so image tools — including chat-driven ones
  // that resolve the image on the server — edit exactly the version being viewed.
  useEffect(() => {
    setArtifact((current) =>
      current.versionIndex === currentVersionIndex
        ? current
        : { ...current, versionIndex: currentVersionIndex }
    );
  }, [currentVersionIndex, setArtifact]);

  // A streamed tool result (or a workbench edit) appends a version on the server.
  // Re-read the list whenever the image changes so the cursor lands on that new
  // version — otherwise a cursor parked on an older version by Undo would keep
  // showing the old image even though the edit was applied to it.
  const lastImageContentRef = useRef<string>("");
  useEffect(() => {
    if (artifact.kind !== "image") {
      return;
    }
    if (artifact.content === lastImageContentRef.current) {
      return;
    }
    lastImageContentRef.current = artifact.content;
    mutateDocuments();
  }, [artifact.content, artifact.kind, mutateDocuments]);

  useEffect(() => {
    mutateDocuments();
  }, [mutateDocuments]);

  const { mutate } = useSWRConfig();

  const handleContentChange = useCallback(
    (
      updatedContent: string,
      options?: {
        persisted?: boolean;
      }
    ) => {
      if (!artifact) {
        return;
      }

      // Every applied image edit is a discrete, undoable step, so it is persisted
      // as a NEW version. The text/code behaviour of overwriting the newest version
      // would silently rewrite the version the user had stepped away from with Undo
      // while they were looking at an older one.
      const isImage = artifact.kind === "image";

      mutate<Document[]>(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${artifact.documentId}`,
        async (currentDocuments) => {
          if (!currentDocuments) {
            return [];
          }

          const currentDocument = currentDocuments.at(-1);

          if (!currentDocument?.content) {
            setIsContentDirty(false);
            return currentDocuments;
          }

          if (currentDocument.content === updatedContent) {
            setIsContentDirty(false);
            return currentDocuments;
          }

          // The image pipeline persists its own output, so posting the bytes back
          // here would be both redundant and fatal for a full-resolution photo: a
          // request body over 4.5 MB is rejected by the platform before it reaches
          // us. Only advance the local version list.
          if (!options?.persisted) {
            await fetch(
              `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${artifact.documentId}`,
              {
                body: JSON.stringify({
                  content: updatedContent,
                  isManualEdit: !isImage,
                  kind: artifact.kind,
                  title: artifact.title,
                }),
                method: "POST",
              }
            );
          }

          setIsContentDirty(false);

          if (!isImage) {
            return currentDocuments.map((doc, i) =>
              i === currentDocuments.length - 1
                ? { ...doc, content: updatedContent }
                : doc
            );
          }

          // Images: append the edit as a new version. The cursor then snaps to it
          // via the documents effect, the result becomes what the user sees, and
          // Undo can step back to the previous state. Appending optimistically —
          // rather than waiting for a refetch — is also what keeps the *next* edit
          // aimed at this new version.
          return [
            ...currentDocuments,
            {
              ...currentDocument,
              content: updatedContent,
              createdAt: new Date(),
            },
          ];
        },
        { revalidate: false }
      );
    },
    [artifact, mutate]
  );

  const latestContentRef = useRef<string>("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveContent = useCallback(
    (
      updatedContent: string,
      debounce: boolean,
      options?: { persisted?: boolean }
    ) => {
      latestContentRef.current = updatedContent;
      setIsContentDirty(true);

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      if (debounce) {
        saveTimerRef.current = setTimeout(() => {
          handleContentChange(latestContentRef.current, options);
          saveTimerRef.current = null;
        }, 2000);
      } else {
        handleContentChange(updatedContent, options);
      }
    },
    [handleContentChange]
  );

  const getDocumentContentById = useCallback(
    (index: number) => {
      if (!documents) {
        return "";
      }
      if (!documents[index]) {
        return "";
      }
      return documents[index].content ?? "";
    },
    [documents]
  );

  const handleVersionChange = useCallback(
    (type: "next" | "prev" | "toggle" | "latest") => {
      if (!documents) {
        return;
      }

      if (type === "latest") {
        setCurrentVersionIndex(documents.length - 1);
        setMode("edit");
      }

      if (type === "toggle") {
        setMode((currentMode) => (currentMode === "edit" ? "diff" : "edit"));
      }

      if (type === "prev") {
        if (currentVersionIndex > 0) {
          setCurrentVersionIndex((index) => index - 1);
        }
      } else if (
        type === "next" &&
        currentVersionIndex < documents.length - 1
      ) {
        setCurrentVersionIndex((index) => index + 1);
      }
    },
    [currentVersionIndex, documents]
  );

  const handleArtifactScroll = useCallback(() => {
    const el = artifactContentRef.current;
    if (!el) {
      return;
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    userScrolledArtifact.current = !atBottom;
  }, []);

  const handleClose = useCallback(() => {
    setArtifact((prev) => ({ ...prev, isVisible: false }));
  }, [setArtifact]);

  const [isToolbarVisible, setIsToolbarVisible] = useState(true);

  const isCurrentVersion =
    documents && documents.length > 0
      ? currentVersionIndex === documents.length - 1
      : true;

  const { width: windowWidth, height: windowHeight } = useWindowSize();
  const isMobile = windowWidth ? windowWidth < 768 : false;

  const artifactDefinition = artifactDefinitions.find(
    (definition) => definition.kind === artifact.kind
  );

  if (!artifactDefinition) {
    throw new Error("Artifact definition not found!");
  }

  useEffect(() => {
    if (artifact.documentId !== "init" && artifactDefinition.initialize) {
      artifactDefinition.initialize({
        documentId: artifact.documentId,
        setMetadata,
      });
    }
  }, [artifact.documentId, artifactDefinition, setMetadata]);

  if (!artifact.isVisible && !isMobile) {
    return (
      <div
        className="h-dvh w-0 shrink-0 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
        data-testid="artifact"
      />
    );
  }

  if (!artifact.isVisible) {
    return null;
  }

  const consoleError =
    metadata?.outputs
      ?.filter((o: { status: string }) => o.status === "failed")
      .flatMap((o: { contents: { type: string; value: string }[] }) =>
        o.contents.filter((c) => c.type === "text").map((c) => c.value)
      )
      .join("\n") || undefined;

  const artifactPanel = (
    <>
      {sidebarState !== "collapsed" && artifact.kind !== "image" && (
        <div className="flex h-[calc(3.5rem+1px)] shrink-0 items-center justify-between border-b border-border/50 px-4">
          <div className="flex items-center gap-3">
            <ArtifactCloseButton />
            <div className="flex flex-col gap-0.5">
              <div className="text-sm font-semibold leading-tight tracking-tight">
                {artifact.title}
              </div>
              <div className="flex items-center gap-2">
                {isContentDirty ? (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <div className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                    Saving...
                  </div>
                ) : document ? (
                  <div
                    className="text-xs text-muted-foreground"
                    suppressHydrationWarning
                  >
                    {`Updated ${formatDistance(new Date(document.createdAt), new Date(), { addSuffix: true })}`}
                  </div>
                ) : artifact.status === "streaming" ? (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <div className="animate-spin">
                      <LoaderIcon size={12} />
                    </div>
                    Generating...
                  </div>
                ) : (
                  <div className="h-3 w-24 animate-pulse rounded bg-muted-foreground/10" />
                )}
                {documents && documents.length > 1 && (
                  <div className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                    v{currentVersionIndex + 1}/{documents.length}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <div
        className={cn(
          "relative flex-1 bg-background",
          artifact.kind === "image"
            ? "overflow-hidden flex flex-col"
            : "overflow-y-auto"
        )}
        data-slot="artifact-content"
        onScroll={handleArtifactScroll}
        ref={artifactContentRef}
      >
        <artifactDefinition.content
          content={
            isCurrentVersion
              ? artifact.content
              : getDocumentContentById(currentVersionIndex)
          }
          currentVersionIndex={currentVersionIndex}
          getDocumentContentById={getDocumentContentById}
          handleVersionChange={handleVersionChange}
          isCurrentVersion={isCurrentVersion}
          isInline={false}
          isLoading={isDocumentsFetching && !artifact.content}
          metadata={metadata}
          mode={mode}
          onSaveContent={saveContent}
          setMetadata={setMetadata}
          status={artifact.status}
          suggestions={[]}
          title={artifact.title}
          totalVersions={documents?.length ?? 1}
        />
        <AnimatePresence>
          {isCurrentVersion && artifact.kind !== "image" ? (
            <Toolbar
              artifactActions={
                <ArtifactActions
                  artifact={artifact}
                  currentVersionIndex={currentVersionIndex}
                  handleVersionChange={handleVersionChange}
                  isCurrentVersion={isCurrentVersion}
                  metadata={metadata}
                  mode={mode}
                  setMetadata={setMetadata}
                />
              }
              artifactKind={artifact.kind}
              consoleError={consoleError}
              documentId={artifact.documentId}
              isToolbarVisible={isToolbarVisible}
              onClose={handleClose}
              sendMessage={sendMessage}
              setIsToolbarVisible={setIsToolbarVisible}
              setMessages={setMessages}
              status={status}
              stop={stop}
            />
          ) : null}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {!isCurrentVersion && artifact.kind !== "image" && (
          <VersionFooter
            currentVersionIndex={currentVersionIndex}
            documents={documents}
            handleVersionChange={handleVersionChange}
            mode={mode}
            setMode={setMode}
          />
        )}
      </AnimatePresence>
    </>
  );

  if (isMobile) {
    return (
      <motion.div
        animate={{
          borderRadius: 0,
          height: windowHeight,
          opacity: 1,
          width: "100dvw",
          x: 0,
          y: 0,
        }}
        className="fixed inset-0 z-50 flex h-dvh flex-col overflow-hidden bg-sidebar"
        data-testid="artifact"
        exit={{ opacity: 0, scale: 0.95 }}
        initial={{
          borderRadius: 50,
          height: artifact.boundingBox.height,
          opacity: 1,
          width: artifact.boundingBox.width,
          x: artifact.boundingBox.left,
          y: artifact.boundingBox.top,
        }}
        transition={{ damping: 30, stiffness: 300, type: "spring" }}
      >
        {artifactPanel}
      </motion.div>
    );
  }

  return (
    <div
      className="flex h-dvh w-[60%] shrink-0 flex-col overflow-hidden border-l border-border/50 bg-sidebar transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
      data-testid="artifact"
    >
      {artifactPanel}
    </div>
  );
}

export const Artifact = memo(PureArtifact, (prevProps, nextProps) => {
  if (prevProps.status !== nextProps.status) {
    return false;
  }
  if (!equal(prevProps.votes, nextProps.votes)) {
    return false;
  }
  if (prevProps.input !== nextProps.input) {
    return false;
  }
  if (prevProps.messages.length !== nextProps.messages.length) {
    return false;
  }
  if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
    return false;
  }

  return true;
});
