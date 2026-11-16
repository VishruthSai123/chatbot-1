"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveChat } from "@/hooks/use-active-chat";
import {
  initialArtifactData,
  useArtifact,
  useArtifactSelector,
} from "@/hooks/use-artifact";
import { withAndroidEmbed } from "@/lib/embed";
import type { SampleFile } from "@/lib/samples";
import type { Attachment, ChatMessage } from "@/lib/types";
import { UploadError, uploadFile } from "@/lib/upload/client";
import { cn } from "@/lib/utils";
import { WebReadySignal } from "../web-ready-signal";
import { Artifact } from "./artifact";
import { CapabilitiesDialog } from "./capabilities-dialog";
import { ChatHeader } from "./chat-header";
import { DataStreamHandler } from "./data-stream-handler";
import { submitEditedMessage } from "./message-editor";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";
import { toast } from "./toast";

export function ChatShell() {
  const {
    chatId,
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    addToolApprovalResponse,
    input,
    setInput,
    visibilityType,
    isReadonly,
    isLoading,
    votes,
    currentModelId,
    setCurrentModelId,
  } = useActiveChat();

  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(
    null
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  const [capabilitiesFamily, setCapabilitiesFamily] = useState<
    string | undefined
  >(undefined);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);
  const { setArtifact } = useArtifact();

  const focusComposer = useCallback(() => {
    let tries = 0;
    const focus = () => {
      const composer = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="multimodal-input"]'
      );
      if (composer) {
        composer.focus();
        return;
      }
      tries += 1;
      if (tries < 12) {
        window.setTimeout(focus, 50);
      }
    };
    requestAnimationFrame(focus);
  }, []);

  /**
   * Android share hand-off.
   *
   * Files are shown in the composer as soon as the tiny native manifest
   * arrives, then uploaded in parallel. The user sees the attachment and a
   * spinner immediately instead of a blank composer while a large file
   * uploads. Each placeholder is replaced in place when its upload finishes.
   */
  const hasHydratedShareRef = useRef(false);
  useEffect(() => {
    if (hasHydratedShareRef.current) {
      return;
    }
    hasHydratedShareRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const share = params.get("share");
    if (!share) {
      return;
    }

    // Tells the Android WebView fallback not to inject the same files again.
    document.documentElement.dataset.androidShare = "handled";

    const cleanShareUrl = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("share");
      window.history.replaceState({}, "", url.toString());
    };
    const shareBase = "https://appassets.androidplatform.net";

    // biome-ignore lint/complexity/noVoid: the async block handles its own errors
    void (async () => {
      try {
        const response = await fetch(
          `${shareBase}/share/${encodeURIComponent(share)}/manifest.json`
        );
        if (!response.ok) {
          throw new Error(`Share manifest ${response.status}`);
        }
        const manifest = (await response.json()) as {
          text?: string;
          files?: Array<{ name: string; type: string; url: string }>;
        };
        const files = Array.isArray(manifest.files) ? manifest.files : [];
        // The manifest and files are in memory now; drop the token so a
        // refresh cannot import the same share twice.
        cleanShareUrl();

        if (manifest.text) {
          setInput(manifest.text);
        }
        const localIds = files.map((_file, index) => `${share}:${index}`);
        if (files.length > 0) {
          setAttachments((current) => [
            ...current,
            ...files.map((file, index) => ({
              contentType: file.type || "application/octet-stream",
              localId: localIds[index],
              name: file.name || "Shared file",
              uploading: true,
              url: "",
            })),
          ]);
          focusComposer();
        }

        let failedUploads = 0;
        let firstError: string | null = null;
        await Promise.all(
          files.map(async (file, index) => {
            const localId = localIds[index];
            let localUrl: string | null = null;
            try {
              const fileResponse = await fetch(file.url);
              if (!fileResponse.ok) {
                throw new Error(`Shared file ${fileResponse.status}`);
              }
              const blob = await fileResponse.blob();
              localUrl = URL.createObjectURL(blob);
              setAttachments((current) =>
                current.map((attachment) =>
                  attachment.localId === localId
                    ? { ...attachment, url: localUrl ?? "" }
                    : attachment
                )
              );

              const uploaded = await uploadFile(
                new File([blob], file.name, {
                  type: file.type || blob.type || "application/octet-stream",
                }),
                { chatId }
              );
              setAttachments((current) =>
                current.map((attachment) =>
                  attachment.localId === localId
                    ? {
                        contentType: uploaded.contentType,
                        documentId: uploaded.documentId,
                        name: uploaded.name,
                        url: uploaded.url,
                      }
                    : attachment
                )
              );
            } catch (error) {
              failedUploads += 1;
              firstError =
                error instanceof UploadError
                  ? error.message
                  : "Could not attach the shared file. Try again.";
              console.error("Could not attach a shared file", error);
              setAttachments((current) =>
                current.filter((attachment) => attachment.localId !== localId)
              );
            } finally {
              if (localUrl) {
                // Let React paint the uploaded URL before the blob is freed.
                const blobUrl = localUrl;
                window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
              }
            }
          })
        );

        if (failedUploads > 0) {
          toast({
            description:
              failedUploads === files.length
                ? (firstError ?? "Could not attach the shared file. Try again.")
                : "Some files could not be attached.",
            type: "error",
          });
        }
        focusComposer();
      } catch (error) {
        console.error("Could not import the shared file", error);
        toast({
          description:
            error instanceof UploadError
              ? error.message
              : "Could not attach the shared file. Try again.",
          type: "error",
        });
        focusComposer();
        cleanShareUrl();
      }
    })();
  }, [chatId, focusComposer, setInput]);

  /**
   * The capability panel lives here rather than in the composer: it is opened
   * from two places — the empty state and the button beside the composer — and
   * an example it hands back has to land in the composer's input.
   */
  const showCapabilities = useCallback((familyId?: string) => {
    setCapabilitiesFamily(familyId);
    setCapabilitiesOpen(true);
  }, []);

  /**
   * Runs a sample through the real pipeline.
   *
   * The file is fetched, uploaded like any attachment, and sent with the
   * prompt that demonstrates it — so "try it" exercises exactly the same path
   * a user's own file would.
   */
  const handleTrySample = useCallback(
    async (sample: SampleFile) => {
      const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

      try {
        const response = await fetch(`${basePath}${sample.href}`);

        if (!response.ok) {
          throw new Error("The sample file could not be loaded.");
        }

        const blob = await response.blob();
        const file = new File([blob], sample.filename, {
          type: sample.mediaType,
        });
        const uploaded = await uploadFile(file, { chatId });

        const targetUrl = withAndroidEmbed(`${basePath}/chat/${chatId}`);
        const currentUrl = `${window.location.pathname}${window.location.search}`;
        if (currentUrl !== targetUrl) {
          window.history.pushState({}, "", targetUrl);
        }
        setCapabilitiesOpen(false);

        // Built as a variable rather than inline: the file part carries
        // `documentId`, which the SDK's type does not name but the app reads.
        const filePart = {
          documentId: uploaded.documentId,
          filename: uploaded.name,
          mediaType: uploaded.contentType,
          name: uploaded.name,
          type: "file" as const,
          url: uploaded.url,
        };

        sendMessage({
          parts: [filePart, { text: sample.prompt, type: "text" as const }],
          role: "user",
        });
      } catch (error: any) {
        console.error("Sample failed:", error);
        throw error;
      }
    },
    [chatId, sendMessage]
  );

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      stopRef.current();
      setArtifact(initialArtifactData);
      setEditingMessage(null);
      setAttachments([]);
    }
  }, [chatId, setArtifact]);

  const handleEditMessage = useCallback(
    (msg: ChatMessage) => {
      const text = msg.parts
        ?.filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");
      setInput(text ?? "");
      setEditingMessage(msg);
    },
    [setInput]
  );

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
    setInput("");
  }, [setInput]);

  const handleSendEditedMessage = useCallback(async () => {
    if (!editingMessage) {
      return;
    }

    const msg = editingMessage;
    setEditingMessage(null);
    await submitEditedMessage({
      message: msg,
      regenerate,
      setMessages,
      text: input,
    });
    setInput("");
  }, [editingMessage, input, regenerate, setInput, setMessages]);

  return (
    <>
      <WebReadySignal />
      <div className="flex h-dvh w-full flex-row overflow-hidden">
        <div
          className={cn(
            "flex min-w-0 flex-col bg-sidebar transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
            // On a phone the artifact is a full-screen overlay, so the chat
            // stays full width behind it; the split only applies from md up.
            isArtifactVisible ? "w-full md:w-[40%]" : "w-full"
          )}
        >
          <ChatHeader
            chatId={chatId}
            isReadonly={isReadonly}
            messages={messages}
            selectedVisibilityType={visibilityType}
          />

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:rounded-tl-[12px] md:border-t md:border-l md:border-border/40">
            <Messages
              addToolApprovalResponse={addToolApprovalResponse}
              chatId={chatId}
              isArtifactVisible={isArtifactVisible}
              isLoading={isLoading}
              isReadonly={isReadonly}
              messages={messages}
              onEditMessage={handleEditMessage}
              onShowCapabilities={showCapabilities}
              onTrySample={handleTrySample}
              regenerate={regenerate}
              selectedModelId={currentModelId}
              setMessages={setMessages}
              status={status}
              votes={votes}
            />

            <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-3 pb-3 md:px-4 md:pb-4">
              {!isReadonly && (
                <MultimodalInput
                  attachments={attachments}
                  chatId={chatId}
                  editingMessage={editingMessage}
                  input={input}
                  onCancelEdit={handleCancelEdit}
                  onModelChange={setCurrentModelId}
                  onShowCapabilities={showCapabilities}
                  selectedModelId={currentModelId}
                  sendMessage={
                    editingMessage ? handleSendEditedMessage : sendMessage
                  }
                  setAttachments={setAttachments}
                  setInput={setInput}
                  setMessages={setMessages}
                  status={status}
                  stop={stop}
                />
              )}
            </div>
          </div>
        </div>

        <CapabilitiesDialog
          initialFamily={capabilitiesFamily}
          onOpenChange={setCapabilitiesOpen}
          onTrySample={handleTrySample}
          onUseExample={(text) => {
            setInput(text);
            document
              .querySelector<HTMLTextAreaElement>(
                '[data-testid="multimodal-input"]'
              )
              ?.focus();
          }}
          open={capabilitiesOpen}
        />

        <Artifact
          addToolApprovalResponse={addToolApprovalResponse}
          attachments={attachments}
          chatId={chatId}
          input={input}
          isReadonly={isReadonly}
          messages={messages}
          regenerate={regenerate}
          selectedModelId={currentModelId}
          selectedVisibilityType={visibilityType}
          sendMessage={sendMessage}
          setAttachments={setAttachments}
          setInput={setInput}
          setMessages={setMessages}
          status={status}
          stop={stop}
          votes={votes}
        />
      </div>

      <DataStreamHandler />
    </>
  );
}
