"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { usePathname } from "next/navigation";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import type { UIArtifact } from "@/components/chat/artifact";
import { useDataStream } from "@/components/chat/data-stream-provider";
import { getChatHistoryPaginationKey } from "@/components/chat/sidebar-history";
import { toast } from "@/components/chat/toast";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { allowedModelIds, DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { isToolContinuation } from "@/lib/chat/message-state";
import type { Vote } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import {
  cancelPendingDeviceActions,
  type DeviceActionInput,
  requestDeviceAction,
} from "@/lib/spire-device-bridge";
import type { Attachment, ChatMessage } from "@/lib/types";
import { uploadFile } from "@/lib/upload/client";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";

type ActiveChatContextValue = {
  chatId: string;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  status: UseChatHelpers<ChatMessage>["status"];
  stop: UseChatHelpers<ChatMessage>["stop"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  visibilityType: VisibilityType;
  isReadonly: boolean;
  isLoading: boolean;
  votes: Vote[] | undefined;
  currentModelId: string;
  setCurrentModelId: (id: string) => void;
  showCreditCardAlert: boolean;
  setShowCreditCardAlert: Dispatch<SetStateAction<boolean>>;
  /**
   * Files handed over by the Android WebView shell (share sheet). The chat
   * shell appends these to the composer once, so the user can add their own
   * prompt before sending.
   */
  pendingAttachments: Attachment[];
  setPendingAttachments: Dispatch<SetStateAction<Attachment[]>>;
};

const ActiveChatContext = createContext<ActiveChatContextValue | null>(null);

function extractChatId(pathname: string): string | null {
  const match = pathname.match(/\/chat\/([^/]+)/);

  // `/chat/new` is not a chat: the id in the URL has to be a real UUID, and
  // sending the literal string "new" to the API is rejected as invalid.
  if (!match || match[1] === "new") {
    return null;
  }

  return match[1];
}

/**
 * True only when the last step has a client-side device action and every tool
 * in that step already has a result. The old check resubmitted as soon as one
 * device result existed, even if another call was still pending.
 */
function lastAssistantMessageHasCompleteDeviceAction(
  messages: ChatMessage[]
): boolean {
  const message = messages.at(-1);

  if (message?.role !== "assistant") {
    return false;
  }

  const lastStepStart = message.parts.reduce(
    (lastIndex, part, index) =>
      part.type === "step-start" ? index : lastIndex,
    -1
  );
  const lastStep = message.parts.slice(lastStepStart + 1);
  const toolParts = lastStep.filter(
    (part) =>
      part.type.startsWith("tool-") &&
      !(part as { providerExecuted?: boolean }).providerExecuted
  );

  if (toolParts.length === 0) {
    return false;
  }

  const hasDeviceAction = toolParts.some(
    (part) => part.type === "tool-deviceAction"
  );

  if (!hasDeviceAction) {
    return false;
  }

  const allResolved = toolParts.every((part) => {
    const { state } = part as { state?: string };
    return (
      state === "output-available" ||
      state === "output-error" ||
      state === "output-denied"
    );
  });

  if (!allResolved) {
    return false;
  }

  const lastToolIndex = lastStep.findLastIndex((part) =>
    part.type.startsWith("tool-")
  );

  return !lastStep
    .slice(lastToolIndex + 1)
    .some(
      (part) =>
        part.type === "text" && (part as { state?: string }).state !== "done"
    );
}

export function ActiveChatProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { setDataStream, setWaitingStatus } = useDataStream();
  const { mutate } = useSWRConfig();

  const chatIdFromUrl = extractChatId(pathname);
  const isNewChat = !chatIdFromUrl;
  const newChatIdRef = useRef(generateUUID());
  const prevPathnameRef = useRef(pathname);

  if (isNewChat && prevPathnameRef.current !== pathname) {
    newChatIdRef.current = generateUUID();
  }
  prevPathnameRef.current = pathname;

  const chatId = chatIdFromUrl ?? newChatIdRef.current;

  const [currentModelId, setCurrentModelId] = useState(DEFAULT_CHAT_MODEL);
  const currentModelIdRef = useRef(currentModelId);
  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);

  const [input, setInput] = useState("");
  const [showCreditCardAlert, setShowCreditCardAlert] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>(
    []
  );
  const pendingDeviceActionsRef = useRef(new Set<string>());
  const resolvedDeviceActionsRef = useRef(new Set<string>());
  const stopRequestedRef = useRef(false);

  const { data: chatData, isLoading } = useSWR(
    isNewChat
      ? null
      : `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/messages?chatId=${chatId}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const initialMessages: ChatMessage[] = isNewChat
    ? []
    : (chatData?.messages ?? []);
  const visibility: VisibilityType = isNewChat
    ? "private"
    : (chatData?.visibility ?? "private");

  // The image or PDF currently open in the workbench/studio, tracked through the shared artifact store.
  // Sending it lets tools edit exactly what the user sees, even without a URL.
  const { data: activeArtifact } = useSWR<UIArtifact>("artifact", null);
  const activeImageRef = useRef<{
    documentId: string;
    toolMode?: string;
    versionIndex?: number;
  } | null>(null);
  const activePdfRef = useRef<{
    documentId: string;
    versionIndex?: number;
  } | null>(null);
  const activeSheetRef = useRef<{
    documentId: string;
    versionIndex?: number;
  } | null>(null);
  useEffect(() => {
    const documentId = activeArtifact?.documentId;
    const versionIndex = activeArtifact?.versionIndex;
    activeImageRef.current =
      activeArtifact?.kind === "image" && documentId && documentId !== "init"
        ? {
            documentId,
            toolMode: activeArtifact.toolMode,
            ...(typeof versionIndex === "number" && versionIndex >= 0
              ? { versionIndex }
              : {}),
          }
        : null;
    activePdfRef.current =
      activeArtifact?.kind === "pdf" && documentId && documentId !== "init"
        ? {
            documentId,
            ...(typeof versionIndex === "number" && versionIndex >= 0
              ? { versionIndex }
              : {}),
          }
        : null;
    activeSheetRef.current =
      activeArtifact?.kind === "sheet" && documentId && documentId !== "init"
        ? {
            documentId,
            ...(typeof versionIndex === "number" && versionIndex >= 0
              ? { versionIndex }
              : {}),
          }
        : null;
  }, [activeArtifact]);

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
    addToolApprovalResponse,
    addToolOutput,
  } = useChat<ChatMessage>({
    generateId: generateUUID,
    id: chatId,
    messages: initialMessages,
    onData: (dataPart) => {
      if (dataPart.type === "data-waiting-status") {
        setWaitingStatus(dataPart.data);
        return;
      }
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
    },
    onError: (error) => {
      if (error.message?.includes("AI Gateway requires a valid credit card")) {
        setShowCreditCardAlert(true);
        return;
      }

      /*
       * The SDK uses "An error occurred." for late stream/tool noise, including
       * turns where the answer has already streamed. The message itself renders
       * the real error card; a duplicate toast only makes a successful answer
       * look broken.
       */
      if (!error.message || error.message === "An error occurred.") {
        return;
      }

      if (error instanceof ChatbotError) {
        toast({ description: error.message, type: "error" });
      } else {
        toast({
          description: error.message,
          type: "error",
        });
      }
    },
    onFinish: ({ isAbort, isError }) => {
      mutate(unstable_serialize(getChatHistoryPaginationKey));

      if (isAbort || isError) {
        cancelPendingDeviceActions(
          isAbort
            ? "The action was cancelled because you stopped the response."
            : "The action was cancelled because the response failed."
        );
      }
    },
    onToolCall: async ({ toolCall }) => {
      if (toolCall.toolName !== "deviceAction") {
        return;
      }

      if (resolvedDeviceActionsRef.current.has(toolCall.toolCallId)) {
        return;
      }

      pendingDeviceActionsRef.current.add(toolCall.toolCallId);

      try {
        if (stopRequestedRef.current) {
          addToolOutput({
            errorText: "The action was cancelled.",
            state: "output-error",
            tool: "deviceAction",
            toolCallId: toolCall.toolCallId,
          });
          return;
        }

        const output = await requestDeviceAction(
          toolCall.input as DeviceActionInput
        );

        addToolOutput({
          output,
          tool: "deviceAction",
          toolCallId: toolCall.toolCallId,
        });
      } catch (error) {
        addToolOutput({
          errorText:
            error instanceof Error
              ? error.message
              : "The device action could not be completed.",
          state: "output-error",
          tool: "deviceAction",
          toolCallId: toolCall.toolCallId,
        });
      } finally {
        pendingDeviceActionsRef.current.delete(toolCall.toolCallId);
        resolvedDeviceActionsRef.current.add(toolCall.toolCallId);
      }
    },
    sendAutomaticallyWhen: ({ messages: currentMessages }) => {
      if (stopRequestedRef.current) {
        return false;
      }

      if (
        lastAssistantMessageIsCompleteWithApprovalResponses({
          messages: currentMessages,
        })
      ) {
        return true;
      }

      return lastAssistantMessageHasCompleteDeviceAction(currentMessages);
    },
    transport: new DefaultChatTransport({
      api: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat`,
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        const lastMessage = request.messages.at(-1);

        if (lastMessage?.role === "user") {
          stopRequestedRef.current = false;
        }

        /*
         * Only an assistant message can be a tool continuation. A new user
         * message must be sent as `message`, even if older turns contain tool
         * results; otherwise the server treats the whole history as a
         * continuation and can end with an empty response.
         */
        const isToolApprovalContinuation = isToolContinuation(request.messages);

        return {
          body: {
            id: request.id,
            ...(isToolApprovalContinuation
              ? { messages: request.messages }
              : { message: lastMessage }),
            activeImage: activeImageRef.current ?? undefined,
            activePdf: activePdfRef.current ?? undefined,
            activeSheet: activeSheetRef.current ?? undefined,
            androidBridge:
              typeof window !== "undefined" && Boolean(window.SpireAndroid),
            selectedChatModel: currentModelIdRef.current,
            selectedVisibilityType: visibility,
            ...request.body,
          },
        };
      },
    }),
  });

  /**
   * Stop must first complete any native action that is waiting for the user.
   * Otherwise the tool call is left open and the next turn cannot be built.
   */
  const stopWithCleanup = useCallback(async () => {
    stopRequestedRef.current = true;
    cancelPendingDeviceActions(
      "The action was cancelled because you stopped the response."
    );

    // Let the onToolCall continuation write its result before aborting.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    await stop();
  }, [stop]);

  /*
   * A device call can be left unresolved if the page was aborted before
   * onToolCall ran. Complete it with an explicit error as soon as the turn is
   * no longer streaming; pending native dialogs are excluded above.
   */
  useEffect(() => {
    if (status !== "ready" && status !== "error") {
      return;
    }

    const lastMessage = messages.at(-1);

    if (lastMessage?.role !== "assistant") {
      return;
    }

    for (const part of lastMessage.parts) {
      if (part.type !== "tool-deviceAction") {
        continue;
      }

      const { state } = part as { state?: string };

      if (state !== "input-available" && state !== "input-streaming") {
        continue;
      }

      if (
        pendingDeviceActionsRef.current.has(part.toolCallId) ||
        resolvedDeviceActionsRef.current.has(part.toolCallId)
      ) {
        continue;
      }

      resolvedDeviceActionsRef.current.add(part.toolCallId);
      addToolOutput({
        errorText: "The device action did not finish. Please try again.",
        state: "output-error",
        tool: "deviceAction",
        toolCallId: part.toolCallId,
      });
    }
  }, [addToolOutput, messages, status]);

  useEffect(() => {
    if (status === "submitted" || status === "ready" || status === "error") {
      setWaitingStatus(undefined);
    }
  }, [status, setWaitingStatus]);

  const loadedChatIds = useRef(new Set<string>());

  useEffect(() => {
    if (loadedChatIds.current.has(chatId)) {
      return;
    }

    /*
     * A chat that has not been written yet answers with an empty list and a
     * null owner: the URL moves to `/chat/<id>` before the first message is
     * persisted. Treating that response as loaded would pin the conversation
     * to its empty state, and every later revalidation would be ignored.
     * Wait for the authoritative response instead.
     */
    if (!chatData || chatData.userId === null) {
      return;
    }

    loadedChatIds.current.add(chatId);
    setMessages(chatData.messages);
  }, [chatId, chatData, setMessages]);

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      if (isNewChat) {
        setMessages([]);
      }
    }
  }, [chatId, isNewChat, setMessages]);

  useEffect(() => {
    if (chatData && !isNewChat) {
      const cookieModel = document.cookie
        .split("; ")
        .find((row) => row.startsWith("chat-model="))
        ?.split("=")[1];
      if (cookieModel) {
        const decoded = decodeURIComponent(cookieModel);
        if (allowedModelIds.has(decoded)) {
          setCurrentModelId(decoded);
        } else {
          setCurrentModelId(DEFAULT_CHAT_MODEL);
        }
      }
    }
  }, [chatData, isNewChat]);

  const hasAppendedQueryRef = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("query");
    if (query && !hasAppendedQueryRef.current) {
      hasAppendedQueryRef.current = true;
      window.history.replaceState(
        {},
        "",
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
      );
      sendMessage({
        parts: [{ text: query, type: "text" }],
        role: "user" as const,
      });
    }
  }, [sendMessage, chatId]);

  /**
   * Android shell hand-off.
   *
   * The native app opens `?query=` for a text share or Ask action, `?draft=`
   * to prefill only, and `?share=<token>` for images/PDFs. The token maps to a
   * small manifest served by the WebView from
   * `https://appassets.androidplatform.net`. Files are fetched here and sent
   * through the same `uploadFile` path as a normal attachment, so the native
   * side never needs the HttpOnly session cookie.
   */
  const hasHydratedAndroidExtrasRef = useRef(false);
  useEffect(() => {
    if (hasHydratedAndroidExtrasRef.current) {
      return;
    }
    hasHydratedAndroidExtrasRef.current = true;

    const params = new URLSearchParams(window.location.search);
    if (params.get("embed") === "android") {
      document.documentElement.dataset.embed = "android";
    }

    const draft = params.get("draft");
    if (draft) {
      setInput((current) => current || draft);
    }

    const cleanUrl = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("share");
      url.searchParams.delete("draft");
      window.history.replaceState({}, "", url.toString());
    };

    const share = params.get("share");
    if (!share) {
      if (draft) {
        cleanUrl();
      }
      return;
    }

    // Tells the Android WebView fallback not to inject the same files again.
    document.documentElement.dataset.androidShare = "handled";

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

        if (manifest.text) {
          setInput((current) => current || manifest.text || "");
        }

        const uploaded: Attachment[] = [];
        for (const file of manifest.files ?? []) {
          // biome-ignore lint/performance/noAwaitInLoops: uploads stay in share-sheet order
          const fileResponse = await fetch(file.url);
          if (!fileResponse.ok) {
            continue;
          }
          const blob = await fileResponse.blob();
          const result = await uploadFile(
            new File([blob], file.name, {
              type: file.type || blob.type || "application/octet-stream",
            }),
            { chatId }
          );
          uploaded.push({
            contentType: result.contentType,
            documentId: result.documentId,
            name: result.name,
            url: result.url,
          });
        }

        if (uploaded.length > 0) {
          setPendingAttachments((current) => [...current, ...uploaded]);
        }
        cleanUrl();
      } catch (error) {
        console.error("Could not import the shared file", error);
        cleanUrl();
      }
    })();
  }, [chatId]);

  useAutoResume({
    autoResume: !isNewChat && !!chatData,
    initialMessages,
    resumeStream,
    setMessages,
  });

  const isReadonly = isNewChat ? false : (chatData?.isReadonly ?? false);

  const { data: votes } = useSWR<Vote[]>(
    !isReadonly && messages.length >= 2
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/vote?chatId=${chatId}`
      : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const value = useMemo<ActiveChatContextValue>(
    () => ({
      addToolApprovalResponse,
      chatId,
      currentModelId,
      input,
      isLoading: !isNewChat && isLoading,
      isReadonly,
      messages,
      pendingAttachments,
      regenerate,
      sendMessage,
      setCurrentModelId,
      setInput,
      setMessages,
      setPendingAttachments,
      setShowCreditCardAlert,
      showCreditCardAlert,
      status,
      stop: stopWithCleanup,
      visibilityType: visibility,
      votes,
    }),
    [
      chatId,
      messages,
      setMessages,
      sendMessage,
      status,
      stopWithCleanup,
      regenerate,
      addToolApprovalResponse,
      input,
      visibility,
      isReadonly,
      isNewChat,
      isLoading,
      votes,
      currentModelId,
      pendingAttachments,
      showCreditCardAlert,
    ]
  );

  return (
    <ActiveChatContext.Provider value={value}>
      {children}
    </ActiveChatContext.Provider>
  );
}

export function useActiveChat() {
  const context = useContext(ActiveChatContext);
  if (!context) {
    throw new Error("useActiveChat must be used within ActiveChatProvider");
  }
  return context;
}
